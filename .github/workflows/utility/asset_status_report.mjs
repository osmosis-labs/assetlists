// Purpose:
//   workflow_dispatch utility: emit a markdown status report covering
//     1. Unstable assets (with reason, dates, halt status, days until 60d/90d milestones)
//     2. Halt status (every asset with halt_deposits or halt_withdrawals)
//     3. Disabled assets (osmosis_disabled === true)
//     4. Verification-borderline assets (verified but failing market thresholds)
//     5. Pending unverify (in cooldown), assets that crossed 90d but had a PR opened recently
//     6. Inconsistencies (invariants violated; e.g. osmosis_unstable=true with no state.lastDowntimeDate)
//
//   Read-only. No mutations.
//
// Usage:
//   node asset_status_report.mjs [<zone_name>]

import * as fs from 'fs';
import * as path from 'path';
import { calculateIbcHash } from './assetlist_functions.mjs';

const LOW_LIQUIDITY_USD = 1000;
const LOW_VOLUME_24H_USD = 100;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);
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
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(NUMIA_TOKENS_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return new Map();
    const data = await res.json();
    const byDenom = new Map();
    for (const t of data) {
      if (!t.denom) continue;
      byDenom.set(t.denom, {
        liquidity: Number(t.liquidity ?? 0),
        volume24h: Number(t.volume_24h ?? t.volume_24h_usd ?? t.volume24h ?? 0),
        mcap: Number(t.market_cap ?? 0),
      });
    }
    return byDenom;
  } catch {
    clearTimeout(timeoutId);
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

function daysBetween(nowMs, isoStart) {
  return Math.floor((nowMs - new Date(isoStart).getTime()) / (24 * 60 * 60 * 1000));
}

async function main() {
  const zoneData = loadJSON(zoneAssetsPath);
  const frontendData = loadJSON(frontendPath);
  const state = loadJSON(statePath, { assets: [] });
  const numia = await fetchNumia();

  const stateByDenom = new Map();
  for (const a of state.assets ?? []) stateByDenom.set(a.base_denom, a);

  const frontendByDenom = new Map();
  for (const asset of frontendData.assets ?? []) {
    frontendByDenom.set(asset.coinMinimalDenom, asset);
  }

  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  const unstable = [];
  const halts = [];
  const disabled = [];
  const borderline = [];
  const pending = [];
  const inconsistencies = [];

  // Iterate zone_assets directly so we cover killed-chain assets whose
  // generator output disappeared. Compute coinMinimalDenom via the same IBC
  // hash the generator uses.
  for (const za of zoneData.assets) {
    if (!za.path) continue; // non-IBC entries skipped
    const coinMinimalDenom = await calculateIbcHash(za.path);
    const sa = stateByDenom.get(coinMinimalDenom);
    const m = numia.get(coinMinimalDenom);
    const feAsset = frontendByDenom.get(coinMinimalDenom);
    const symbol = feAsset?.symbol ?? za._comment ?? za.base_denom;

    if (za.osmosis_unstable === true) {
      if (!sa?.lastDowntimeDate) {
        inconsistencies.push({
          chain: za.chain_name,
          symbol,
          issue: 'osmosis_unstable=true but no state.lastDowntimeDate',
        });
      }
      const days = sa?.lastDowntimeDate ? daysBetween(nowMs, sa.lastDowntimeDate) : null;
      const daysUntilHalt = days != null ? Math.max(0, 60 - days) : null;
      const daysUntilUnverify = days != null ? Math.max(0, 90 - days) : null;
      unstable.push({
        chain: za.chain_name,
        symbol,
        baseDenom: coinMinimalDenom,
        verified: za.osmosis_verified === true,
        reason: za.osmosis_unstable_reason ?? '?',
        lastDowntime: sa?.lastDowntimeDate ?? '-',
        lastRecovery: sa?.lastRecoveryDate ?? '-',
        days,
        daysUntilHalt,
        daysUntilUnverify,
        liquidity: m?.liquidity ?? '?',
        volume24h: m?.volume24h ?? '?',
        mcap: m?.mcap ?? '?',
      });
    }

    if (za.osmosis_halt_deposits === true) {
      if (!za.osmosis_deposit_halt_reason) {
        inconsistencies.push({
          chain: za.chain_name,
          symbol,
          issue: 'osmosis_halt_deposits=true with no reason',
        });
      }
      halts.push({
        chain: za.chain_name,
        symbol,
        direction: 'deposit',
        reason: za.osmosis_deposit_halt_reason ?? '?',
        tooltip: za.tooltip_message ?? '',
        manual: za.osmosis_deposit_halt_reason === 'manual',
      });
    }
    if (za.osmosis_halt_withdrawals === true) {
      halts.push({
        chain: za.chain_name,
        symbol,
        direction: 'withdrawal',
        reason: za.osmosis_withdrawal_halt_reason ?? '?',
        tooltip: za.tooltip_message ?? '',
        manual: za.osmosis_withdrawal_halt_reason === 'manual',
      });
    }

    if (za.osmosis_disabled === true) {
      disabled.push({
        chain: za.chain_name,
        symbol,
        baseDenom: coinMinimalDenom,
        verified: za.osmosis_verified === true,
        liquidity: m?.liquidity ?? '?',
        volume24h: m?.volume24h ?? '?',
        mcap: m?.mcap ?? '?',
        comment: za._comment ?? '',
      });
    }

    // Verification-borderline: verified, no unstable flag, but market check fails
    if (
      za.osmosis_verified === true &&
      za.osmosis_unstable !== true &&
      m &&
      m.liquidity < LOW_LIQUIDITY_USD &&
      m.volume24h < LOW_VOLUME_24H_USD
    ) {
      borderline.push({
        chain: za.chain_name,
        symbol,
        liquidity: m.liquidity,
        volume24h: m.volume24h,
      });
    }

    // Pending unverify (in cooldown)
    if (
      za.osmosis_verified === true &&
      za.osmosis_unstable === true &&
      sa?.lastDowntimeDate &&
      sa?.lastUnverifyProposedAt
    ) {
      const days = daysBetween(nowMs, sa.lastDowntimeDate);
      const cooldownLeft =
        COOLDOWN_MS - (nowMs - new Date(sa.lastUnverifyProposedAt).getTime());
      if (days >= 90 && cooldownLeft > 0) {
        pending.push({
          chain: za.chain_name,
          symbol,
          daysUnstable: days,
          lastProposed: sa.lastUnverifyProposedAt,
          daysUntilRepropose: Math.ceil(cooldownLeft / (24 * 60 * 60 * 1000)),
        });
      }
    }
  }

  // ── Compose markdown ────────────────────────────────────────────────────────
  const lines = [];
  lines.push(`# Asset status report, ${nowIso}`);
  lines.push('');

  lines.push(`## 1. Unstable assets (${unstable.length})`);
  lines.push('');
  lines.push(`| Chain | Symbol | Base denom | Verified | Reason | Last downtime | Last recovery | Days | Days→halt | Days→unverify | Liquidity | Vol 24h | MCap |`);
  lines.push(`|-------|--------|-----------|----------|--------|---------------|---------------|------|----------|---------------|-----------|---------|------|`);
  for (const u of unstable) {
    lines.push(
      `| ${u.chain} | ${u.symbol} | \`${u.baseDenom}\` | ${u.verified ? '✓' : ''} | ${u.reason} | ${u.lastDowntime} | ${u.lastRecovery} | ${u.days ?? '-'} | ${u.daysUntilHalt ?? '-'} | ${u.daysUntilUnverify ?? '-'} | ${u.liquidity} | ${u.volume24h} | ${u.mcap} |`
    );
  }
  lines.push('');

  lines.push(`## 2. Halt status (${halts.length})`);
  lines.push('');
  lines.push(`| Chain | Symbol | Direction | Reason | Manual? | Tooltip |`);
  lines.push(`|-------|--------|-----------|--------|---------|---------|`);
  for (const h of halts) {
    lines.push(`| ${h.chain} | ${h.symbol} | ${h.direction} | ${h.reason} | ${h.manual ? '✓' : ''} | ${h.tooltip} |`);
  }
  lines.push('');

  lines.push(`## 3. Disabled assets (${disabled.length})`);
  lines.push('');
  lines.push(`| Chain | Symbol | Base denom | Verified | Liquidity | Vol 24h | MCap | Comment |`);
  lines.push(`|-------|--------|-----------|----------|-----------|---------|------|---------|`);
  for (const d of disabled) {
    lines.push(
      `| ${d.chain} | ${d.symbol} | \`${d.baseDenom}\` | ${d.verified ? '✓' : ''} | ${d.liquidity} | ${d.volume24h} | ${d.mcap} | ${d.comment} |`
    );
  }
  lines.push('');

  lines.push(`## 4. Verification-borderline assets (${borderline.length})`);
  lines.push('');
  lines.push('Verified, not currently unstable, but market check is failing today. ' +
    'Watch list for assets that may enter the unstable lifecycle soon.');
  lines.push('');
  lines.push(`| Chain | Symbol | Liquidity | Vol 24h |`);
  lines.push(`|-------|--------|-----------|---------|`);
  for (const b of borderline) {
    lines.push(`| ${b.chain} | ${b.symbol} | ${b.liquidity} | ${b.volume24h} |`);
  }
  lines.push('');

  lines.push(`## 5. Pending unverify (in cooldown) (${pending.length})`);
  lines.push('');
  lines.push('Assets that crossed 90 days unstable and had a PR proposed within the ' +
    'last 30 days. They\'re hidden from the candidate pool until cooldown ends.');
  lines.push('');
  lines.push(`| Chain | Symbol | Days unstable | Last proposed | Days until re-propose |`);
  lines.push(`|-------|--------|--------------|---------------|----------------------|`);
  for (const p of pending) {
    lines.push(`| ${p.chain} | ${p.symbol} | ${p.daysUnstable} | ${p.lastProposed} | ${p.daysUntilRepropose} |`);
  }
  lines.push('');

  lines.push(`## 6. Inconsistencies (${inconsistencies.length})`);
  lines.push('');
  if (inconsistencies.length === 0) {
    lines.push('_None._');
  } else {
    lines.push(`| Chain | Symbol | Issue |`);
    lines.push(`|-------|--------|-------|`);
    for (const i of inconsistencies) {
      lines.push(`| ${i.chain} | ${i.symbol} | ${i.issue} |`);
    }
  }
  lines.push('');

  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(
    reportsDir,
    `asset_status_${nowIso.slice(0, 10)}.md`
  );
  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\n📝 Status report: ${reportPath}`);
  console.log(`Unstable: ${unstable.length} | Halts: ${halts.length} | Disabled: ${disabled.length} | Borderline: ${borderline.length} | Pending: ${pending.length} | Inconsistencies: ${inconsistencies.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
