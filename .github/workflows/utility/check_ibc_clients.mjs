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
//   node check_ibc_clients.mjs [<zone_name>] [--dry-run] [--force]
//   Example: node check_ibc_clients.mjs osmosis-1
//   Example: node check_ibc_clients.mjs osmosis-1 --dry-run
//
//   --dry-run : no writes; emits markdown report; exit 0.
//   --force   : bypass the mutation cap (>10 distinct source chains touched).

import * as fs from 'fs';
import * as path from 'path';
import { calculateIbcHash } from './assetlist_functions.mjs';

const LCD = "https://lcd.osmosis.zone";
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
const positional = args.filter((a) => !a.startsWith('--'));
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
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

async function getCounterpartyClientStatus(chainName, channelId, zoneChainsByName, chainlistByName, deadEndpoints) {
  if (!chainName || !channelId) return 'unknown';

  const endpoints = getCounterpartyRestEndpoints(chainName, zoneChainsByName, chainlistByName);
  if (endpoints === null) return 'killed';
  if (endpoints.length === 0) return 'unknown';

  for (const endpoint of endpoints.slice(0, COUNTERPARTY_MAX_ENDPOINTS)) {
    if (deadEndpoints.has(endpoint)) continue;

    try {
      const channelData = await fetchJSONWithTimeout(
        `${endpoint}/ibc/core/channel/v1/channels/${channelId}/ports/transfer`
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

function getOrCreateStateAsset(state, baseDenom) {
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
  // getOrCreateStateAsset's create-on-miss behaviour can otherwise grow
  // state.json with empty {base_denom} records every run, producing a dirty
  // working tree even when no real lifecycle decision happened.
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

  // Group frontend IBC assets by channel.
  const channelMap = new Map();
  for (const asset of frontendData.assets ?? []) {
    const ibcMethod = asset.transferMethods?.find((m) => m.type === 'ibc');
    if (!ibcMethod?.chain?.channelId || !ibcMethod?.chain?.path) continue;

    const channelId = ibcMethod.chain.channelId;
    if (!channelMap.has(channelId)) {
      channelMap.set(channelId, {
        assets: [],
        counterpartyChainName: ibcMethod.counterparty?.chainName,
        counterpartyChannelId: ibcMethod.counterparty?.channelId,
      });
    }
    channelMap.get(channelId).assets.push({
      chainName: asset.chainName,
      sourceDenom: asset.sourceDenom,
      coinMinimalDenom: asset.coinMinimalDenom,
      symbol: asset.symbol,
      channelId,
      ibcPath: ibcMethod.chain.path,
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
        return { channelId, status: 'error', error: err.message };
      }
    }
  );

  // Phase 2: counterparty checks for channels we might clear
  const cpCheckNeeded = new Map();
  for (const r of ibcResults) {
    if (r.error || r.status !== 'Active') continue;
    const cm = channelMap.get(r.channelId);
    const hasUnstableAssets = cm.assets.some(
      (fa) => zoneByPath.get(fa.ibcPath)?.osmosis_unstable === true
    );
    if (hasUnstableAssets && cm.counterpartyChainName && cm.counterpartyChannelId) {
      cpCheckNeeded.set(r.channelId, cm);
    }
  }

  const cpStatuses = new Map();
  if (cpCheckNeeded.size > 0) {
    console.log(`Checking counterparty IBC client for ${cpCheckNeeded.size} channel(s)...\n`);
    const deadEndpoints = new Set();
    const cpResults = await processInBatches(
      [...cpCheckNeeded.entries()],
      CONCURRENCY,
      async ([channelId, cm]) => {
        const status = await getCounterpartyClientStatus(
          cm.counterpartyChainName,
          cm.counterpartyChannelId,
          zoneChainsByName,
          chainlistByName,
          deadEndpoints
        );
        return [channelId, status];
      }
    );
    for (const [channelId, status] of cpResults) cpStatuses.set(channelId, status);
  }

  // Phase 3: apply mutations (collected first, written later so dry-run can short-circuit)
  const mutations = [];
  const nowIso = new Date().toISOString();

  for (const r of ibcResults) {
    const cm = channelMap.get(r.channelId);

    if (r.error) {
      mutations.push({ kind: 'ibc_error', channelId: r.channelId, error: r.error });
      continue;
    }

    const osmosisDown = r.status !== 'Active';
    const cpStatus = cpStatuses.get(r.channelId); // undefined if no unstable assets

    for (const fa of cm.assets) {
      // Per-asset evaluation, since source chain status is per-chain.
      const sourceStatus = getSourceChainStatus(fa.chainName);
      const chainKilled = sourceStatus === 'killed';
      const chainLive = sourceStatus === 'live';

      const bridgeDown = osmosisDown || chainKilled;
      const bridgeUp = !osmosisDown && chainLive && (cpStatus === undefined || cpStatus === 'Active');

      const reasonOnDown = chainKilled ? 'source_chain_killed' : 'ibc_client';
      const haltReasonOnDown = chainKilled ? 'source_chain_killed' : 'bridge_down';

      let zoneAsset = zoneByPath.get(fa.ibcPath);
      const stateAsset = getOrCreateStateAsset(state, fa.coinMinimalDenom);

      if (bridgeDown) {
        // ── Bridge-down ────────────────────────────────────────────────────
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

        const before = { ...zoneAsset };

        // osmosis_unstable
        if (zoneAsset.osmosis_unstable !== true) {
          if (canModifyUnstable(zoneAsset)) {
            zoneAsset.osmosis_unstable = true;
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
          applyDowntimeDateRule(stateAsset, nowIso);
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
          stateAsset.lastRecoveryDate = nowIso;

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
        // Manual-flip safety net: if marked unstable without a downtime date, populate one.
        if (zoneAsset?.osmosis_unstable === true && !stateAsset.lastDowntimeDate) {
          stateAsset.lastDowntimeDate = nowIso;
          mutations.push({ kind: 'safety_net', fa });
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
    const stateAsset = getOrCreateStateAsset(state, coinMinimalDenom);
    if (!stateAsset.lastDowntimeDate) {
      stateAsset.lastDowntimeDate = nowIso;
      mutations.push({
        kind: 'safety_net',
        fa: {
          chainName: za.chain_name,
          symbol: za._comment ?? za.base_denom,
          ibcPath: za.path,
          sourceDenom: za.base_denom,
          coinMinimalDenom,
        },
      });
    }
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
  for (const m of mutations) {
    byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  }
  console.log('\n' + '='.repeat(70));
  console.log('  BRIDGE-STATE CHECK SUMMARY');
  console.log('='.repeat(70));
  for (const [kind, count] of Object.entries(byKind)) {
    console.log(`  ${kind.padEnd(20)}: ${count}`);
  }
  console.log(`  distinct source chains touched: ${affectedChains.size}`);
  console.log('='.repeat(70));

  // Machine-readable summary
  console.log(`\nIBC_NEWLY_FLAGGED=${byKind.bridge_down ?? 0}`);
  console.log(`IBC_NEWLY_CLEARED=${(byKind.bridge_up ?? 0) + (byKind.thin_removed ?? 0)}`);
  console.log(`IBC_ERRORS=${byKind.ibc_error ?? 0}`);
  console.log(`AFFECTED_CHAINS=${affectedChains.size}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
