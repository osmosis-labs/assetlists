// Purpose:
//   Auto-merge safety gate for the daily "Generate All Files" pipeline.
//
//   The daily run opens a PR and immediately auto-merges it. The gate exists for
//   one thing: an unreviewed change to the IDENTITY of a curated asset. It is
//   deliberately narrow, because a gate that blocks on routine churn gets
//   ignored, and routine churn is most of what the daily run does.
//
//   Scoped to VERIFIED assets throughout. Verified is the curated,
//   default-visible set, and it is the only place these changes are user-facing;
//   an unverified asset is hidden by default. Verification is also a deliberate
//   human act (nothing in the daily pipeline writes osmosis_verified), so the
//   flag cannot be moved by the pipeline underneath the gate.
//
//     1. Financially sensitive field change to an ESTABLISHED verified asset.
//        The primary purpose. An upstream registry refresh can rewrite decimals,
//        coinMinimalDenom, sourceDenom, origin chain, contract, IBC path or
//        display name on an asset that keeps its symbol: it fires no lifecycle
//        category and never appears in new-assets.txt, so nothing else in the
//        pipeline would surface it. These are the fields that determine where
//        funds move or what the asset claims to be (a wrong exponent misprices
//        by orders of magnitude; a re-pointed contract or IBC path sends funds
//        somewhere else). See SENSITIVE_FIELDS in the helpers module.
//
//     2. Removal of a verified asset. findIdentityChanges only walks the after
//        list, so a delisting produces no row there; without a separate pass a
//        generation failure that dropped assets looked like a quiet day.
//
//   NOT gated, by design:
//     - Lifecycle status changes (unstable flips, halts set/cleared, reason
//       shifts). The pipeline is responding to real chain conditions and the
//       daily summary already itemises them. Blocking meant a routine bridge
//       outage stalled the assetlist. Reported for context only.
//     - New-asset symbol collisions. This was a check here, removed because
//       measured against the live list it flagged 23 assets of which 21 were
//       ordinary dotted bridge listings (USDC.eth.axl style) and the other 2
//       were case-only collisions between genuinely distinct assets
//       (cOSMO/COSMO, stLuna/stLUNA). It found no real impersonation while
//       reliably blocking routine bridge work, so it was pure noise. Symbol
//       deduplication in deduplicate_symbols.mjs already gives the verified
//       asset the bare symbol and suffixes the rest, and nothing in the daily
//       pipeline can set osmosis_verified, so a new asset cannot arrive
//       verified.
//     - Informational metadata (tooltip text). Note `name` IS gated for
//       existing verified assets, because a display-name rewrite is the other
//       half of an impersonation.
//     - isAlloyed and coingeckoId. Routing/pricing properties the pipeline
//       manages; a change does not redirect funds.
//     - Anything scoped to unverified assets, including their removal (the
//       count is still reported, since a large unverified drop can indicate a
//       broken generation run).
//
//   No network calls. The gate reads the generated assetlist, the pre-generation
//   snapshot and the lifecycle diff from disk, so there is no market-data outage
//   that can stall it or silently weaken a threshold.
//
//   Report-only with respect to the pipeline: never mutates repo files, and
//   exits 0 even when it blocks (via process.exitCode, so the report on stdout
//   is allowed to flush before the process ends). The decision is communicated
//   via the GATE_BLOCKED / GATE_REASON_COUNT variables written to $GITHUB_ENV (when
//   set) and a markdown block on stdout for the PR body. Exit code 1 is
//   reserved for the gate itself failing (bad input, unreadable list), which
//   is also treated as blocking by the caller. See "fail closed" below.
//
//   Fail closed: every decision input is read from disk, so a missing or
//   unusable one means the gate cannot evaluate and it blocks rather than waving
//   the run through. That covers an unreadable lifecycle diff, a generated
//   assetlist that is absent or has an EMPTY assets array (an empty array is
//   truthy, so this needs an explicit length check), and a missing
//   pre-generation snapshot (every asset would read as unchanged).
//
// Usage:
//   node check_automerge_gate.mjs [<zone_name>] [options]
//
//   <zone_name>                  default osmosis-1
//   --json <path>                lifecycle diff produced by the workflow's
//                                "Extract per-mutation symbol lists" step;
//                                default /tmp/lifecycle-diff.json
//   --before <path>              pre-generation copy of the frontend assetlist,
//                                for the sensitive-field diff; default
//                                /tmp/frontend-before.json, written by the
//                                workflow's "Capture Current Assets" step
//
// Exit codes:
//   0  ran to completion (check GATE_BLOCKED for the verdict)
//   1  the gate could not evaluate (missing inputs) -> caller blocks

import * as fs from 'fs';
import * as path from 'path';

import {
  findActiveUnknownCategories,
  findIdentityChanges,
  findRemovedAssets,
  hasUsableAssetlist,
} from './check_automerge_gate_helpers.mjs';

import { loadJSON } from './lifecycle_helpers.mjs';

// ── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

// Parse errors are collected rather than thrown, because parsing happens at
// module scope where a throw escapes main()'s catch and finish(), leaving the
// PR body empty. validateArgs() raises them from inside main() instead.
const argErrors = [];

function flagValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    argErrors.push(`${name} requires a value`);
    return fallback;
  }
  return v;
}

const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  // Drop values consumed by a preceding flag.
  return !(i > 0 && argv[i - 1].startsWith('--'));
});

const zoneBasePath = positional[0] || 'osmosis-1';
const diffPath = flagValue('--json', '/tmp/lifecycle-diff.json');
// Pre-generation copy of the frontend assetlist, written by the workflow's
// "Capture Current Assets" step. Needed to detect sensitive-field changes to
// assets that keep their symbol; the symbol lists only show add/remove.
const beforePath = flagValue('--before', '/tmp/frontend-before.json');

/**
 * Validated from inside main() rather than at module scope so a bad flag goes
 * through finish(), which writes GATE_BLOCKED and emits a markdown verdict. A
 * bare process.exit(1) here left the PR body empty: the workflow still forced
 * GATE_BLOCKED=true on a non-zero exit, so it failed closed, but the reviewer
 * got no explanation of why.
 */
function validateArgs() {
  if (argErrors.length > 0) {
    throw new Error(`bad arguments: ${argErrors.join('; ')}`);
  }
  // --liquidity-threshold used to arm a secondary trigger on deep unverified
  // assets. It was removed once the gate scoped to verified assets, since no
  // unverified asset sits above a meaningful threshold anyway. Reject it rather
  // than ignoring it, so a leftover flag in a workflow or runbook cannot read as
  // an armed threshold that is silently doing nothing.
  const removed = argv.filter((a) => a === '--liquidity-threshold');
  if (removed.length > 0) {
    throw new Error(
      '--liquidity-threshold was removed: the gate is scoped to verified assets '
      + 'and makes no market-data calls. Drop the flag.'
    );
  }
}

const zonePath = path.join('..', '..', '..', zoneBasePath);
const frontendPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');

// ── Mutation categories that count as "modification" ─────────────────────────

// Every boolean in the lifecycle diff that represents the pipeline changing an
// asset's trading or transfer status. Deliberately excludes the purely
// cosmetic/no-consequence rows (nameChanged, tooltip*): a tooltip decay on
// OSMO should not hold up the daily run, and those are already surfaced in the
// PR summary. Ordered roughly most- to least-severe for report readability.
//
// Keep in sync with the field list in generate_all_files.yml's
// "Extract per-mutation symbol lists" step. A category present in the diff but
// missing here is reported via UNKNOWN_CATEGORIES below rather than silently
// ignored, so schema drift in the workflow surfaces instead of quietly
// widening what can auto-merge.
const BLOCKING_CATEGORIES = [
  'bridgeOrKillWithdrawalSet',   // funds-out closed: highest consequence
  'bridgeOrKillDepositSet',
  'ibcFlagged',
  'extendedHaltSet',
  'plannedShutdownSet',
  'unstableReasonChanged',
  'bridgeOrKillWithdrawalCleared',
  'bridgeOrKillDepositCleared',
  'ibcCleared',
  'extendedHaltCleared',
];

// Categories known to exist in the diff that intentionally do not gate.
const NON_BLOCKING_CATEGORIES = [
  'nameChanged',
  'tooltipAdded',
  'tooltipRemoved',
  'tooltipChanged',
];

// Non-boolean payload fields on each diff row.
const METADATA_FIELDS = [
  'chain', 'symbol', 'reason', 'unstableReasonOld', 'nameOld', 'nameNew',
  'depositHaltReason', 'withdrawalHaltReason',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Make a registry-sourced string safe to drop into a markdown table cell.
 *
 * Values reaching the report (symbol, name, contract, denoms, reason) come from
 * the chain-registry submodule and zone_assets. An unescaped `|` splits the row
 * into extra columns, so GitHub renders Before/After exponents under the wrong
 * headings. Since the gate's whole value is that a human reads this table before
 * a mass merge, a silently misaligned table is worse than no table. Backticks
 * are neutralised too so a value cannot break out of its code span, and newlines
 * are flattened so a multi-line value cannot end the row early.
 */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '‘')
    .replace(/\r?\n/g, ' ');
}

function appendGithubEnv(lines) {
  const envFile = process.env.GITHUB_ENV;
  if (!envFile) return;
  fs.appendFileSync(envFile, lines.map((l) => `${l}\n`).join(''));
}

/**
 * Emit the verdict and exit. Centralised so every exit path (including the
 * fail-closed ones) writes GATE_BLOCKED exactly once and in the same shape.
 */
function finish({ blocked, reasons, report, evaluationFailed = false }) {
  appendGithubEnv([
    `GATE_BLOCKED=${blocked ? 'true' : 'false'}`,
    `GATE_REASON_COUNT=${reasons.length}`,
    `GATE_EVALUATION_FAILED=${evaluationFailed ? 'true' : 'false'}`,
  ]);

  // stdout is captured into the PR body by the workflow.
  process.stdout.write(report);

  // Human-readable trailer on stderr so it lands in the step log, not the PR.
  console.error('');
  console.error('=== AUTO-MERGE GATE SUMMARY ===');
  console.error(`blocked            : ${blocked}`);
  console.error(`reasons            : ${reasons.length}`);
  console.error(`evaluation_failed  : ${evaluationFailed}`);
  for (const r of reasons) console.error(`  - ${r}`);

  // Set the code rather than calling process.exit(): stdout writes are async
  // when stdout is a pipe, and process.exit() can tear the process down before
  // the report has flushed, truncating the PR body. Assigning exitCode lets
  // Node exit naturally once the stream has drained. Same status semantics as
  // before: 1 when the gate could not evaluate, 0 otherwise.
  process.exitCode = evaluationFailed ? 1 : 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // First statement, so an argument error reaches the top-level catch and is
  // reported through finish() like any other gate failure.
  validateArgs();

  const reasons = [];
  let report = '';

  // ── Load inputs ───────────────────────────────────────────────────────────
  let diffRows;
  try {
    diffRows = loadJSON(diffPath);
  } catch (err) {
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: [`cannot read lifecycle diff at ${diffPath}: ${err.message}`],
      report: blockReport([
        `The auto-merge gate could not read its input (\`${diffPath}\`): ${err.message}`,
        '',
        'Auto-merge was withheld because the gate could not evaluate the diff.',
      ]),
    });
  }

  if (!Array.isArray(diffRows)) {
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: [`lifecycle diff at ${diffPath} is not an array`],
      report: blockReport([`The lifecycle diff at \`${diffPath}\` was not a JSON array.`]),
    });
  }

  const frontendData = loadJSON(frontendPath, null);
  // `!frontendData?.assets` alone let {assets: []} through, because an empty
  // array is truthy. A generation failure that emitted zero assets would then
  // produce no lifecycle hits and no new symbols, so the gate reported a clean
  // pass and auto-merged a list that removes every asset. Require a non-empty
  // array explicitly.
  if (!hasUsableAssetlist(frontendData)) {
    const detail = !frontendData
      ? 'the file was missing or unparseable'
      : !Array.isArray(frontendData.assets)
        ? 'the `assets` key was absent or not an array'
        : 'the `assets` array was empty (0 assets)';
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: [`unusable frontend assetlist at ${frontendPath}: ${detail}`],
      report: blockReport([
        `The generated frontend assetlist (\`${frontendPath}\`) is unusable: ${detail}.`,
        '',
        'A run that generated no assets would otherwise look like a run with',
        'nothing to review, so auto-merge was withheld.',
      ]),
    });
  }

  // ── Detect diff schema drift ──────────────────────────────────────────────
  // Any boolean key in the diff that this script doesn't classify is unknown.
  // A key that is merely PRESENT but false everywhere is inert, so it only
  // warns; a key that is actually TRUE on some row means an unclassified
  // mutation happened and the gate has no idea whether it is financially
  // sensitive. Warning was useless there, because the PR auto-merged before
  // anyone read it, so an active unknown category now blocks until someone
  // classifies it in BLOCKING_CATEGORIES or NON_BLOCKING_CATEGORIES.
  const known = new Set([...BLOCKING_CATEGORIES, ...NON_BLOCKING_CATEGORIES, ...METADATA_FIELDS]);
  const { unknownCategories, activeUnknownCategories } = findActiveUnknownCategories(
    diffRows,
    known
  );

  // No market-data lookup. The gate keys entirely on the verified flag and the
  // before/after assetlists, both read from disk, so it makes no network calls:
  // there is no Numia or SQS outage that can stall or silently weaken it. A
  // reviewer who wants depth context for a flagged asset can look it up.

  // Symbol -> asset, for resolving lifecycle rows to their verified status.
  //
  // Symbol is NOT unique in practice: the live list carries two LINK.eth.terra
  // entries differing only by denom. `new Map(assets.map(...))` is last-wins,
  // which could hide a verified asset behind an unverified duplicate and let a
  // status change on the verified one be classified as unverified. Prefer a
  // verified record, then first-wins, so the resolution is deterministic and
  // always errs toward the record that gates.
  const feBySymbol = new Map();
  for (const a of frontendData.assets) {
    if (typeof a.symbol !== 'string') continue;
    const existing = feBySymbol.get(a.symbol);
    if (!existing || (a.verified === true && existing.verified !== true)) {
      feBySymbol.set(a.symbol, a);
    }
  }

  // ── Lifecycle status changes: INFORMATIONAL ONLY ─────────────────────────
  // Unstable flips, halts set or cleared and reason shifts are the pipeline
  // doing its job in response to real chain conditions, and they are already
  // itemised in the daily PR summary. Holding the merge for them meant a routine
  // bridge outage stalled the assetlist, so they are surfaced here for context
  // and do not block. The gate exists for identity and impersonation changes
  // (see the three checks below), not for lifecycle churn.
  const statusChanges = [];

  for (const row of diffRows) {
    const fired = BLOCKING_CATEGORIES.filter((c) => row?.[c] === true);
    if (fired.length === 0) continue;

    // The upstream jq falls back to `_comment` ("Evmos $EVMOS") then base_denom
    // for zone assets with no frontend row, so extract a trailing $SYMBOL before
    // giving up on resolution.
    const dollarSymbol = typeof row.symbol === 'string'
      ? row.symbol.match(/\$([^\s$]+)\s*$/)?.[1]
      : undefined;
    const fe = feBySymbol.get(row.symbol)
      ?? (dollarSymbol ? feBySymbol.get(dollarSymbol) : undefined)
      ?? frontendData.assets.find((a) => a.chainName === row.chain && a.symbol === row.symbol);

    statusChanges.push({
      chain: row.chain,
      symbol: dollarSymbol ?? row.symbol,
      verified: fe?.verified === true,
      listed: Boolean(fe),
      categories: fired,
      reason: row.reason ?? '',
    });
  }

  // Verified first so the most user-visible rows read at the top.
  statusChanges.sort((x, y) => (y.verified ? 1 : 0) - (x.verified ? 1 : 0));

  // ── Sensitive-field changes to established verified assets ───────────────
  // The gate's purpose. Symbol-keyed add/remove detection cannot see an upstream
  // refresh that rewrites decimals, denoms, origin chain, contract or IBC path on
  // an asset that keeps its symbol, so compare the snapshot field by field.
  //
  // Identity: match on coinMinimalDenom OR the IBC-path key, because both are
  // themselves sensitive fields. 970 of the 1336 current keys embed sourceDenom
  // in the path, so keying on the path alone would read a denom change as a
  // remove plus an add and miss the modification.
  const identityChanges = [];
  const removedAssets = [];
  let beforeMissing = false;
  const beforeData = loadJSON(beforePath, null);

  if (!hasUsableAssetlist(beforeData)) {
    // No usable snapshot means every asset would read as unchanged, which is a
    // silent pass on exactly the class of change this check exists to catch.
    beforeMissing = true;
  } else {
    identityChanges.push(...findIdentityChanges(beforeData.assets, frontendData.assets));
    // Removals are a separate pass: findIdentityChanges only walks the after
    // list, so a delisting produces no row there. Without this, a generation
    // failure that dropped most of the list looked identical to a quiet day.
    removedAssets.push(...findRemovedAssets(beforeData.assets, frontendData.assets));
  }

  if (beforeMissing) {
    reasons.push(
      `no usable pre-generation snapshot at ${beforePath}, so sensitive-field `
      + 'changes to existing assets could not be checked'
    );
  }
  // findIdentityChanges is already verified-scoped, so every row here is curated.
  if (identityChanges.length > 0) {
    reasons.push(
      `${identityChanges.length} verified asset(s) had a financially sensitive `
      + 'field change'
    );
  }

  // Removals split by verified status. Only a verified delisting blocks: it is
  // the user-visible half. An unverified drop is reported but does not hold the
  // run, which does mean a generation failure confined to unverified assets
  // passes, so the count is surfaced prominently in the report instead.
  const removedVerified = removedAssets.filter((r) => r.verified);
  const removedUnverified = removedAssets.filter((r) => !r.verified);
  if (removedVerified.length > 0) {
    reasons.push(
      `${removedVerified.length} verified asset(s) were removed from the generated list`
    );
  }

  if (activeUnknownCategories.size > 0) {
    reasons.push(
      `${activeUnknownCategories.size} unclassified lifecycle mutation(s) fired `
      + `(${[...activeUnknownCategories].join(', ')})`
    );
  }

  // ── Build report ─────────────────────────────────────────────────────────
  const blocked = reasons.length > 0;

  if (blocked) {
    report += '## 🛑 Auto-merge withheld\n\n';
    report += 'This PR was **not** auto-merged. It needs a human review before merging.\n\n';
    for (const r of reasons) report += `- ${r}\n`;
    report += '\n';
  } else {
    report += '## ✅ Auto-merge gate passed\n\n';
    report += 'No identity changes or removals affecting verified assets.\n\n';
  }

  if (identityChanges.length > 0) {
    report += '### Verified assets with financially sensitive field changes\n\n';
    report += 'These verified assets kept their symbol, but a field that determines '
      + 'where funds move or what the asset claims to be changed. Confirm each '
      + 'against the upstream chain-registry commit before merging.\n\n';
    report += '| Symbol | Chain | Field | Before | After |\n';
    report += '|--------|-------|-------|--------|-------|\n';
    for (const c of identityChanges) {
      for (const ch of c.changed) {
        const fmt = (x) => (x === null ? '_(none)_' : `\`${esc(x)}\``);
        report += `| \`${esc(c.symbol)}\` | ${esc(c.chain)} `
          + `| ${esc(ch.field)} | ${fmt(ch.from)} | ${fmt(ch.to)} |\n`;
      }
    }
    report += '\n';
  }

  if (removedVerified.length > 0) {
    report += '### Verified assets removed from the generated list\n\n';
    report += 'These verified assets were in the pre-generation snapshot and are '
      + 'absent afterwards. A deliberate delisting belongs here, but so does a '
      + 'generation failure or a chain-registry fetch problem that silently dropped '
      + 'assets, so confirm the removals were intended.\n\n';
    report += '| Symbol | Chain | Denom |\n';
    report += '|--------|-------|-------|\n';
    for (const r of removedVerified.slice(0, 50)) {
      report += `| \`${esc(r.symbol)}\` | ${esc(r.chain)} | \`${esc(r.denom)}\` |\n`;
    }
    if (removedVerified.length > 50) {
      report += `\n_and ${removedVerified.length - 50} more removals not shown._\n`;
    }
    report += '\n';
  }

  if (removedUnverified.length > 0) {
    // Reported, not blocking. A large number here still points at a broken
    // generation run even though no curated asset was touched, so it is stated
    // plainly rather than buried.
    report += '### Unverified assets removed from the generated list '
      + `(${removedUnverified.length}, not blocking)\n\n`;
    report += 'Unverified removals do not withhold the merge. A large count here is '
      + 'still worth a look: it can indicate a generation or chain-registry problem '
      + 'that happened to spare the verified set.\n\n';
    report += '<details><summary>Show removed unverified assets</summary>\n\n';
    for (const r of removedUnverified.slice(0, 100)) {
      report += `- \`${esc(r.symbol)}\` (${esc(r.chain)})\n`;
    }
    if (removedUnverified.length > 100) {
      report += `\n_and ${removedUnverified.length - 100} more._\n`;
    }
    report += '\n</details>\n\n';
  }

  if (beforeMissing) {
    report += '### No pre-generation snapshot\n\n';
    report += `No usable asset snapshot was found at \`${beforePath}\`, so changes to `
      + 'decimals, denoms, origin chain, contract, or IBC path on existing assets could not '
      + 'be checked. Every asset would have read as unchanged, so auto-merge was '
      + 'withheld rather than passing that silently.\n\n';
  }

  if (statusChanges.length > 0) {
    const v = statusChanges.filter((s) => s.verified).length;
    report += `<details><summary>Lifecycle status changes (${statusChanges.length}, `
      + `${v} verified, not blocking)</summary>\n\n`;
    report += 'Unstable flips, halts set or cleared, and reason shifts. These are the '
      + 'pipeline responding to real chain conditions and are itemised in the summary '
      + 'below, so they do not withhold the merge.\n\n';
    report += '| Symbol | Chain | Verified | Listed | Change | Reason |\n';
    report += '|--------|-------|----------|--------|--------|--------|\n';
    for (const s of statusChanges.slice(0, 100)) {
      report += `| \`${esc(s.symbol)}\` | ${esc(s.chain)} | ${s.verified ? 'yes' : 'no'} `
        + `| ${s.listed ? 'yes' : 'no'} | ${esc(s.categories.join(', '))} `
        + `| ${esc(s.reason) || '-'} |\n`;
    }
    if (statusChanges.length > 100) {
      report += `\n_and ${statusChanges.length - 100} more._\n`;
    }
    report += '\n</details>\n\n';
  }

  if (activeUnknownCategories.size > 0) {
    report += '### Unclassified lifecycle mutations\n\n';
    report += 'These lifecycle-diff fields fired on at least one asset but are not '
      + 'classified in this gate, so it cannot tell whether the change is '
      + 'financially sensitive. Auto-merge was withheld until they are added to '
      + '`BLOCKING_CATEGORIES` or `NON_BLOCKING_CATEGORIES` in '
      + '`check_automerge_gate.mjs`.\n\n';
    for (const k of activeUnknownCategories) report += `- \`${k}\`\n`;
    report += '\n';
  }

  const inertUnknown = [...unknownCategories].filter((k) => !activeUnknownCategories.has(k));
  if (inertUnknown.length > 0) {
    report += `> ℹ️ Unclassified lifecycle-diff fields present but false on every row: \`${inertUnknown.join('`, `')}\`. `
      + 'They changed nothing this run, so they did not block. Classify them in '
      + '`check_automerge_gate.mjs` before they fire.\n\n';
  }

  return finish({ blocked, reasons, report });
}

/** Report shell for the fail-closed paths. */
function blockReport(lines) {
  return ['## 🛑 Auto-merge withheld (gate could not evaluate)', '', ...lines, ''].join('\n');
}

main().catch((err) => {
  // Any throw is a gate failure -> fail closed. Covers argument validation
  // (raised by validateArgs as the first statement of main) as well as genuinely
  // unexpected errors, so both produce a GATE_BLOCKED write and a real report
  // rather than an empty PR body.
  finish({
    blocked: true,
    evaluationFailed: true,
    reasons: [`gate error: ${err.message}`],
    report: blockReport([
      `The auto-merge gate could not run: ${err.message}`,
      '',
      'Auto-merge was withheld. Review this PR manually.',
    ]),
  });
});
