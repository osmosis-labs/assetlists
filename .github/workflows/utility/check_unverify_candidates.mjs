// Purpose:
//   Weekly check (Monday 16:00 UTC) for assets that have been continuously
//   unstable for 90+ days. For each such asset, propose flipping
//   osmosis_verified=false via a single PR. 30-day cooldown via
//   state.lastUnverifyProposedAt prevents weekly re-proposal.
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

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

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

const NUMIA_TOKENS_URL = 'https://public-osmosis-api.numia.xyz/tokens/v2/all';

async function fetchNumia() {
  try {
    const res = await fetch(NUMIA_TOKENS_URL);
    if (!res.ok) return new Map();
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
  } catch {
    // Numia is non-critical here; we only use it for PR body enrichment.
    return new Map();
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

  const zoneByOrigin = new Map();
  for (const a of zoneData.assets) {
    zoneByOrigin.set(`${a.chain_name}:${a.base_denom}`, a);
  }

  const stateByDenom = new Map();
  for (const a of state.assets ?? []) {
    stateByDenom.set(a.base_denom, a);
  }

  const numia = await fetchNumia();

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const candidates = [];

  for (const asset of frontendData.assets ?? []) {
    const zoneKey = `${asset.chainName}:${asset.sourceDenom}`;
    const zoneAsset = zoneByOrigin.get(zoneKey);
    if (!zoneAsset) continue;
    if (zoneAsset.osmosis_verified !== true) continue;
    if (zoneAsset.osmosis_unstable !== true) continue;

    const stateAsset = stateByDenom.get(asset.coinMinimalDenom);
    if (!stateAsset?.lastDowntimeDate) continue;

    const downtimeMs = nowMs - new Date(stateAsset.lastDowntimeDate).getTime();
    if (downtimeMs < NINETY_DAYS_MS) continue;

    // Cooldown
    if (stateAsset.lastUnverifyProposedAt) {
      const elapsed = nowMs - new Date(stateAsset.lastUnverifyProposedAt).getTime();
      if (elapsed < COOLDOWN_MS) continue;
    }

    const market = numia.get(asset.coinMinimalDenom);
    candidates.push({
      chain: asset.chainName,
      symbol: asset.symbol,
      baseDenom: asset.coinMinimalDenom,
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

  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'unverify_candidates_pr_body.md');
  fs.writeFileSync(reportPath, prBodyLines.join('\n') + '\n', 'utf8');

  console.log(`\n📝 PR body: ${reportPath} (${candidates.length} candidates)`);

  if (dryRun || !propose) {
    return;
  }

  if (candidates.length === 0) {
    console.log('No candidates; nothing to propose.');
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
