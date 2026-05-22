// Purpose:
//   Bi-weekly check (1st & 15th of each month, 16:00 UTC) for assets continuously
//   unstable for 90+ days. For each such asset, propose flipping
//   osmosis_verified=false via a single PR. 30-day cooldown via
//   state.lastUnverifyProposedAt prevents re-proposal within 30 days.
//
//   The script:
//     1. Computes candidates.
//     2. If --propose (default in CI), mutates zone_assets.json setting
//        osmosis_verified=false for each, stamps state.lastUnverifyProposedAt,
//        and writes a PR body markdown to generated/reports/.
//     3. The calling workflow then uses peter-evans/create-pull-request to
//        open/update the PR on a fixed branch (auto-unverify/weekly-candidates).
//
//   On merge, only osmosis_verified flips. osmosis_unstable + state history
//   fields stay as record.
//
// Usage:
//   node check_unverify_candidates.mjs [<zone_name>] [--dry-run] [--propose]

import * as fs from 'fs';
import * as path from 'path';

import { calculateIbcHash } from './assetlist_functions.mjs';
import {
  fetchAlloyConstituentMap,
  fetchNumia,
  loadJSON,
  resolveMarket,
} from './lifecycle_helpers.mjs';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
// Mirrors FLAP_WINDOW_MS in check_ibc_clients.mjs: a recovery older than this
// is treated as the asset being out of a current incident, not a short flap.
const FLAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const propose = args.includes('--propose');
const positional = args.filter((a) => !a.startsWith('--'));
const zoneBasePath = positional[0] || 'osmosis-1';

const zonePath = path.join('..', '..', '..', zoneBasePath);
const filePrefix = zoneBasePath.split('-')[0];
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
const frontendPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');
const statePath = path.join(zonePath, 'generated', 'state', 'state.json');
const reportsDir = path.join(zonePath, 'generated', 'reports');

async function main() {
  const zoneData = loadJSON(zoneAssetsPath);
  const frontendData = loadJSON(frontendPath);
  const state = loadJSON(statePath, { assets: [] });

  const stateByDenom = new Map();
  for (const a of state.assets ?? []) {
    stateByDenom.set(a.base_denom, a);
  }

  // Frontend index by coinMinimalDenom for cheap metadata lookup (symbol etc).
  // Killed-chain assets won't appear here but will still be evaluated via
  // zone_assets iteration below.
  const frontendByDenom = new Map();
  for (const asset of frontendData.assets ?? []) {
    frontendByDenom.set(asset.coinMinimalDenom, asset);
  }

  // Numia is non-critical here; we only use it for PR body enrichment.
  const numia = await fetchNumia({ hardFail: false });

  // Alloy-aware market display: a constituent's standalone Numia row often
  // reads zero because real trading happens through the alloy. Show the
  // alloy's signal so reviewers see realistic numbers in the PR body.
  const alloyedDenomSet = new Set(
    (frontendData.assets ?? [])
      .filter((a) => a.isAlloyed)
      .map((a) => a.coinMinimalDenom)
  );
  const constituentToAlloy = await fetchAlloyConstituentMap(alloyedDenomSet);

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const candidates = [];

  // Iterate zone_assets directly so we cover killed-chain assets whose
  // generator output disappeared. Compute coinMinimalDenom via the same IBC
  // hash the generator uses.
  for (const zoneAsset of zoneData.assets) {
    if (!zoneAsset.path) continue; // non-IBC entries not handled here
    if (zoneAsset.osmosis_verified !== true) continue;
    if (zoneAsset.osmosis_unstable !== true) continue;
    // Curator lock: a non-empty tooltip_message means the curator owns this
    // asset; don't propose unverification. Unverify is a heavier action than
    // a halt flip, and the lock contract should apply just as much here.
    if (zoneAsset.tooltip_message) continue;

    const coinMinimalDenom = await calculateIbcHash(zoneAsset.path);
    const stateAsset = stateByDenom.get(coinMinimalDenom);
    if (!stateAsset?.lastDowntimeDate) continue;

    const downtimeMs = nowMs - new Date(stateAsset.lastDowntimeDate).getTime();
    if (downtimeMs < NINETY_DAYS_MS) continue;

    // Skip if the asset has recovered and stayed recovered past the flap
    // window. check_ibc_clients keeps osmosis_unstable=true after a bridge-up
    // (to keep the 90-day clock armed in case of re-flap), so a short outage
    // followed by sustained recovery would otherwise look "continuously
    // unstable for 90 days" by lastDowntimeDate alone. A recovery older than
    // FLAP_WINDOW_MS means the asset isn't in a current incident — it would
    // have been treated as a fresh incident if it went down again.
    if (stateAsset.lastRecoveryDate) {
      const recoveredMs = nowMs - new Date(stateAsset.lastRecoveryDate).getTime();
      if (recoveredMs > FLAP_WINDOW_MS) continue;
    }

    // Cooldown
    if (stateAsset.lastUnverifyProposedAt) {
      const elapsed = nowMs - new Date(stateAsset.lastUnverifyProposedAt).getTime();
      if (elapsed < COOLDOWN_MS) continue;
    }

    const feAsset = frontendByDenom.get(coinMinimalDenom);
    const market = resolveMarket(numia, constituentToAlloy, coinMinimalDenom);
    candidates.push({
      chain: zoneAsset.chain_name,
      symbol: feAsset?.symbol ?? zoneAsset._comment ?? zoneAsset.base_denom,
      baseDenom: coinMinimalDenom,
      daysUnstable: Math.floor(downtimeMs / (24 * 60 * 60 * 1000)),
      reason: zoneAsset.osmosis_unstable_reason ?? '?',
      lastDowntimeDate: stateAsset.lastDowntimeDate,
      lastRecoveryDate: stateAsset.lastRecoveryDate ?? '',
      liquidity: market?.liquidity ?? '?',
      volume24h: market?.volume24h ?? '?',
      haltDeposits: zoneAsset.osmosis_halt_deposits === true,
      haltWithdrawals: zoneAsset.osmosis_halt_withdrawals === true,
      zoneAsset,
      stateAsset,
    });
  }

  // PR body markdown
  const prBodyLines = [
    `## Unverify candidates (90-day unstable threshold)`,
    ``,
    `Generated: ${nowIso}`,
    ``,
    `${candidates.length} asset(s) have been continuously unstable for 90+ days. ` +
    `This PR proposes flipping \`osmosis_verified\` to \`false\` for each.`,
    ``,
    `On merge, only \`osmosis_verified\` flips. \`osmosis_unstable\` and the ` +
    `state.json history fields are preserved as record.`,
    ``,
    `| Chain | Symbol | Base denom | Days unstable | Reason | Last downtime | Last recovery | Liquidity | Vol 24h | Halt D | Halt W |`,
    `|-------|--------|-----------|--------------|--------|---------------|---------------|-----------|---------|--------|--------|`,
  ];
  for (const c of candidates) {
    prBodyLines.push(
      `| ${c.chain} | ${c.symbol} | \`${c.baseDenom}\` | ${c.daysUnstable} | ${c.reason} | ${c.lastDowntimeDate} | ${c.lastRecoveryDate} | ${c.liquidity} | ${c.volume24h} | ${c.haltDeposits ? '✓' : ''} | ${c.haltWithdrawals ? '✓' : ''} |`
    );
  }

  if (candidates.length === 0) {
    console.log('No candidates; nothing to propose.');
    // Intentionally skip writing the PR body file. The bi-weekly workflow gates
    // PR creation on the file's existence, so suppressing it here keeps the
    // workflow silent on quiet weeks (no empty "0 candidates" PR noise).
    return;
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'unverify_candidates_pr_body.md');
  fs.writeFileSync(reportPath, prBodyLines.join('\n') + '\n', 'utf8');

  console.log(`\n📝 PR body: ${reportPath} (${candidates.length} candidates)`);

  if (dryRun || !propose) {
    return;
  }

  // Flip osmosis_verified=false and stamp cooldown
  for (const c of candidates) {
    c.zoneAsset.osmosis_verified = false;
    c.stateAsset.lastUnverifyProposedAt = nowIso;
  }

  fs.writeFileSync(zoneAssetsPath, JSON.stringify(zoneData, null, 2) + '\n', 'utf8');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(`✓ Wrote ${candidates.length} unverify proposals.`);
  console.log(`✓ Stamped state.lastUnverifyProposedAt for cooldown.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
