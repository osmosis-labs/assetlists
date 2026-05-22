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
