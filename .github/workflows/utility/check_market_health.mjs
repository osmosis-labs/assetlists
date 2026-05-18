// Purpose:
//   Independent market-health track. Daily cron. For each verified non-disabled
//   asset that isn't already unstable, run a market-health check; on 7 consecutive
//   failing daily runs, flag it unstable with reason="market" and stamp
//   state.lastDowntimeDate. Owns recovery for market-unstable assets too:
//     • 1 consecutive passing run → clear osmosis_halt_deposits if reason
//       is extended_unstable_market (and no tooltip).
//     • 7 consecutive passing runs → clear osmosis_unstable AND wipe state
//       history fields, only if osmosis_unstable_reason === "market".
//
//   Reason-vocabulary contract: this script owns reasons {market}.
//
// Usage:
//   node check_market_health.mjs [<zone_name>] [--dry-run] [--force]

import * as fs from 'fs';
import * as path from 'path';

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

const MAX_CHAINS_PER_RUN = 10;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const positional = args.filter((a) => !a.startsWith('--'));
const zoneBasePath = positional[0] || 'osmosis-1';

const zonePath = path.join('..', '..', '..', zoneBasePath);
const filePrefix = zoneBasePath.split('-')[0];
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
const frontendPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');
const statePath = path.join(zonePath, 'generated', 'state', 'state.json');
const reportsDir = path.join(zonePath, 'generated', 'reports');

const NUMIA_TOKENS_URL = 'https://public-osmosis-api.numia.xyz/tokens/v2/all';

async function fetchNumia() {
  const controller = new AbortController();
  const timeoutMs = 10000; // 10 second timeout
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(NUMIA_TOKENS_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      throw new Error(`Numia returned HTTP ${res.status}; aborting (hard-fail policy)`);
    }
    const data = await res.json();
    const byDenom = new Map();
    for (const t of data) {
      if (!t.denom) continue;
      byDenom.set(t.denom, {
        liquidity: Number(t.liquidity ?? 0),
        // Try several plausible field names; default to 0 if absent.
        volume24h: Number(t.volume_24h ?? t.volume_24h_usd ?? t.volume24h ?? 0),
      });
    }
    return byDenom;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${NUMIA_TOKENS_URL} timed out after 10s (hard-fail policy)`);
    }
    throw new Error(`Failed to fetch from ${NUMIA_TOKENS_URL}: ${err.message}`);
  }
}

function loadJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

function getStateAsset(state, baseDenom) {
  if (!state.assets) state.assets = [];
  let s = state.assets.find((a) => a.base_denom === baseDenom);
  if (!s) {
    s = { base_denom: baseDenom };
    state.assets.push(s);
  }
  return s;
}

function isAlloyed(asset) {
  return (
    /\/alloyed\//.test(asset.coinMinimalDenom ?? '') ||
    asset.isAlloyed === true
  );
}

function isPostGrace(stateAsset, nowMs) {
  const listingDate = stateAsset.listingDate ?? (stateAsset.legacyAsset ? LEGACY_LISTING_DATE : null);
  if (!listingDate) return true; // unknown → behave post-grace (conservative)
  return nowMs - new Date(listingDate).getTime() >= GRACE_MS;
}

async function main() {
  const zoneData = loadJSON(zoneAssetsPath);
  const frontendData = loadJSON(frontendPath);
  const state = loadJSON(statePath, { assets: [] });

  // Snapshot the pre-run shape so we only write files that actually changed.
  // getStateAsset's create-on-miss behaviour can otherwise grow state.json
  // with empty {base_denom} records every run, producing a dirty working tree
  // even when no real lifecycle decision happened.
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

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const mutations = [];

  for (const asset of frontendData.assets ?? []) {
    if (!asset.verified) continue;
    if (isAlloyed(asset)) continue;
    if (asset.disabled) continue;
    if (asset.preview) continue;

    const zoneKey = `${asset.chainName}:${asset.sourceDenom}`;
    const zoneAsset = zoneByOrigin.get(zoneKey);
    if (!zoneAsset) continue;

    const stateAsset = getStateAsset(state, asset.coinMinimalDenom);
    const market = numia.get(asset.coinMinimalDenom);
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
        const streak = (stateAsset.marketHealthStreak ?? 0) + 1;
        stateAsset.marketHealthStreak = streak;
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
        if (stateAsset.marketHealthStreak) {
          stateAsset.marketHealthStreak = 0;
          mutations.push({ kind: 'streak_reset', asset: asset.symbol });
        }
      }
    } else if (zoneAsset.osmosis_unstable_reason === 'market') {
      // ── Currently market-unstable: track recovery ──
      if (passing) {
        const rstreak = (stateAsset.marketHealthRecoveryStreak ?? 0) + 1;
        stateAsset.marketHealthRecoveryStreak = rstreak;

        // 1-day clear of extended-market-driven halt
        if (
          rstreak === 1 &&
          zoneAsset.osmosis_halt_deposits === true &&
          zoneAsset.osmosis_deposit_halt_reason === 'extended_unstable_market' &&
          !zoneAsset.tooltip_message
        ) {
          delete zoneAsset.osmosis_halt_deposits;
          delete zoneAsset.osmosis_deposit_halt_reason;
          // Includes `chain` so this counts toward the mutation cap. A Numia
          // glitch that resolves and bulk-passes many failing assets in one
          // run would otherwise silently clear all their halts.
          mutations.push({ kind: 'extended_halt_cleared', asset: asset.symbol, chain: asset.chainName });
        }

        // Full recovery clears osmosis_unstable. Guarded by reason==='market'
        // (above, line 186) AND tooltip_message empty here, mirroring the
        // setting-path curator-lock contract.
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
        if (stateAsset.marketHealthRecoveryStreak) {
          stateAsset.marketHealthRecoveryStreak = 0;
          mutations.push({ kind: 'recovery_reset', asset: asset.symbol });
        }
      }
    }
    // If unstable but reason !== "market", this script does nothing; the flag
    // is owned by check_ibc_clients or manual.
  }

  // ── Mutation cap (per source chain) ─────────────────────────────────────────
  // streak_increment / streak_reset / recovery_reset / market_missing are
  // informational; they don't write halt or unstable flags.
  const INFO_KINDS = new Set(['streak_increment', 'streak_reset', 'recovery_reset', 'market_missing']);
  const affectedChains = new Set(
    mutations
      .filter((m) => m.chain && !INFO_KINDS.has(m.kind))
      .map((m) => m.chain)
  );
  if (affectedChains.size > MAX_CHAINS_PER_RUN && !force && !dryRun) {
    console.error(
      `\n⛔ Mutation cap exceeded: would touch ${affectedChains.size} chains ` +
      `(threshold ${MAX_CHAINS_PER_RUN}). Re-run with --force or --dry-run.`
    );
    process.exit(2);
  }

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
