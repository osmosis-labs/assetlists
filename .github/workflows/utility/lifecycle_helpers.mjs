// Shared helpers for the daily/weekly lifecycle cron scripts:
//   - check_market_health.mjs
//   - check_extended_halts.mjs
//   - check_unverify_candidates.mjs
//   - asset_status_report.mjs
//
// Consolidates what was previously duplicated across all four. Generation-time
// helpers (update_assetlist_state.mjs's getStateAsset, etc.) intentionally
// stay separate because they mutate during generation rather than reading a
// frozen frontend assetlist.

import * as fs from 'fs';

// ── Numia ────────────────────────────────────────────────────────────────────

export const NUMIA_TOKENS_URL = 'https://public-osmosis-api.numia.xyz/tokens/v2/all';

/**
 * Fetch the Numia token list and build a Map keyed by denom. Each entry holds
 * { liquidity, volume24h, mcap }; mcap is populated for callers that need it
 * (asset_status_report) and ignored by everyone else.
 *
 * Pass { hardFail: true } when the script cannot meaningfully continue without
 * Numia data (check_market_health / check_extended_halts). Pass false to
 * degrade quietly to an empty map (asset_status_report / check_unverify_candidates,
 * where Numia data is informational).
 */
export async function fetchNumia({ hardFail = true } = {}) {
  const controller = new AbortController();
  const timeoutMs = 10000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(NUMIA_TOKENS_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      if (hardFail) {
        throw new Error(`Numia returned HTTP ${res.status}; aborting (hard-fail policy)`);
      }
      return new Map();
    }
    const data = await res.json();
    const byDenom = new Map();
    for (const t of data) {
      if (!t.denom) continue;
      byDenom.set(t.denom, {
        liquidity: Number(t.liquidity ?? 0),
        // Several plausible field names in Numia's history; default to 0.
        volume24h: Number(t.volume_24h ?? t.volume_24h_usd ?? t.volume24h ?? 0),
        mcap: Number(t.market_cap ?? 0),
      });
    }
    return byDenom;
  } catch (err) {
    clearTimeout(timeoutId);
    if (!hardFail) return new Map();
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${NUMIA_TOKENS_URL} timed out after 10s (hard-fail policy)`);
    }
    throw new Error(`Failed to fetch from ${NUMIA_TOKENS_URL}: ${err.message}`);
  }
}

// ── SQS alloy constituent map ────────────────────────────────────────────────

export const SQS_POOLS_URL = 'https://sqs.osmosis.zone/pools?filter%5Btype%5D=3';

// Unfiltered pools endpoint. Used to cross-check Numia's liquidity reading
// against on-chain pool value before clearing an extended deposit halt. The
// type=3 filter above is alloy-only and would miss the balancer/CL pools most
// thin assets actually sit in, so the liquidity cross-check needs every pool.
export const SQS_ALL_POOLS_URL = 'https://sqs.osmosis.zone/pools';

// Mainnet alloyed-transmuter contract code ids. Mirrors the frontend's
// getAlloyedPoolCodeIds(false) constant in packages/pools/src/pool-constants.ts.
// Update this set when a new alloyed-transmuter code id is instantiated on
// chain governance, and confirm the frontend is updated in lockstep.
export const ALLOYED_POOL_CODE_IDS = new Set([814, 867, 996]);

/**
 * Build a map from constituent denom -> alloy coinMinimalDenom by pulling
 * cosmwasm pool composition from SQS and intersecting it with the frontend
 * assetlist's alloyed assets. A constituent is included only if it currently
 * holds a positive balance in the alloy pool (whitelisted-but-empty
 * constituents are excluded; they aren't contributing volume).
 *
 * Returns an empty map on SQS error so callers degrade to self-only
 * evaluation. That fallback matches pre-alloy-awareness behaviour and is
 * safe in all four lifecycle scripts.
 */
export async function fetchAlloyConstituentMap(alloyedDenomSet) {
  const constituentToAlloy = new Map();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(SQS_POOLS_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.error(`SQS returned HTTP ${res.status}; alloy-volume inheritance disabled for this run`);
      return constituentToAlloy;
    }
    const body = await res.json();
    const pools = body?.data ?? [];
    for (const pool of pools) {
      const cm = pool?.chain_model ?? {};
      const codeId = Number(cm.code_id);
      if (!ALLOYED_POOL_CODE_IDS.has(codeId)) continue;
      const contractAddr = cm.contract_address;
      if (!contractAddr) continue;
      // The factory denom for an alloyed asset is
      // factory/<contract_address>/alloyed/<sub>, so a startsWith match on
      // factory/<contract_address>/ is sufficient and avoids parsing the
      // base64 instantiate_msg.
      const expectedPrefix = `factory/${contractAddr}/`;
      const alloyDenom = [...alloyedDenomSet].find((d) => d.startsWith(expectedPrefix));
      if (!alloyDenom) continue;
      for (const b of (pool?.balances ?? [])) {
        if (!b?.denom) continue;
        // First-write wins. A constituent in multiple alloys does not occur
        // in current Osmosis state; if it ever does, the first wins.
        if (!constituentToAlloy.has(b.denom)) {
          constituentToAlloy.set(b.denom, alloyDenom);
        }
      }
    }
  } catch (err) {
    console.error(`SQS fetch failed (${err.message}); alloy-volume inheritance disabled for this run`);
  }
  return constituentToAlloy;
}

/**
 * Resolve the market signal for an asset, taking max(self, alloy) when the
 * asset is currently a constituent of an alloyed transmuter pool. Variants
 * outside any alloy fall back to their own Numia row. Returns undefined when
 * neither side has data; callers treat that as "market missing".
 *
 * mcap is forwarded so asset_status_report's borderline detector can include
 * it; other callers can ignore the field.
 */
export function resolveMarket(numia, constituentToAlloy, coinMinimalDenom) {
  const self = numia.get(coinMinimalDenom);
  const alloyDenom = constituentToAlloy.get(coinMinimalDenom);
  const alloy = alloyDenom ? numia.get(alloyDenom) : undefined;
  if (!self && !alloy) return undefined;
  return {
    liquidity: Math.max(self?.liquidity ?? 0, alloy?.liquidity ?? 0),
    volume24h: Math.max(self?.volume24h ?? 0, alloy?.volume24h ?? 0),
    mcap: self?.mcap ?? alloy?.mcap ?? 0,
  };
}

// ── SQS on-chain liquidity cross-check ───────────────────────────────────────

/**
 * Build a Map of coinMinimalDenom -> on-chain liquidity (USD), summed from the
 * whole-pool `liquidity_cap` of every pool the denom appears in. Pools whose
 * cap could not be computed (`liquidity_cap_error` set) are skipped, as are
 * non-positive caps.
 *
 * This is a deliberately coarse UPPER bound on a denom's real depth: it sums
 * whole-pool caps rather than the denom's share, so it can only overstate
 * liquidity. That bias is safe for its sole purpose — a floor cross-check on
 * the extended-halt clearing path (see canClearExtendedHalt). Overstating
 * makes the guard more willing to clear, never less, so a pass here is a
 * genuine "there is at least this much pooled value" signal.
 *
 * Pass the parsed SQS /pools body ({ data: [...] }). Returns an empty Map when
 * the body is missing or malformed; callers treat an absent denom as 0 and
 * fail closed.
 */
export function buildSqsLiquidityMap(sqsPoolsBody) {
  const byDenom = new Map();
  for (const pool of sqsPoolsBody?.data ?? []) {
    if (pool?.liquidity_cap_error) continue; // unreliable cap, skip
    const cap = Number(pool?.liquidity_cap ?? 0);
    if (!Number.isFinite(cap) || cap <= 0) continue;
    for (const b of pool?.balances ?? []) {
      if (!b?.denom) continue;
      byDenom.set(b.denom, (byDenom.get(b.denom) ?? 0) + cap);
    }
  }
  return byDenom;
}

/**
 * Fetch the unfiltered SQS pools list and reduce it to a per-denom liquidity
 * map via buildSqsLiquidityMap. Returns an empty Map on any error so callers
 * degrade to "no SQS confirmation" — which, on the clearing path, means the
 * halt stays (fail-closed). This matches the curator-funds-safety bias: a
 * flaky SQS run keeps deposits halted rather than reopening them on Numia
 * alone.
 */
export async function fetchSqsLiquidityMap() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(SQS_ALL_POOLS_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.error(`SQS returned HTTP ${res.status}; liquidity cross-check disabled (halts stay)`);
      return new Map();
    }
    const body = await res.json();
    return buildSqsLiquidityMap(body);
  } catch (err) {
    console.error(`SQS liquidity fetch failed (${err.message}); cross-check disabled (halts stay)`);
    return new Map();
  }
}

/**
 * Decide whether an extended-market deposit halt may be cleared this run.
 *
 * Two independent sources must BOTH agree the asset has recovered:
 *   1. Numia market signal "passing" (liquidity >= floor OR volume >= floor),
 *      the same condition the original single-source clear used.
 *   2. SQS on-chain liquidity >= the liquidity floor.
 *
 * Fail-closed: a missing Numia market (undefined) or a missing/zero SQS
 * liquidity reading both block the clear. This is the guard against the
 * failure mode where one source reports phantom liquidity for a denom that
 * has no real pool (e.g. Numia reporting stale ~$300k for an asset whose only
 * pool holds ~$22). Setting the halt is unaffected; this gates clearing only.
 *
 * Pure function (no I/O) so it is unit-testable with fixture inputs.
 */
export function canClearExtendedHalt({
  market,
  sqsLiquidity,
  lowLiquidityUsd,
  lowVolumeUsd,
}) {
  const numiaPassing =
    !!market &&
    (market.liquidity >= lowLiquidityUsd || market.volume24h >= lowVolumeUsd);
  const sqsConfirms = Number(sqsLiquidity ?? 0) >= lowLiquidityUsd;
  return numiaPassing && sqsConfirms;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function loadJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

// ── State helpers (cron-lifecycle semantics) ────────────────────────────────

/**
 * Read-only state lookup. Returns undefined when no entry exists. Callers that
 * only read date/streak fields should use this so the iteration doesn't
 * pollute state.assets with empty {base_denom} placeholders.
 */
export function findStateAsset(state, baseDenom) {
  return state.assets?.find((a) => a.base_denom === baseDenom);
}

/**
 * Create-if-missing state lookup, called only at the exact line that writes
 * a real value (lastDowntimeDate, marketHealthStreak, etc.). Pair with
 * findStateAsset to keep state.json stable across no-op runs.
 */
export function materialiseStateAsset(state, baseDenom) {
  let s = findStateAsset(state, baseDenom);
  if (!s) {
    s = { base_denom: baseDenom };
    if (!state.assets) state.assets = [];
    state.assets.push(s);
  }
  return s;
}
