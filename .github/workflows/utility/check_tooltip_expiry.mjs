// Purpose:
//   Curator-driven tooltip expiry and decay. Daily cron, runs FIRST among the
//   lifecycle scripts (before check_ibc_clients / check_market_health /
//   check_extended_halts) so an expired tooltip is resolved before those
//   lock-respecting scripts evaluate, rather than being honoured as a live
//   curator lock for one extra run.
//
//   A curator flags a tooltip for a dated change by adding an optional
//   `tooltip_expiry_date` (ISO `YYYY-MM-DD`) next to `tooltip_message`. Once
//   that date has arrived (today >= expiry, UTC, end-of-day inclusive), this
//   script does one of two things on the source zone_assets.json, and the
//   generator propagates the result on the same daily PR:
//
//     • Decay (preferred when the message should change rather than vanish):
//       if `tooltip_decay_message` is also set, the tooltip_message is
//       REPLACED by it and the expiry fields are cleared. Use this for a
//       "supported until <date>" notice that should become "support has
//       ended" rather than disappear. The decayed message has no expiry of
//       its own, so it persists until a curator removes it by hand.
//
//     • Removal (no decay message set): both `tooltip_message` and
//       `tooltip_expiry_date` are deleted. Use this for notices whose value
//       fully lapses on the date: rebrands, time-boxed warnings.
//
//   Do NOT set an expiry on a tooltip that documents a permanent condition
//   (dead chain, compromised bridge): leave those without an expiry so they
//   persist until a curator removes them by hand.
//
//   Interaction with the curator lock: other lifecycle scripts treat a
//   non-empty `tooltip_message` as a lock that pauses their automation. This
//   script is the one sanctioned path that clears or rewrites a curator
//   tooltip, and it only does so when the curator themselves set an expiry
//   date that has passed. A tooltip with no `tooltip_expiry_date` is never
//   touched here. (A decayed tooltip is still a non-empty tooltip_message, so
//   it continues to act as a curator lock for the other scripts.)
//
//   Orphan cleanup: `tooltip_expiry_date` (or `tooltip_decay_message`)
//   without a `tooltip_message` is a no-op; the dangling key(s) are deleted
//   so the source does not accumulate cruft.
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

  const mutations = [];
  // Expiry dates that could not be parsed: surfaced so a curator can fix the
  // typo. Never expires the tooltip (fail-safe: keep showing it).
  const invalid = [];

  for (const asset of zoneData.assets) {
    const label = asset._comment ?? `${asset.chain_name}/${asset.base_denom}`;
    const hasExpiry = Object.prototype.hasOwnProperty.call(
      asset,
      'tooltip_expiry_date'
    );
    const hasDecay = Object.prototype.hasOwnProperty.call(
      asset,
      'tooltip_decay_message'
    );
    if (!hasExpiry && !hasDecay) continue;

    // Orphan: expiry/decay metadata with no message to act on. Nothing to
    // expire; drop the dangling key(s) so the source stays clean.
    if (!asset.tooltip_message) {
      delete asset.tooltip_expiry_date;
      delete asset.tooltip_decay_message;
      mutations.push({ kind: 'orphan_cleared', asset: label });
      continue;
    }

    // A decay message with no expiry date can never fire: surface as invalid
    // so the curator adds the date (don't silently drop a deliberate message).
    if (!hasExpiry) {
      invalid.push({ asset: label, value: '(decay set, no expiry date)' });
      continue;
    }

    const expiryMs = expiryInstantMs(asset.tooltip_expiry_date);
    if (expiryMs === null) {
      invalid.push({ asset: label, value: asset.tooltip_expiry_date });
      continue;
    }

    if (nowMs >= expiryMs) {
      const expiry = asset.tooltip_expiry_date;
      if (hasDecay && asset.tooltip_decay_message) {
        // Decay: replace the message, drop the expiry metadata. The decayed
        // message persists (no expiry of its own) until a curator clears it.
        asset.tooltip_message = asset.tooltip_decay_message;
        delete asset.tooltip_decay_message;
        delete asset.tooltip_expiry_date;
        mutations.push({ kind: 'tooltip_decayed', asset: label, expiry });
      } else {
        // Removal: no decay message, so the tooltip fully lapses.
        delete asset.tooltip_message;
        delete asset.tooltip_decay_message;
        delete asset.tooltip_expiry_date;
        mutations.push({ kind: 'tooltip_expired', asset: label, expiry });
      }
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
      `Mutations: ${mutations.length}`,
      ``,
      `| Kind | Asset |`,
      `|------|-------|`,
    ];
    for (const m of mutations) {
      lines.push(`| ${m.kind} | ${m.asset} |`);
    }
    if (invalid.length > 0) {
      lines.push(
        ``,
        `## Invalid expiry/decay config (tooltip kept, please fix)`,
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

  if (mutations.length > 0) {
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
  for (const m of mutations) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  console.log('\n' + '='.repeat(70));
  console.log('  TOOLTIP EXPIRY SUMMARY');
  console.log('='.repeat(70));
  if (mutations.length === 0) {
    console.log('  (nothing expired or decayed)');
  } else {
    for (const [k, v] of Object.entries(byKind)) {
      console.log(`  ${k.padEnd(28)}: ${v}`);
    }
    for (const m of mutations) {
      console.log(`   - ${m.kind.padEnd(26)} ${m.asset}`);
    }
  }

  if (invalid.length > 0) {
    console.log('\n' + '-'.repeat(70));
    console.log('  INVALID expiry/decay config (tooltip kept, please fix)');
    console.log('-'.repeat(70));
    for (const i of invalid) {
      console.log(`  ⚠️  ${(i.asset ?? '-').padEnd(28)} "${i.value}"`);
    }
  }
}

main();
