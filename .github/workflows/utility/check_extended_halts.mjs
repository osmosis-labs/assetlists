// Purpose:
//   60-day extended deposit halt + planned-shutdown halt. Daily cron, runs
//   after check_ibc_clients and check_market_health. Two independent triggers,
//   both write osmosis_halt_deposits=true:
//
//     • 60 days since state.lastDowntimeDate AND osmosis_unstable=true AND
//       market check still failing → halt_deposits with reason
//       "extended_unstable_market".
//
//     • planned_shutdown_date within 14 days → halt_deposits with reason
//       "planned_shutdown".
//
//   Reason-vocabulary contract: this script owns reasons
//   {extended_unstable_market, planned_shutdown}. Clearing rules:
//     • extended_unstable_market: cleared on a single passing market run.
//       (Note: check_market_health also implements this clearing path for
//       the market-recovery flow; both are safe because they're guarded by
//       the same reason check.)
//     • planned_shutdown: cleared when planned_shutdown_date is absent or
//       > 14 days in the future.
//
// Usage:
//   node check_extended_halts.mjs [<zone_name>] [--dry-run] [--force]

import * as fs from 'fs';
import * as path from 'path';
import { calculateIbcHash } from './assetlist_functions.mjs';

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const SHUTDOWN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const LOW_LIQUIDITY_USD = 1000;
const LOW_VOLUME_24H_USD = 100;
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

async function main() {
  const zoneData = loadJSON(zoneAssetsPath);
  const frontendData = loadJSON(frontendPath);
  const state = loadJSON(statePath, { assets: [] });
  const numia = await fetchNumia();

  const zoneByOrigin = new Map();
  for (const a of zoneData.assets) {
    zoneByOrigin.set(`${a.chain_name}:${a.base_denom}`, a);
  }

  // Build the evaluation list. For every zone_asset that's IBC (has a path),
  // compute its coinMinimalDenom via the same IBC hash the generator uses.
  // This lets us iterate the canonical key even when an asset is missing
  // from the frontend (killed-chain case).
  const frontendBySymbol = new Map();
  for (const asset of frontendData.assets ?? []) {
    frontendBySymbol.set(asset.coinMinimalDenom, asset);
  }

  const evaluations = [];
  for (const za of zoneData.assets) {
    if (!za.path) continue; // skip non-IBC entries; they aren't bridged
    const coinMinimalDenom = await calculateIbcHash(za.path);
    const feAsset = frontendBySymbol.get(coinMinimalDenom);
    evaluations.push({
      coinMinimalDenom,
      chainName: za.chain_name,
      symbol: feAsset?.symbol ?? za._comment ?? za.base_denom,
      zoneAsset: za,
    });
  }

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const mutations = [];

  for (const ev of evaluations) {
    const { coinMinimalDenom, chainName, symbol, zoneAsset } = ev;

    const stateAsset = state.assets?.find(
      (a) => a.base_denom === coinMinimalDenom
    );

    // ── Trigger A: extended unstable + failing market ───────────────────────
    // Curator lock: any non-empty tooltip_message blocks automation. Same
    // contract as the clearing path below and check_ibc_clients's
    // canModifyHalt().
    if (
      zoneAsset.osmosis_unstable === true &&
      stateAsset?.lastDowntimeDate &&
      zoneAsset.osmosis_halt_deposits !== true &&
      !zoneAsset.tooltip_message
    ) {
      const downtimeMs = nowMs - new Date(stateAsset.lastDowntimeDate).getTime();
      if (downtimeMs >= SIXTY_DAYS_MS) {
        const market = numia.get(coinMinimalDenom);
        const failing =
          !!market &&
          market.liquidity < LOW_LIQUIDITY_USD &&
          market.volume24h < LOW_VOLUME_24H_USD;
        if (failing) {
          zoneAsset.osmosis_halt_deposits = true;
          zoneAsset.osmosis_deposit_halt_reason = 'extended_unstable_market';
          mutations.push({
            kind: 'extended_halt_set',
            asset: symbol,
            chain: chainName,
            days: Math.floor(downtimeMs / (24 * 60 * 60 * 1000)),
          });
        }
      }
    }

    // ── Trigger A clearing: market recovered (single passing run) ──────────
    if (
      zoneAsset.osmosis_halt_deposits === true &&
      zoneAsset.osmosis_deposit_halt_reason === 'extended_unstable_market' &&
      !zoneAsset.tooltip_message
    ) {
      const market = numia.get(coinMinimalDenom);
      const passing =
        !!market &&
        (market.liquidity >= LOW_LIQUIDITY_USD ||
          market.volume24h >= LOW_VOLUME_24H_USD);
      if (passing) {
        delete zoneAsset.osmosis_halt_deposits;
        delete zoneAsset.osmosis_deposit_halt_reason;
        mutations.push({
          kind: 'extended_halt_cleared',
          asset: symbol,
          chain: chainName,
        });
      }
    }

    // ── Trigger B: planned shutdown approaching ─────────────────────────────
    // Curator lock honoured: non-empty tooltip_message blocks the set path,
    // matching the contract used elsewhere.
    const plannedDate = zoneAsset.planned_shutdown_date;
    if (
      plannedDate &&
      zoneAsset.osmosis_halt_deposits !== true &&
      !zoneAsset.tooltip_message
    ) {
      const untilMs = new Date(plannedDate).getTime() - nowMs;
      if (untilMs >= 0 && untilMs <= SHUTDOWN_WINDOW_MS) {
        zoneAsset.osmosis_halt_deposits = true;
        zoneAsset.osmosis_deposit_halt_reason = 'planned_shutdown';
        mutations.push({
          kind: 'planned_shutdown_set',
          asset: symbol,
          chain: chainName,
          shutdown: plannedDate,
        });
      }
    }

    // ── Trigger B clearing ──────────────────────────────────────────────────
    if (
      zoneAsset.osmosis_halt_deposits === true &&
      zoneAsset.osmosis_deposit_halt_reason === 'planned_shutdown' &&
      !zoneAsset.tooltip_message
    ) {
      const untilMs = plannedDate
        ? new Date(plannedDate).getTime() - nowMs
        : Infinity;
      if (!plannedDate || untilMs > SHUTDOWN_WINDOW_MS) {
        delete zoneAsset.osmosis_halt_deposits;
        delete zoneAsset.osmosis_deposit_halt_reason;
        mutations.push({
          kind: 'planned_shutdown_cleared',
          asset: symbol,
          chain: chainName,
        });
      }
    }
  }

  const affectedChains = new Set(
    mutations.filter((m) => m.chain).map((m) => m.chain)
  );
  if (affectedChains.size > MAX_CHAINS_PER_RUN && !force && !dryRun) {
    console.error(
      `\n⛔ Mutation cap exceeded: ${affectedChains.size} chains > ${MAX_CHAINS_PER_RUN}.`
    );
    process.exit(2);
  }

  if (dryRun) {
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(
      reportsDir,
      `extended_halts_dry_run_${nowIso.slice(0, 10)}.md`
    );
    const lines = [
      `# Extended halts dry-run, ${nowIso}`,
      ``,
      `Mutations: ${mutations.length}`,
      ``,
      `| Kind | Asset | Chain | Days / Shutdown |`,
      `|------|-------|-------|-----------------|`,
    ];
    for (const m of mutations) {
      lines.push(
        `| ${m.kind} | ${m.asset ?? '-'} | ${m.chain ?? '-'} | ${m.days ?? m.shutdown ?? '-'} |`
      );
    }
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
    console.log(`\n📝 Dry-run report: ${reportPath}`);
    return;
  }

  if (mutations.length > 0) {
    fs.writeFileSync(zoneAssetsPath, JSON.stringify(zoneData, null, 2) + '\n', 'utf8');
    console.log(`✓ Updated ${zoneAssetsPath}`);
  } else {
    console.log('No changes needed.');
  }

  const byKind = {};
  for (const m of mutations) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  console.log('\n' + '='.repeat(70));
  console.log('  EXTENDED HALTS SUMMARY');
  console.log('='.repeat(70));
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`  ${k.padEnd(28)}: ${v}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
