// Purpose:
//   Unified bridge-state check. For every IBC asset in the generated frontend
//   assetlist:
//     • Detect "bridge-down" condition (IBC client Expired/Frozen on either
//       side, OR source chain marked status="killed" in the chain registry).
//     • Detect "bridge-up" condition (IBC client Active on both sides AND
//       source chain status="live").
//     • Set/clear osmosis_unstable + osmosis_halt_deposits +
//       osmosis_halt_withdrawals in zone_assets.json, with reasons.
//     • Maintain state.json's lastDowntimeDate / lastRecoveryDate fields
//       (flap-vs-fresh-incident rule).
//
//   Reason-vocabulary contract: this script owns reasons {ibc_client,
//   source_chain_killed} for both unstable and halts, and {bridge_down,
//   source_chain_killed} for halts. Halts with any other reason (notably
//   "manual" or one owned by check_extended_halts.mjs) are NEVER touched
//   by this script. A non-empty tooltip on a halt also locks the halt
//   (curator has taken ownership).
//
// Usage:
//   node check_ibc_clients.mjs [<zone_name>] [--dry-run] [--force] [--lcd <url>]
//   Example: node check_ibc_clients.mjs osmosis-1
//   Example: node check_ibc_clients.mjs osmosis-1 --dry-run
//   Example: node check_ibc_clients.mjs osmosis-1 --lcd https://osmosis-lcd.publicnode.com
//
//   --dry-run : no writes; emits markdown report; exit 0.
//   --force   : bypass the mutation cap (>10 distinct source chains touched).

import * as fs from 'fs';
import * as path from 'path';
import { calculateIbcHash } from './assetlist_functions.mjs';

const DEFAULT_LCD = "https://lcd.osmosis.zone";
const CONCURRENCY = 5;
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const COUNTERPARTY_TIMEOUT_MS = 5000;
const COUNTERPARTY_MAX_ENDPOINTS = 5;
const CHAIN_REGISTRY_PATH = path.join('..', '..', '..', 'chain-registry');

// Mutation safeguard: if a single run would touch assets across more than
// MAX_CHAINS_PER_RUN distinct source chains, the script exits without
// committing. Counts the unique `chain_name` field on each affected
// zone_asset entry. Intended to catch mass-flips from chain-registry
// submodule bumps or upstream regressions. Per-chain (not per-asset) so a
// single big chain producing many asset rows passes through normally.
const MAX_CHAINS_PER_RUN = 10;

// 30-day flap threshold: if an asset recovered <= 30d ago and goes
// unstable again, treat as a continuation of the original incident
// (preserve lastDowntimeDate). Beyond 30d → fresh incident.
const FLAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

/** Pull the value of a --flag <value> pair out of argv, returning undefined
 *  if absent. Leaves the surrounding code free to default sensibly. */
function getFlagValue(name) {
  const i = args.indexOf(name);
  if (i === -1 || i === args.length - 1) return undefined;
  const v = args[i + 1];
  return v.startsWith('--') ? undefined : v;
}

const LCD = getFlagValue('--lcd') ?? DEFAULT_LCD;

// Strip recognised --flag <value> pairs and standalone --flags before
// reading positional args, so `--lcd https://x osmosis-1` works in any order.
const FLAG_PAIRS = new Set(['--lcd']);
const positional = (() => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (FLAG_PAIRS.has(a)) { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
})();
const zoneBasePath = positional[0] || 'osmosis-1';

const zonePath = path.join('..', '..', '..', zoneBasePath);
const filePrefix = zoneBasePath.split('-')[0];
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
const frontendPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');
const chainlistPath = path.join(zonePath, 'generated', 'frontend', 'chainlist.json');
const zoneChainsPath = path.join(zonePath, `${filePrefix}.zone_chains.json`);
const statePath = path.join(zonePath, 'generated', 'state', 'state.json');
const reportsDir = path.join(zonePath, 'generated', 'reports');

// Auto-managed fields. A "thin entry" is one where everything was auto-set
// by this script (no curator content), so it can be removed entirely on
// recovery rather than just having its flags cleared. Note that
// tooltip_message is intentionally NOT in this set: any curator-set tooltip
// counts as content that must be preserved.
const AUTO_MANAGED_FIELDS = new Set([
  'chain_name',
  'base_denom',
  'path',
  '_comment',
  'osmosis_unstable',
  'osmosis_unstable_reason',
  'osmosis_halt_deposits',
  'osmosis_deposit_halt_reason',
  'osmosis_halt_withdrawals',
  'osmosis_withdrawal_halt_reason',
]);

function isThinEntry(asset) {
  return Object.keys(asset).every((k) => AUTO_MANAGED_FIELDS.has(k));
}

// Reasons this script is allowed to clear. Anything else (extended_unstable_market,
// planned_shutdown, manual) is owned by another script or the curator and is
// left alone.
const OWNED_HALT_REASONS = new Set(['bridge_down', 'source_chain_killed']);
const OWNED_UNSTABLE_REASONS = new Set(['ibc_client', 'source_chain_killed']);

// Tooltip stamped on assets auto-created as manual because their source
// chain is already fully manually halted (see buildManualHaltChains). The
// tooltip both informs users and, via canModify*, locks the entry so the
// same automation cannot later auto-clear it on a transient Active reading.
const MANUAL_CHAIN_INHERIT_TOOLTIP =
  'This asset appeared on a source chain whose transfers are manually halted. ' +
  'Deposits and withdrawals are halted pending manual review.';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Categorise a fetch failure so the run summary can show what's actually
 *  going wrong (rate-limit vs. server error vs. network/timeout). */
function categoriseFetchError(err, status) {
  if (status === 429) return 'rate_limit';
  if (typeof status === 'number' && status >= 500) return 'server_error';
  if (typeof status === 'number' && status >= 400) return 'client_error';
  const msg = err?.message ?? '';
  if (/HTTP 429/.test(msg)) return 'rate_limit';
  if (/HTTP 5\d\d/.test(msg)) return 'server_error';
  if (/HTTP 4\d\d/.test(msg)) return 'client_error';
  if (err?.name === 'AbortError' || /timeout|timed out/i.test(msg)) return 'timeout';
  return 'network';
}

async function fetchJSON(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} for ${url}`);
        e.status = res.status;
        e.errorKind = categoriseFetchError(e, res.status);
        throw e;
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) {
        if (!err.errorKind) err.errorKind = categoriseFetchError(err);
        throw err;
      }
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

async function fetchJSONWithTimeout(url, timeoutMs = COUNTERPARTY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(500);
  }
  return results;
}

// ── Chain registry: source chain status ──────────────────────────────────────

function getSourceChainStatus(chainName) {
  try {
    const chainFile = path.join(CHAIN_REGISTRY_PATH, chainName, 'chain.json');
    const chainData = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
    return chainData.status ?? 'unknown'; // typically 'live', 'killed', 'upcoming'
  } catch {
    return 'unknown';
  }
}

// ── IBC client lookup (Osmosis side) ─────────────────────────────────────────

async function getClientStatusForChannel(channelId) {
  const channelData = await fetchJSON(
    `${LCD}/ibc/core/channel/v1/channels/${channelId}/ports/transfer`
  );
  const connectionId = channelData.channel?.connection_hops?.[0];
  if (!connectionId) throw new Error(`No connection for ${channelId}`);

  const connData = await fetchJSON(
    `${LCD}/ibc/core/connection/v1/connections/${connectionId}`
  );
  const clientId = connData.connection?.client_id;
  if (!clientId) throw new Error(`No client for ${connectionId}`);

  const statusData = await fetchJSON(
    `${LCD}/ibc/core/client/v1/client_status/${clientId}`
  );
  return { channelId, connectionId, clientId, status: statusData.status };
}

// ── IBC client lookup (counterparty side) ────────────────────────────────────

function getCounterpartyRestEndpoints(chainName, zoneChainsByName, chainlistByName) {
  const seen = new Set();
  const endpoints = [];

  function add(url) {
    if (!url) return;
    const normalised = url.replace(/\/$/, '');
    if (!seen.has(normalised)) {
      seen.add(normalised);
      endpoints.push(normalised);
    }
  }

  const zoneChain = zoneChainsByName.get(chainName);
  if (zoneChain?.rest) add(zoneChain.rest);

  const chainlistChain = chainlistByName.get(chainName);
  for (const e of chainlistChain?.apis?.rest ?? []) add(e.address);

  try {
    const chainFile = path.join(CHAIN_REGISTRY_PATH, chainName, 'chain.json');
    const chainData = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
    if (chainData.status === 'killed') return null;
    for (const e of chainData.apis?.rest ?? []) add(e.address);
  } catch { /* chain not in registry */ }

  return endpoints;
}

async function getCounterpartyClientStatus(chainName, channelId, port, zoneChainsByName, chainlistByName, deadEndpoints) {
  if (!chainName || !channelId) return 'unknown';
  // Default to 'transfer' for plain bank-denom IBC. cw20 wrappers on Secret
  // Network (and similar wasm-bound IBC variants) bind the counterparty
  // channel to a contract-specific port like `wasm.secret1...`; the lookup
  // must target that exact port or it will return nothing.
  const counterpartyPort = port || 'transfer';

  const endpoints = getCounterpartyRestEndpoints(chainName, zoneChainsByName, chainlistByName);
  if (endpoints === null) return 'killed';
  if (endpoints.length === 0) return 'unknown';

  for (const endpoint of endpoints.slice(0, COUNTERPARTY_MAX_ENDPOINTS)) {
    if (deadEndpoints.has(endpoint)) continue;

    try {
      const channelData = await fetchJSONWithTimeout(
        `${endpoint}/ibc/core/channel/v1/channels/${channelId}/ports/${counterpartyPort}`
      );
      const connectionId = channelData.channel?.connection_hops?.[0];
      if (!connectionId) continue;

      const connData = await fetchJSONWithTimeout(
        `${endpoint}/ibc/core/connection/v1/connections/${connectionId}`
      );
      const clientId = connData.connection?.client_id;
      if (!clientId) continue;

      const statusData = await fetchJSONWithTimeout(
        `${endpoint}/ibc/core/client/v1/client_status/${clientId}`
      );
      return statusData.status;
    } catch {
      deadEndpoints.add(endpoint);
      continue;
    }
  }

  return 'unknown';
}

// ── State helpers ───────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { assets: [] };
    throw err;
  }
}

// Read-only state lookup. Returns undefined if no entry exists; callers that
// only need to read date/streak fields should use this so we don't pollute
// state.assets with empty {base_denom} placeholders on every iteration.
function findStateAsset(state, baseDenom) {
  return state.assets?.find((a) => a.base_denom === baseDenom);
}

// Create-if-missing variant. Only callers about to write a real value
// (lastDowntimeDate, lastRecoveryDate, etc.) should use this.
function materialiseStateAsset(state, baseDenom) {
  if (!state.assets) state.assets = [];
  let s = state.assets.find((a) => a.base_denom === baseDenom);
  if (!s) {
    s = { base_denom: baseDenom };
    state.assets.push(s);
  }
  return s;
}

/**
 * Apply the flap-vs-fresh-incident rule to lastDowntimeDate / lastRecoveryDate.
 * Mutates stateAsset in place.
 */
function applyDowntimeDateRule(stateAsset, nowIso) {
  const now = new Date(nowIso).getTime();
  if (!stateAsset.lastDowntimeDate) {
    stateAsset.lastDowntimeDate = nowIso;
    return;
  }
  if (!stateAsset.lastRecoveryDate) {
    // continuously unstable; clock keeps running
    return;
  }
  const recoveredAt = new Date(stateAsset.lastRecoveryDate).getTime();
  if (now - recoveredAt <= FLAP_WINDOW_MS) {
    // short flap, preserve original downtime, clear recovery
    delete stateAsset.lastRecoveryDate;
  } else {
    // fresh incident
    stateAsset.lastDowntimeDate = nowIso;
    delete stateAsset.lastRecoveryDate;
  }
}

// ── Halt mutation helpers ────────────────────────────────────────────────────

/** Returns true if this script may safely modify the halt flag based on its
 *  current reason and the shared tooltip_message field. A non-empty
 *  tooltip_message is treated as a curator-owned override that locks all
 *  halt/unstable automation for this asset. */
function canModifyHalt(zoneAsset, reasonField) {
  const currentReason = zoneAsset[reasonField];
  if (currentReason && !OWNED_HALT_REASONS.has(currentReason)) return false;
  if (zoneAsset.tooltip_message) return false;
  return true;
}

function canModifyUnstable(zoneAsset) {
  const currentReason = zoneAsset.osmosis_unstable_reason;
  if (currentReason && !OWNED_UNSTABLE_REASONS.has(currentReason)) return false;
  if (zoneAsset.tooltip_message) return false;
  return true;
}

/**
 * Is this asset curator-locked under a manual halt? True when a curator has
 * taken explicit ownership: the unstable reason is 'manual', either halt
 * reason is 'manual', or a tooltip_message is set (which locks all
 * automation via canModify*). Used to detect chains the curator has fully
 * taken over so new assets that appear on them inherit the same treatment.
 */
function isManuallyLocked(zoneAsset) {
  return (
    zoneAsset.osmosis_unstable_reason === 'manual' ||
    zoneAsset.osmosis_deposit_halt_reason === 'manual' ||
    zoneAsset.osmosis_withdrawal_halt_reason === 'manual' ||
    Boolean(zoneAsset.tooltip_message)
  );
}

/**
 * Build the set of source chains the curator has fully taken over with
 * manual halts, from the PRE-RUN zone state. A chain qualifies when it has
 * at least one listed asset AND every one of its listed assets is
 * manually locked (isManuallyLocked).
 *
 * Why this matters (attack-vector guard): when a bridge or source chain is
 * compromised, a curator halts every known asset manually. But a
 * compromised chain can begin advertising NEW assets in the chain registry.
 * Those flow into the generated assetlist and this script would otherwise
 * auto-create them with the script-owned 'ibc_client'/'bridge_down' reasons,
 * which the same automation will happily auto-CLEAR the moment the client
 * reports Active again, silently relisting an attacker-introduced asset on a
 * still-compromised bridge. Treating new assets on a fully-manual chain as
 * manual too keeps them locked until a human clears them.
 */
function buildManualHaltChains(assets) {
  const byChain = new Map(); // chain_name -> { total, locked }
  for (const a of assets) {
    if (!a.chain_name) continue;
    const c = byChain.get(a.chain_name) ?? { total: 0, locked: 0 };
    c.total += 1;
    if (isManuallyLocked(a)) c.locked += 1;
    byChain.set(a.chain_name, c);
  }
  const fullyManual = new Set();
  for (const [chain, c] of byChain) {
    if (c.total > 0 && c.locked === c.total) fullyManual.add(chain);
  }
  return fullyManual;
}

/**
 * Best-effort classification of *why* an asset is unstable, used by the
 * safety-net paths when we don't have channel-walk evidence in hand.
 * Returns the most specific script-owned reason that can be proved from
 * static state (chain-registry status), and falls back to 'manual' for
 * curator-flipped entries we can't classify any other way.
 *
 * Note: 'ibc_client' is intentionally not returned here. That reason
 * requires positive evidence from the channel walk and should only be
 * set on the bridge-down code path above.
 */
function classifyUnstableReasonForBackfill(chainName) {
  if (getSourceChainStatus(chainName) === 'killed') return 'source_chain_killed';
  return 'manual';
}

/**
 * Backfill osmosis_unstable_reason on an already-unstable asset, and the
 * matching halt reasons when the reason is `source_chain_killed`. Only
 * writes empty fields, and only when the existing reason is empty or is
 * one this script owns (gated by canModify*). 'manual' is treated as a
 * fallback label for curator-flipped entries: it does NOT populate halt
 * reasons, because we have no evidence the curator wanted deposits or
 * withdrawals halted.
 */
function backfillReasons(zoneAsset, reason) {
  if (!zoneAsset.osmosis_unstable_reason && canModifyUnstable(zoneAsset)) {
    zoneAsset.osmosis_unstable_reason = reason;
  }
  if (reason !== 'source_chain_killed') return;
  if (zoneAsset.osmosis_halt_deposits !== true &&
      canModifyHalt(zoneAsset, 'osmosis_deposit_halt_reason')) {
    zoneAsset.osmosis_halt_deposits = true;
    zoneAsset.osmosis_deposit_halt_reason = reason;
  }
  if (zoneAsset.osmosis_halt_withdrawals !== true &&
      canModifyHalt(zoneAsset, 'osmosis_withdrawal_halt_reason')) {
    zoneAsset.osmosis_halt_withdrawals = true;
    zoneAsset.osmosis_withdrawal_halt_reason = reason;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Load zone_assets.json
  let zoneData;
  try {
    zoneData = JSON.parse(fs.readFileSync(zoneAssetsPath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${zoneAssetsPath}: ${err.message}`);
    process.exit(1);
  }

  let frontendData;
  try {
    frontendData = JSON.parse(fs.readFileSync(frontendPath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${frontendPath}: ${err.message}`);
    process.exit(1);
  }

  const state = loadState();

  // Snapshot the pre-run shape so we only write files that actually changed.
  // Combined with the findStateAsset / materialiseStateAsset split below,
  // this guarantees state.json is only rewritten when a real lifecycle
  // decision happened (not just an iteration).
  const zoneBefore = JSON.stringify(zoneData);
  const stateBefore = JSON.stringify(state);

  const zoneChainsByName = new Map();
  try {
    const zc = JSON.parse(fs.readFileSync(zoneChainsPath, 'utf8'));
    for (const chain of zc.chains ?? []) zoneChainsByName.set(chain.chain_name, chain);
  } catch { /* optional */ }

  const chainlistByName = new Map();
  try {
    const cl = JSON.parse(fs.readFileSync(chainlistPath, 'utf8'));
    for (const chain of cl.chains ?? []) chainlistByName.set(chain.chain_name, chain);
  } catch { /* optional */ }

  const zoneByPath = new Map();
  for (const asset of zoneData.assets) {
    if (asset.path) zoneByPath.set(asset.path, asset);
  }

  // Snapshot, from PRE-RUN state, the chains the curator has fully taken
  // over with manual halts. New assets the channel walk discovers on these
  // chains will be created as manual (curator-locked) rather than with the
  // auto-clearable ibc_client/bridge_down reasons. Computed once here, before
  // any mutation, so assets this run appends don't perturb the membership.
  const manualHaltChains = buildManualHaltChains(zoneData.assets);

  // Group frontend IBC assets by Osmosis-side channel id, but record
  // the counterparty (chainName, channelId, port) on each asset entry
  // rather than once per channel. A single Osmosis channel can be shared
  // by multiple asset variants whose counterparty side uses different
  // ports (e.g. plain `transfer` for native denoms vs. `wasm.<contract>`
  // for cw20 wrappers on Secret Network); collapsing them per-channel
  // drops one variant on the floor.
  const channelMap = new Map();
  for (const asset of frontendData.assets ?? []) {
    const ibcMethod = asset.transferMethods?.find((m) => m.type === 'ibc');
    if (!ibcMethod?.chain?.channelId || !ibcMethod?.chain?.path) continue;

    const channelId = ibcMethod.chain.channelId;
    if (!channelMap.has(channelId)) {
      channelMap.set(channelId, { assets: [] });
    }
    channelMap.get(channelId).assets.push({
      chainName: asset.chainName,
      sourceDenom: asset.sourceDenom,
      coinMinimalDenom: asset.coinMinimalDenom,
      symbol: asset.symbol,
      channelId,
      ibcPath: ibcMethod.chain.path,
      counterpartyChainName: ibcMethod.counterparty?.chainName,
      counterpartyChannelId: ibcMethod.counterparty?.channelId,
      counterpartyPort: ibcMethod.counterparty?.port,
    });
  }

  const uniqueChannels = [...channelMap.keys()];
  const totalAssets = [...channelMap.values()].reduce((n, c) => n + c.assets.length, 0);
  console.log(`Checking IBC client + chain status for ${uniqueChannels.length} channels (${totalAssets} IBC assets)...\n`);

  // Phase 1: Osmosis-side IBC client status
  const ibcResults = await processInBatches(
    uniqueChannels,
    CONCURRENCY,
    async (channelId) => {
      try {
        const result = await getClientStatusForChannel(channelId);
        return { channelId, ...result, error: null };
      } catch (err) {
        return {
          channelId,
          status: 'error',
          error: err.message,
          errorKind: err.errorKind ?? categoriseFetchError(err),
        };
      }
    }
  );

  // Hard-fail when the LCD is essentially unusable. If ≥ 90% of channel
  // lookups errored, we can't tell anything from this run and writing a
  // partial state is worse than not running. Emit a per-category breakdown
  // so the operator can tell rate-limit from server-down from timeout.
  const errorBreakdown = {};
  for (const r of ibcResults) {
    if (r.status === 'error') {
      const k = r.errorKind ?? 'unknown';
      errorBreakdown[k] = (errorBreakdown[k] || 0) + 1;
    }
  }
  const totalErrored = Object.values(errorBreakdown).reduce((a, b) => a + b, 0);
  if (totalErrored / ibcResults.length >= 0.9) {
    console.error(
      `\n⛔ Aborting: ${totalErrored}/${ibcResults.length} channel lookups failed; ` +
      `LCD appears unusable. No files written.`
    );
    for (const [k, v] of Object.entries(errorBreakdown)) {
      console.error(`   ${k.padEnd(14)}: ${v}`);
    }
    process.exit(3);
  }

  // Phase 2: counterparty checks for assets we might clear.
  // Key by (counterpartyChainName, counterpartyChannelId, counterpartyPort)
  // since one Osmosis channel can host multiple counterparty triples
  // (e.g. plain transfer vs. wasm-port cw20 wrappers). The status of a
  // given triple is shared across every asset that uses it.
  const cpKey = (chainName, channelId, port) =>
    `${chainName}|${channelId}|${port || 'transfer'}`;

  const cpCheckNeeded = new Map();
  for (const r of ibcResults) {
    if (r.error || r.status !== 'Active') continue;
    const cm = channelMap.get(r.channelId);
    for (const fa of cm.assets) {
      if (zoneByPath.get(fa.ibcPath)?.osmosis_unstable !== true) continue;
      if (!fa.counterpartyChainName || !fa.counterpartyChannelId) continue;
      const key = cpKey(fa.counterpartyChainName, fa.counterpartyChannelId, fa.counterpartyPort);
      if (cpCheckNeeded.has(key)) continue;
      cpCheckNeeded.set(key, {
        chainName: fa.counterpartyChainName,
        channelId: fa.counterpartyChannelId,
        port: fa.counterpartyPort,
      });
    }
  }

  const cpStatuses = new Map();
  if (cpCheckNeeded.size > 0) {
    console.log(`Checking counterparty IBC client for ${cpCheckNeeded.size} counterparty path(s)...\n`);
    const deadEndpoints = new Set();
    const cpResults = await processInBatches(
      [...cpCheckNeeded.entries()],
      CONCURRENCY,
      async ([key, cp]) => {
        const status = await getCounterpartyClientStatus(
          cp.chainName,
          cp.channelId,
          cp.port,
          zoneChainsByName,
          chainlistByName,
          deadEndpoints
        );
        return [key, status];
      }
    );
    for (const [key, status] of cpResults) cpStatuses.set(key, status);
  }

  // Phase 3: apply mutations (collected first, written later so dry-run can short-circuit)
  const mutations = [];
  const nowIso = new Date().toISOString();

  for (const r of ibcResults) {
    const cm = channelMap.get(r.channelId);

    if (r.error) {
      mutations.push({
        kind: 'ibc_error',
        channelId: r.channelId,
        error: r.error,
        errorKind: r.errorKind ?? 'unknown',
      });
      continue;
    }

    const osmosisDown = r.status !== 'Active';

    for (const fa of cm.assets) {
      // Per-asset evaluation, since source chain status is per-chain
      // and counterparty status is per-triple (chain, channel, port).
      // Assets sharing the same Osmosis channel can resolve to different
      // counterparty paths (e.g. cw20 wrappers vs. plain bank denoms).
      const cpStatus = (fa.counterpartyChainName && fa.counterpartyChannelId)
        ? cpStatuses.get(cpKey(fa.counterpartyChainName, fa.counterpartyChannelId, fa.counterpartyPort))
        : undefined; // undefined when no counterparty check was needed for this asset

      const sourceStatus = getSourceChainStatus(fa.chainName);
      const chainKilled = sourceStatus === 'killed';
      const chainLive = sourceStatus === 'live';

      const bridgeDown = osmosisDown || chainKilled;
      const bridgeUp = !osmosisDown && chainLive && (cpStatus === undefined || cpStatus === 'Active');

      const reasonOnDown = chainKilled ? 'source_chain_killed' : 'ibc_client';
      const haltReasonOnDown = chainKilled ? 'source_chain_killed' : 'bridge_down';

      let zoneAsset = zoneByPath.get(fa.ibcPath);
      // Read-only lookup: never creates an empty placeholder. Calls that
      // need to write to state must materialise the entry explicitly.
      const stateAsset = findStateAsset(state, fa.coinMinimalDenom);

      if (bridgeDown) {
        // ── Bridge-down ────────────────────────────────────────────────────
        const isNewEntry = !zoneAsset;
        if (!zoneAsset) {
          zoneAsset = {
            chain_name: fa.chainName,
            base_denom: fa.sourceDenom,
            path: fa.ibcPath,
            _comment: `${fa.symbol} $${fa.symbol}`,
          };
          zoneData.assets.push(zoneAsset);
          zoneByPath.set(fa.ibcPath, zoneAsset);
        }

        // Attack-vector guard: a brand-new asset that first appears on a
        // source chain the curator has already fully manually halted is
        // created manual (curator-locked) rather than with the script-owned
        // ibc_client/bridge_down reasons. Stamping the manual reasons plus a
        // tooltip makes every canModify* gate below short-circuit, so this
        // run leaves it as written AND no future run can auto-clear it on a
        // transient Active reading. A human must clear it deliberately.
        // Pre-existing entries are never converted here — only newly created
        // ones — so this can't silently rewrite a curator's existing choice.
        if (isNewEntry && manualHaltChains.has(fa.chainName)) {
          zoneAsset.osmosis_unstable = true;
          zoneAsset.osmosis_unstable_reason = 'manual';
          zoneAsset.osmosis_halt_deposits = true;
          zoneAsset.osmosis_deposit_halt_reason = 'manual';
          zoneAsset.osmosis_halt_withdrawals = true;
          zoneAsset.osmosis_withdrawal_halt_reason = 'manual';
          zoneAsset.tooltip_message = MANUAL_CHAIN_INHERIT_TOOLTIP;
          applyDowntimeDateRule(
            stateAsset ?? materialiseStateAsset(state, fa.coinMinimalDenom),
            nowIso
          );
          mutations.push({
            kind: 'manual_inherited',
            fa,
            reason: 'manual',
            haltReason: 'manual',
            zoneAsset,
          });
          continue;
        }

        const before = { ...zoneAsset };

        // osmosis_unstable: set the flag, and (back)fill the reason whenever
        // it's missing. The reason can be absent on assets that were manually
        // flagged unstable before this script started writing it, so we
        // populate on transitions AND on already-unstable assets whose
        // reason field is empty. canModifyUnstable still gates against
        // curator-locked entries via tooltip_message.
        if (canModifyUnstable(zoneAsset)) {
          if (zoneAsset.osmosis_unstable !== true) {
            zoneAsset.osmosis_unstable = true;
          }
          if (!zoneAsset.osmosis_unstable_reason) {
            zoneAsset.osmosis_unstable_reason = reasonOnDown;
          }
        }

        // osmosis_halt_deposits
        if (zoneAsset.osmosis_halt_deposits !== true) {
          if (canModifyHalt(zoneAsset, 'osmosis_deposit_halt_reason')) {
            zoneAsset.osmosis_halt_deposits = true;
            zoneAsset.osmosis_deposit_halt_reason = haltReasonOnDown;
          }
        }

        // osmosis_halt_withdrawals
        if (zoneAsset.osmosis_halt_withdrawals !== true) {
          if (canModifyHalt(zoneAsset, 'osmosis_withdrawal_halt_reason')) {
            zoneAsset.osmosis_halt_withdrawals = true;
            zoneAsset.osmosis_withdrawal_halt_reason = haltReasonOnDown;
          }
        }

        // state.lastDowntimeDate via flap-vs-fresh rule
        if (zoneAsset.osmosis_unstable === true) {
          applyDowntimeDateRule(
            stateAsset ?? materialiseStateAsset(state, fa.coinMinimalDenom),
            nowIso
          );
        }

        if (JSON.stringify(before) !== JSON.stringify(zoneAsset)) {
          mutations.push({ kind: 'bridge_down', fa, reason: reasonOnDown, haltReason: haltReasonOnDown, zoneAsset });
        }
      } else if (bridgeUp) {
        // ── Bridge-up ──────────────────────────────────────────────────────
        if (!zoneAsset) continue;

        const before = { ...zoneAsset };
        let cleared = false;

        if (zoneAsset.osmosis_halt_deposits === true &&
            canModifyHalt(zoneAsset, 'osmosis_deposit_halt_reason')) {
          delete zoneAsset.osmosis_halt_deposits;
          delete zoneAsset.osmosis_deposit_halt_reason;
          cleared = true;
        }

        if (zoneAsset.osmosis_halt_withdrawals === true &&
            canModifyHalt(zoneAsset, 'osmosis_withdrawal_halt_reason')) {
          delete zoneAsset.osmosis_halt_withdrawals;
          delete zoneAsset.osmosis_withdrawal_halt_reason;
          cleared = true;
        }

        if (cleared) {
          // Record recovery. Keep osmosis_unstable populated so the 90-day
          // window stays armed via the persistent lastDowntimeDate.
          materialiseStateAsset(state, fa.coinMinimalDenom).lastRecoveryDate = nowIso;

          // If the resulting entry is a thin auto-added one, remove it entirely.
          if (isThinEntry(zoneAsset)) {
            zoneData.assets = zoneData.assets.filter((a) => a !== zoneAsset);
            zoneByPath.delete(fa.ibcPath);
            mutations.push({ kind: 'thin_removed', fa, zoneAsset: before });
          } else {
            mutations.push({ kind: 'bridge_up', fa, zoneAsset });
          }
        }
      } else {
        // Unconfirmed (e.g. counterparty status unknown, source chain status unknown).
        // Safety net for already-unstable assets that the channel walk could not
        // confirm: populate lastDowntimeDate (so the 90-day clock has an anchor)
        // and best-effort backfill the unstable reason. Halt fields are backfilled
        // on the same basis when source chain is killed.
        if (zoneAsset?.osmosis_unstable === true) {
          if (!stateAsset?.lastDowntimeDate) {
            materialiseStateAsset(state, fa.coinMinimalDenom).lastDowntimeDate = nowIso;
          }
          const backfillReason = classifyUnstableReasonForBackfill(fa.chainName);
          backfillReasons(zoneAsset, backfillReason);
          mutations.push({
            kind: 'safety_net',
            fa,
            reason: backfillReason,
            haltReason: backfillReason === 'source_chain_killed' ? backfillReason : undefined,
          });
        }
      }
    }
  }

  // ── Safety-net pass for zone_assets we never iterated ────────────────────────
  // Some assets, particularly killed-chain ones whose source chains have lost
  // their transferMethods during generation, never appear in the channel walk.
  // For these, apply the manual-flip safety net so curators get a populated
  // lastDowntimeDate (anchoring the 90-day clock) even without channel data.
  //
  // State entries are keyed by coinMinimalDenom (matching update_assetlist_state.mjs
  // and every other lifecycle script). For IBC assets we compute that hash from
  // the path, since the frontend assetlist has no entry for these.
  const visitedPaths = new Set();
  for (const cm of channelMap.values()) {
    for (const fa of cm.assets) visitedPaths.add(fa.ibcPath);
  }
  for (const za of zoneData.assets) {
    if (za.osmosis_unstable !== true) continue;
    if (!za.path) continue; // non-IBC entries are not handled here
    if (visitedPaths.has(za.path)) continue;

    const coinMinimalDenom = await calculateIbcHash(za.path);
    const stateAsset = findStateAsset(state, coinMinimalDenom);
    const needsDowntimeDate = !stateAsset?.lastDowntimeDate;
    const needsReasonBackfill = !za.osmosis_unstable_reason;

    if (!needsDowntimeDate && !needsReasonBackfill) continue;

    if (needsDowntimeDate) {
      materialiseStateAsset(state, coinMinimalDenom).lastDowntimeDate = nowIso;
    }
    const backfillReason = classifyUnstableReasonForBackfill(za.chain_name);
    backfillReasons(za, backfillReason);

    mutations.push({
      kind: 'safety_net',
      reason: backfillReason,
      haltReason: backfillReason === 'source_chain_killed' ? backfillReason : undefined,
      fa: {
        chainName: za.chain_name,
        symbol: za._comment ?? za.base_denom,
        ibcPath: za.path,
        sourceDenom: za.base_denom,
        coinMinimalDenom,
      },
    });
  }

  // ── Mutation cap ────────────────────────────────────────────────────────────
  const affectedChains = new Set(
    mutations
      .filter((m) => m.fa)
      .map((m) => m.fa.chainName)
  );
  if (affectedChains.size > MAX_CHAINS_PER_RUN && !force && !dryRun) {
    console.error(
      `\n⛔ Mutation cap exceeded: would touch ${affectedChains.size} distinct source chains ` +
      `(threshold ${MAX_CHAINS_PER_RUN}). Re-run with --force after manual review, or with ` +
      `--dry-run to inspect the diff.`
    );
    process.exit(2);
  }

  // ── Dry-run report ──────────────────────────────────────────────────────────
  if (dryRun) {
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(
      reportsDir,
      `bridge_state_dry_run_${nowIso.slice(0, 10)}.md`
    );
    const lines = [
      `# Bridge-state dry-run, ${nowIso}`,
      ``,
      `Channels checked: ${uniqueChannels.length}`,
      `Mutations: ${mutations.length}`,
      `Distinct source chains affected: ${affectedChains.size}`,
      ``,
      `| Kind | Chain | Symbol | Reason | Halt reason |`,
      `|------|-------|--------|--------|-------------|`,
    ];
    for (const m of mutations) {
      if (!m.fa) continue;
      lines.push(
        `| ${m.kind} | ${m.fa.chainName} | ${m.fa.symbol} | ${m.reason ?? '-'} | ${m.haltReason ?? '-'} |`
      );
    }
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
    console.log(`\n📝 Dry-run report: ${reportPath}`);
    console.log(`(no files were modified)`);
    return;
  }

  // ── Write ───────────────────────────────────────────────────────────────────
  const zoneChanged = JSON.stringify(zoneData) !== zoneBefore;
  const stateChanged = JSON.stringify(state) !== stateBefore;
  if (zoneChanged) {
    fs.writeFileSync(zoneAssetsPath, JSON.stringify(zoneData, null, 2) + '\n', 'utf8');
    console.log(`✓ Updated ${zoneAssetsPath}`);
  }
  if (stateChanged) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    console.log(`✓ Updated ${statePath}`);
  }
  if (!zoneChanged && !stateChanged) {
    console.log('No changes needed.');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const byKind = {};
  const byErrorKind = {};
  for (const m of mutations) {
    byKind[m.kind] = (byKind[m.kind] || 0) + 1;
    if (m.kind === 'ibc_error' && m.errorKind) {
      byErrorKind[m.errorKind] = (byErrorKind[m.errorKind] || 0) + 1;
    }
  }
  console.log('\n' + '='.repeat(70));
  console.log('  BRIDGE-STATE CHECK SUMMARY');
  console.log('='.repeat(70));
  for (const [kind, count] of Object.entries(byKind)) {
    console.log(`  ${kind.padEnd(20)}: ${count}`);
  }
  if (Object.keys(byErrorKind).length > 0) {
    console.log('  error breakdown:');
    for (const [k, v] of Object.entries(byErrorKind)) {
      console.log(`    ${k.padEnd(18)}: ${v}`);
    }
  }
  console.log(`  distinct source chains touched: ${affectedChains.size}`);
  console.log('='.repeat(70));

  // Machine-readable summary. manual_inherited assets are a flag event
  // (a new asset locked down), so they roll into NEWLY_FLAGGED and also get
  // their own counter for visibility in the PR summary.
  console.log(`\nIBC_NEWLY_FLAGGED=${(byKind.bridge_down ?? 0) + (byKind.manual_inherited ?? 0)}`);
  console.log(`IBC_NEWLY_CLEARED=${(byKind.bridge_up ?? 0) + (byKind.thin_removed ?? 0)}`);
  console.log(`IBC_MANUAL_INHERITED=${byKind.manual_inherited ?? 0}`);
  console.log(`IBC_ERRORS=${byKind.ibc_error ?? 0}`);
  console.log(`AFFECTED_CHAINS=${affectedChains.size}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
