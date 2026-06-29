// Purpose:
//   Independent market-health track. Daily cron. For each verified non-disabled
//   asset that isn't already unstable, run a market-health check; on 7 consecutive
//   failing daily runs, flag it unstable with reason="market" and stamp
//   state.lastDowntimeDate. Owns recovery for market-unstable assets too:
//     • clear osmosis_halt_deposits (reason extended_unstable_market, no
//       tooltip) on the first passing run where SQS on-chain liquidity ALSO
//       confirms recovery (cross-source guard; see canClearExtendedHalt).
//     • 7 consecutive passing runs → clear osmosis_unstable AND wipe state
//       history fields, only if osmosis_unstable_reason === "market".
//
//   Reason-vocabulary contract: this script owns reasons {market}.
//
// Usage:
//   node check_market_health.mjs [<zone_name>] [--dry-run]

import * as fs from 'fs';
import * as path from 'path';

import {
  canClearExtendedHalt,
  fetchAlloyConstituentMap,
  fetchNumia,
  fetchSqsLiquidityMap,
  findStateAsset,
  loadJSON,
  materialiseStateAsset,
  resolveMarket,
} from './lifecycle_helpers.mjs';

const LOW_LIQUIDITY_USD = 1000;        // matches MIN_LIQUIDITY_USD elsewhere
const LOW_VOLUME_24H_USD = 100;
const REQUIRED_CONSECUTIVE_RUNS = 7;
const RECOVERY_RUNS_TO_CLEAR_UNSTABLE = 7;
// Post-listing grace period: assets within this window from their listing
// date don't accumulate streak.
const GRACE_DAYS = 23;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;
// Sentinel listing date used for assets without one (legacy assets).
const LEGACY_LISTING_DATE = '2022-01-01T00:00:00.000Z';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const zoneBasePath = positional[0] || 'osmosis-1';

const zonePath = path.join('..', '..', '..', zoneBasePath);
const filePrefix = zoneBasePath.split('-')[0];
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
const frontendPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');
const statePath = path.join(zonePath, 'generated', 'state', 'state.json');
const reportsDir = path.join(zonePath, 'generated', 'reports');

function isPostGrace(stateAsset, nowMs) {
  // stateAsset may be undefined for assets that have never been tracked yet.
  // No listing date known → behave post-grace (conservative).
  const listingDate = stateAsset?.listingDate ?? (stateAsset?.legacyAsset ? LEGACY_LISTING_DATE : null);
  if (!listingDate) return true;
  return nowMs - new Date(listingDate).getTime() >= GRACE_MS;
}

async function main() {
  const zoneData = loadJSON(zoneAssetsPath);
  const frontendData = loadJSON(frontendPath);
  const state = loadJSON(statePath, { assets: [] });

  // Snapshot the pre-run shape so we only write files that actually changed.
  // Combined with the findStateAsset / materialiseStateAsset split below,
  // this guarantees state.json is only rewritten when a real lifecycle
  // decision happened (not just an iteration).
  const zoneBefore = JSON.stringify(zoneData);
  const stateBefore = JSON.stringify(state);

  // Index zone by (chain_name, base_denom), the canonical join into zone_assets.
  // Each zone_asset's coinMinimalDenom is computed during generate; we'll match
  // via the frontend's existing coinMinimalDenom -> zone_asset chain_name+base_denom join.
  const zoneByOrigin = new Map();
  for (const a of zoneData.assets) {
    zoneByOrigin.set(`${a.chain_name}:${a.base_denom}`, a);
  }

  const numia = await fetchNumia();

  // Build the set of alloyed coinMinimalDenoms from the frontend assetlist so
  // fetchAlloyConstituentMap can intersect SQS pool composition against them.
  // Then resolve constituent -> alloy denom for every variant currently
  // sitting in an alloy pool.
  const alloyedDenomSet = new Set(
    (frontendData.assets ?? [])
      .filter((a) => a.isAlloyed)
      .map((a) => a.coinMinimalDenom)
  );
  const constituentToAlloy = await fetchAlloyConstituentMap(alloyedDenomSet);

  // On-chain liquidity per denom, the independent second source the extended-
  // halt clearing path cross-checks against Numia. Empty on SQS error → clears
  // fail closed (halt stays).
  const sqsLiquidityByDenom = await fetchSqsLiquidityMap();

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const mutations = [];

  for (const asset of frontendData.assets ?? []) {
    if (!asset.verified) continue;
    if (asset.disabled) continue;
    if (asset.preview) continue;

    const zoneKey = `${asset.chainName}:${asset.sourceDenom}`;
    const zoneAsset = zoneByOrigin.get(zoneKey);
    if (!zoneAsset) continue;

    // Read-only lookup; never creates a placeholder. We only materialise the
    // entry on the exact lines that write to it, so state.json doesn't drift
    // every run.
    let stateAsset = findStateAsset(state, asset.coinMinimalDenom);
    const writeState = () => {
      if (!stateAsset) stateAsset = materialiseStateAsset(state, asset.coinMinimalDenom);
      return stateAsset;
    };

    // Alloy-aware market lookup: constituents inherit max(self, alloy).
    // See lifecycle_helpers.resolveMarket.
    const market = resolveMarket(numia, constituentToAlloy, asset.coinMinimalDenom);
    const marketMissing = !market;
    const failing =
      !marketMissing &&
      market.liquidity < LOW_LIQUIDITY_USD &&
      market.volume24h < LOW_VOLUME_24H_USD;
    const passing = !marketMissing && !failing;

    if (marketMissing) {
      mutations.push({ kind: 'market_missing', asset: asset.symbol, denom: asset.coinMinimalDenom });
      continue; // don't accumulate streak when we have no data
    }

    if (!zoneAsset.osmosis_unstable) {
      // ── Not currently unstable: count failing-streak toward flagging ──
      if (!isPostGrace(stateAsset, nowMs)) continue;
      // Curator lock: any non-empty tooltip_message blocks the flagging path,
      // matching the contract used by the recovery path below and by
      // check_ibc_clients's canModifyUnstable().
      if (zoneAsset.tooltip_message) continue;
      if (failing) {
        const streak = (stateAsset?.marketHealthStreak ?? 0) + 1;
        writeState().marketHealthStreak = streak;
        if (streak >= REQUIRED_CONSECUTIVE_RUNS) {
          zoneAsset.osmosis_unstable = true;
          zoneAsset.osmosis_unstable_reason = 'market';
          stateAsset.lastDowntimeDate = nowIso;
          stateAsset.marketHealthStreak = 0;
          mutations.push({ kind: 'market_flagged', asset: asset.symbol, chain: asset.chainName });
        } else {
          // Informational only; not counted toward the mutation cap.
          mutations.push({ kind: 'streak_increment', asset: asset.symbol, streak });
        }
      } else if (passing) {
        if (stateAsset?.marketHealthStreak) {
          stateAsset.marketHealthStreak = 0;
          mutations.push({ kind: 'streak_reset', asset: asset.symbol });
        }
      }
    } else if (zoneAsset.osmosis_unstable_reason === 'market') {
      // ── Currently market-unstable: track recovery ──
      if (passing) {
        const rstreak = (stateAsset?.marketHealthRecoveryStreak ?? 0) + 1;
        writeState().marketHealthRecoveryStreak = rstreak;

        // Clear the extended-market-driven halt on the first run where BOTH
        // sources confirm recovery. Cross-source guarded: Numia "passing"
        // (this branch) is not enough on its own — SQS must independently
        // confirm on-chain liquidity >= the floor. This blocks a clear driven
        // by a phantom Numia liquidity reading for an asset whose real pool is
        // near-empty. Fail-closed when SQS is missing.
        //
        // `rstreak >= 1` (rather than `=== 1`) so that if SQS withheld
        // confirmation on the first passing run, a later run where SQS agrees
        // can still clear the deposit halt early, instead of waiting for the
        // full 7-run recovery to clear it as a side effect. The
        // `osmosis_halt_deposits === true` guard keeps this idempotent.
        if (
          rstreak >= 1 &&
          zoneAsset.osmosis_halt_deposits === true &&
          zoneAsset.osmosis_deposit_halt_reason === 'extended_unstable_market' &&
          !zoneAsset.tooltip_message &&
          canClearExtendedHalt({
            market,
            sqsLiquidity: sqsLiquidityByDenom.get(asset.coinMinimalDenom),
            lowLiquidityUsd: LOW_LIQUIDITY_USD,
            lowVolumeUsd: LOW_VOLUME_24H_USD,
          })
        ) {
          delete zoneAsset.osmosis_halt_deposits;
          delete zoneAsset.osmosis_deposit_halt_reason;
          // Includes `chain` so this counts toward the mutation cap. A Numia
          // glitch that resolves and bulk-passes many failing assets in one
          // run would otherwise silently clear all their halts.
          mutations.push({ kind: 'extended_halt_cleared', asset: asset.symbol, chain: asset.chainName });
        }

        // Full recovery clears osmosis_unstable. Guarded by reason==='market'
        // (above) AND tooltip_message empty here, mirroring the setting-path
        // curator-lock contract.
        if (
          rstreak >= RECOVERY_RUNS_TO_CLEAR_UNSTABLE &&
          !zoneAsset.tooltip_message
        ) {
          delete zoneAsset.osmosis_unstable;
          delete zoneAsset.osmosis_unstable_reason;
          delete stateAsset.lastDowntimeDate;
          delete stateAsset.lastRecoveryDate;
          delete stateAsset.marketHealthStreak;
          delete stateAsset.marketHealthRecoveryStreak;
          mutations.push({ kind: 'market_recovered', asset: asset.symbol, chain: asset.chainName });
        }
      } else if (failing) {
        if (stateAsset?.marketHealthRecoveryStreak) {
          stateAsset.marketHealthRecoveryStreak = 0;
          mutations.push({ kind: 'recovery_reset', asset: asset.symbol });
        }
      }
    }
    // If unstable but reason !== "market", this script does nothing; the flag
    // is owned by check_ibc_clients or manual.
  }

  // streak_increment / streak_reset / recovery_reset / market_missing are
  // informational; they don't write halt or unstable flags.
  const INFO_KINDS = new Set(['streak_increment', 'streak_reset', 'recovery_reset', 'market_missing']);
  const affectedChains = new Set(
    mutations
      .filter((m) => m.chain && !INFO_KINDS.has(m.kind))
      .map((m) => m.chain)
  );

  if (dryRun) {
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(
      reportsDir,
      `market_health_dry_run_${nowIso.slice(0, 10)}.md`
    );
    const lines = [
      `# Market-health dry-run, ${nowIso}`,
      ``,
      `Mutations: ${mutations.length}`,
      `Distinct source chains affected: ${affectedChains.size}`,
      ``,
      `| Kind | Asset | Chain |`,
      `|------|-------|-------|`,
    ];
    for (const m of mutations) {
      lines.push(`| ${m.kind} | ${m.asset ?? '-'} | ${m.chain ?? '-'} |`);
    }
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
    console.log(`\n📝 Dry-run report: ${reportPath}`);
    return;
  }

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

  const byKind = {};
  for (const m of mutations) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  console.log('\n' + '='.repeat(70));
  console.log('  MARKET-HEALTH SUMMARY');
  console.log('='.repeat(70));
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`  ${k.padEnd(28)}: ${v}`);
  }
  console.log(`  distinct chains touched   : ${affectedChains.size}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
