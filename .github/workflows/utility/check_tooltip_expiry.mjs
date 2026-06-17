// Purpose:
//   Curator-driven tooltip expiry. Daily cron, runs alongside the other
//   lifecycle scripts (after check_extended_halts). A curator can flag a
//   tooltip for automatic removal on a future date by adding an optional
//   `tooltip_expiry_date` (ISO `YYYY-MM-DD`) next to `tooltip_message` on a
//   zone_asset. Once that date has arrived (today >= expiry, UTC), this
//   script deletes BOTH `tooltip_message` and `tooltip_expiry_date` from the
//   source zone_assets.json, and the generator then propagates the absence
//   into the generated outputs on the same daily PR.
//
//   Use this for tooltips whose informational value lapses on a known date:
//   rebrand notices, time-boxed support windows, "until <date>" warnings.
//   Do NOT set an expiry on a tooltip that documents a permanent condition
//   (dead chain, compromised bridge): leave those without an expiry so they
//   persist until a curator removes them by hand.
//
//   Interaction with the curator lock: other lifecycle scripts treat a
//   non-empty `tooltip_message` as a lock that pauses their automation. This
//   script is the one sanctioned path that clears a curator tooltip, and it
//   only does so when the curator themselves set an expiry date that has
//   passed. A tooltip with no `tooltip_expiry_date` is never touched here.
//
//   `tooltip_expiry_date` without a `tooltip_message` is a no-op orphan; it
//   is cleaned up (deleted) so the source does not accumulate dangling keys.
//
// Usage:
//   node check_tooltip_expiry.mjs [<zone_name>] [--dry-run]

import * as fs from 'fs';
import * as path from 'path';

import { loadJSON } from './lifecycle_helpers.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const zoneBasePath = positional[0] || 'osmosis-1';

const zonePath = path.join('..', '..', '..', zoneBasePath);
const filePrefix = zoneBasePath.split('-')[0];
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
const reportsDir = path.join(zonePath, 'generated', 'reports');

// Parse an expiry date as an end-of-day UTC instant: a tooltip flagged for
// 2026-06-30 stays live through all of June 30 (UTC) and is removed on the
// first run dated July 1 or later. Returns null for an unparseable value so
// a typo never silently expires a tooltip.
function expiryInstantMs(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isNaN(ms) ? null : ms;
}

function main() {
  const zoneData = loadJSON(zoneAssetsPath);
  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  const removals = [];
  // Expiry dates that could not be parsed: surfaced so a curator can fix the
  // typo. Never expires the tooltip (fail-safe: keep showing it).
  const invalid = [];

  for (const asset of zoneData.assets) {
    const label = asset._comment ?? `${asset.chain_name}/${asset.base_denom}`;
    const hasExpiry = Object.prototype.hasOwnProperty.call(
      asset,
      'tooltip_expiry_date'
    );
    if (!hasExpiry) continue;

    // Orphan: an expiry date with no message. Nothing to expire; drop the
    // dangling key so the source stays clean.
    if (!asset.tooltip_message) {
      delete asset.tooltip_expiry_date;
      removals.push({ kind: 'orphan_expiry_cleared', asset: label });
      continue;
    }

    const expiryMs = expiryInstantMs(asset.tooltip_expiry_date);
    if (expiryMs === null) {
      invalid.push({ asset: label, value: asset.tooltip_expiry_date });
      continue;
    }

    if (nowMs >= expiryMs) {
      const expiry = asset.tooltip_expiry_date;
      delete asset.tooltip_message;
      delete asset.tooltip_expiry_date;
      removals.push({ kind: 'tooltip_expired', asset: label, expiry });
    }
  }

  if (dryRun) {
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(
      reportsDir,
      `tooltip_expiry_dry_run_${nowIso.slice(0, 10)}.md`
    );
    const lines = [
      `# Tooltip expiry dry-run, ${nowIso}`,
      ``,
      `Removals: ${removals.length}`,
      ``,
      `| Kind | Asset |`,
      `|------|-------|`,
    ];
    for (const r of removals) {
      lines.push(`| ${r.kind} | ${r.asset} |`);
    }
    if (invalid.length > 0) {
      lines.push(
        ``,
        `## Unparseable tooltip_expiry_date (tooltip kept, please fix)`,
        ``,
        `| Asset | Value |`,
        `|-------|-------|`
      );
      for (const i of invalid) {
        lines.push(`| ${i.asset} | ${i.value} |`);
      }
    }
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
    console.log(`\n📝 Dry-run report: ${reportPath}`);
    return;
  }

  if (removals.length > 0) {
    fs.writeFileSync(
      zoneAssetsPath,
      JSON.stringify(zoneData, null, 2) + '\n',
      'utf8'
    );
    console.log(`✓ Updated ${zoneAssetsPath}`);
  } else {
    console.log('No changes needed.');
  }

  const byKind = {};
  for (const r of removals) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log('\n' + '='.repeat(70));
  console.log('  TOOLTIP EXPIRY SUMMARY');
  console.log('='.repeat(70));
  if (removals.length === 0) {
    console.log('  (nothing expired)');
  } else {
    for (const [k, v] of Object.entries(byKind)) {
      console.log(`  ${k.padEnd(28)}: ${v}`);
    }
    for (const r of removals) {
      console.log(`   - ${r.kind.padEnd(26)} ${r.asset}`);
    }
  }

  if (invalid.length > 0) {
    console.log('\n' + '-'.repeat(70));
    console.log('  UNPARSEABLE tooltip_expiry_date (tooltip kept, please fix)');
    console.log('-'.repeat(70));
    for (const i of invalid) {
      console.log(`  ⚠️  ${(i.asset ?? '-').padEnd(28)} "${i.value}"`);
    }
  }
}

main();
