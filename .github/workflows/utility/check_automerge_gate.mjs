// Purpose:
//   Auto-merge safety gate for the daily "Generate All Files" pipeline.
//
//   The daily run opens a PR and immediately auto-merges it. Two classes of
//   change are too consequential to land unreviewed:
//
//     1. Status change to a VERIFIED asset. Verified is the curated set the
//        frontend shows by default, so any change to an asset's tradability or
//        transfer status there is user-visible. Verification is a deliberate
//        human act (nothing in the daily pipeline writes osmosis_verified), so
//        the flag is exactly the "we vouch for this" signal a gate should key
//        on. Informational metadata (display name, tooltip text) does NOT gate;
//        see BLOCKING_CATEGORIES.
//
//        Why verified rather than a liquidity threshold: measured against the
//        live list, zero unverified assets sit above $100k liquidity, so a
//        liquidity threshold catches nothing that verified does not, while
//        letting through ~319 verified assets that fall under it. A thin
//        verified asset is still a curated, user-visible listing (SEDA, halted
//        in a recent run at near-zero liquidity, is the worked example), and
//        the flag cannot be moved by the pipeline itself. Liquidity is still
//        fetched and reported alongside each hit as severity context, and can
//        be re-enabled as an ADDITIONAL independent trigger via
//        --liquidity-threshold for unverified-but-deep assets.
//
//     2. Symbol squat by a newly listed asset. A new asset whose symbol
//        collides with an existing verified asset's symbol is a listing that
//        wants a human to look at it. deduplicate_symbols.mjs already suffixes
//        the non-preferred variant, so this is defence in depth: it also
//        catches case-only and separator-only near-matches that dedupe treats
//        as distinct strings (exact-equality grouping), plus the reverse case
//        where a squat lands on a symbol whose canonical owner is unverified.
//
//     3. Financially sensitive field change to an ESTABLISHED asset. Checks 1
//        and 2 are blind to an upstream registry refresh that rewrites decimals,
//        coinMinimalDenom, sourceDenom, origin chain, contract, IBC path,
//        display name, alloy status or coingeckoId on an asset that keeps its
//        symbol: it fires no lifecycle category and never appears in
//        new-assets.txt. Those are exactly the money-and-impersonation fields (a
//        wrong exponent misprices by orders of magnitude; a re-pointed contract
//        or IBC path changes where funds move), so the gate diffs them against a
//        pre-generation snapshot. See SENSITIVE_FIELDS in
//        check_automerge_gate_helpers.mjs.
//
//   Report-only with respect to the pipeline: never mutates repo files, and
//   exits 0 even when it blocks (via process.exitCode, so the report on stdout
//   is allowed to flush before the process ends). The decision is communicated
//   via the GATE_BLOCKED / GATE_REASON_COUNT variables written to $GITHUB_ENV (when
//   set) and a markdown block on stdout for the PR body. Exit code 1 is
//   reserved for the gate itself failing (bad input, unreadable list), which
//   is also treated as blocking by the caller. See "fail closed" below.
//
//   Fail closed: the verified flag is read from the generated frontend
//   assetlist, so an unreadable or empty list means the gate cannot tell a
//   curated asset from an unlisted one, and it blocks rather than waving the
//   run through. Numia is a reporting input only now, so a Numia outage
//   degrades liquidity annotations to "unknown" WITHOUT blocking. If a
//   liquidity threshold is armed via --liquidity-threshold, Numia becomes
//   decision-critical again and an outage blocks, since absence of data must
//   not read as "shallow".
//
// Usage:
//   node check_automerge_gate.mjs [<zone_name>] [options]
//
//   <zone_name>                  default osmosis-1
//   --liquidity-threshold <usd>  ALSO block on any mutated asset at or above
//                                this liquidity, verified or not. Off by
//                                default (verified status is the trigger).
//                                Arming this makes Numia decision-critical.
//   --json <path>                lifecycle diff produced by the workflow's
//                                "Extract per-mutation symbol lists" step;
//                                default /tmp/lifecycle-diff.json
//   --new-assets <path>          newline-delimited new symbols; default
//                                ../../../new-assets.txt, i.e. the repo root,
//                                where the workflow's "Detect New Assets" step
//                                writes it (this script runs from utility/)
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
  buildVerifiedSymbolIndexes,
  feKey,
  findActiveUnknownCategories,
  findIdentityChanges,
  findVerifiedSymbolCollision,
  hasUsableAssetlist,
  normaliseSymbol,
} from './check_automerge_gate_helpers.mjs';

import {
  fetchAlloyConstituentMap,
  fetchNumia,
  loadJSON,
  resolveMarket,
} from './lifecycle_helpers.mjs';

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
const newAssetsPath = flagValue('--new-assets', path.join('..', '..', '..', 'new-assets.txt'));
// Pre-generation copy of the frontend assetlist, written by the workflow's
// "Capture Current Assets" step. Needed to detect sensitive-field changes to
// assets that keep their symbol; the symbol lists only show add/remove.
const beforePath = flagValue('--before', '/tmp/frontend-before.json');

// Optional secondary trigger. Unset means verified status is the only gate and
// Numia is reporting-only; set means a deep unverified asset also blocks and
// Numia becomes decision-critical (so an outage must fail closed).
const rawLiquidityThreshold = flagValue('--liquidity-threshold', null);
const LIQUIDITY_THRESHOLD_USD = rawLiquidityThreshold === null
  ? null
  : Number(rawLiquidityThreshold);

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
  if (LIQUIDITY_THRESHOLD_USD !== null
      && (!Number.isFinite(LIQUIDITY_THRESHOLD_USD) || LIQUIDITY_THRESHOLD_USD <= 0)) {
    throw new Error(
      `Invalid --liquidity-threshold: ${JSON.stringify(rawLiquidityThreshold)} `
      + '(expected a positive number)'
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

function fmtUsd(n) {
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
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

  // ── Liquidity lookup (live, alloy-aware) ──────────────────────────────────
  // Numia is REPORTING-ONLY unless --liquidity-threshold armed it. The gate
  // decision keys on the verified flag, which comes from the assetlist, so an
  // outage must not block the daily run: it just degrades the liquidity column
  // to "unknown". When a threshold IS armed, liquidity becomes decision-critical
  // and the outage has to fail closed, because "no data" would otherwise read
  // as "shallow" and silently disarm that trigger.
  const liquidityIsDecisionCritical = LIQUIDITY_THRESHOLD_USD !== null;
  let numia = new Map();
  let numiaError = null;
  try {
    numia = await fetchNumia({ hardFail: liquidityIsDecisionCritical });
  } catch (err) {
    numiaError = err.message;
  }

  if (liquidityIsDecisionCritical && (numiaError || numia.size === 0)) {
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: [`Numia unavailable while a liquidity threshold is armed: ${numiaError ?? 'empty token list'}`],
      report: blockReport([
        `Liquidity data could not be fetched: ${numiaError ?? 'Numia returned an empty token list'}.`,
        '',
        'A liquidity threshold is armed, so the gate cannot tell a deep asset',
        'from a dust asset without this data. Auto-merge was withheld rather',
        'than letting that trigger silently disarm.',
      ]),
    });
  }
  if (numiaError || numia.size === 0) {
    // Non-fatal: liquidity is annotation only in this configuration.
    numia = new Map();
    console.error(`Numia unavailable (${numiaError ?? 'empty token list'}); `
      + 'liquidity shown as unknown. Verified-status gating is unaffected.');
  }

  const alloyedDenomSet = new Set(
    frontendData.assets.filter((a) => a.isAlloyed).map((a) => a.coinMinimalDenom)
  );
  // Degrades to an empty map on SQS error; that only removes the
  // max(self, alloy) uplift, which can lower a constituent's apparent
  // liquidity. Noted in the report so a missing uplift is visible.
  const constituentToAlloy = await fetchAlloyConstituentMap(alloyedDenomSet);
  const alloyUpliftAvailable = constituentToAlloy.size > 0 || alloyedDenomSet.size === 0;

  // ── Index the frontend list for status and symbol checks ──────────────────
  // Only unsuffixed verified symbols reserve a canonical symbol. Dotted symbols
  // are variants, not additional canonical-name reservations.
  //
  const verifiedSymbolIndexes = buildVerifiedSymbolIndexes(frontendData.assets);

  // Symbol -> asset, for resolving new-asset rows (new-assets.txt holds the
  // post-dedupe frontend symbol, which is unique by construction).
  const feBySymbol = new Map(frontendData.assets.map((a) => [a.symbol, a]));

  // ── Check 1: status changes to curated assets ────────────────────────────
  // Trigger is the verified flag. Liquidity is carried alongside purely as
  // severity context for the reviewer, except when --liquidity-threshold arms
  // it as a second, independent trigger for deep-but-unverified assets.
  const verifiedHits = [];
  const deepUnverifiedHits = [];
  const unresolvedHits = [];

  for (const row of diffRows) {
    const fired = BLOCKING_CATEGORIES.filter((c) => row?.[c] === true);
    if (fired.length === 0) continue;

    // Re-derive the diff row's key. The diff carries chain+symbol but not
    // coinMinimalDenom, so resolve through the frontend list by symbol first
    // (unique post-dedupe) and fall back to chain|symbol scanning.
    const fe = feBySymbol.get(row.symbol)
      ?? frontendData.assets.find((a) => a.chainName === row.chain && a.symbol === row.symbol);

    if (!fe) {
      // The diff and the generated list disagree about what exists. That is
      // suspicious in its own right, and it also means verified status is
      // unknown, so block rather than skip.
      unresolvedHits.push({ ...row, categories: fired, why: 'not found in generated assetlist' });
      continue;
    }

    const market = fe.coinMinimalDenom
      ? resolveMarket(numia, constituentToAlloy, fe.coinMinimalDenom)
      : undefined;

    const hit = {
      chain: row.chain,
      symbol: row.symbol,
      denom: fe.coinMinimalDenom ?? '?',
      liquidity: market?.liquidity,
      volume24h: market?.volume24h,
      verified: fe.verified === true,
      categories: fired,
      reason: row.reason ?? '',
    };

    if (hit.verified) {
      verifiedHits.push(hit);
    } else if (LIQUIDITY_THRESHOLD_USD !== null) {
      // A threshold is armed, so liquidity is decision-critical for unverified
      // assets. If it is unusable (no market row, or a non-finite value), we
      // cannot rule the asset below the threshold, and silently dropping it
      // would let "no data" read as "shallow". Route it to unresolvedHits so it
      // blocks, matching the fail-closed rule stated in the header.
      if (Number.isFinite(market?.liquidity)) {
        if (market.liquidity >= LIQUIDITY_THRESHOLD_USD) deepUnverifiedHits.push(hit);
      } else {
        unresolvedHits.push({
          ...hit,
          why: 'unverified, and liquidity unavailable while a threshold is armed',
        });
      }
    }
  }

  // Sort by liquidity where known, unpriced last, so the reviewer sees the
  // most consequential rows first.
  const byLiquidityDesc = (a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1);
  verifiedHits.sort(byLiquidityDesc);
  deepUnverifiedHits.sort(byLiquidityDesc);

  if (verifiedHits.length > 0) {
    reasons.push(`${verifiedHits.length} verified asset(s) had a status change`);
  }
  if (deepUnverifiedHits.length > 0) {
    reasons.push(
      `${deepUnverifiedHits.length} unverified asset(s) above `
      + `${fmtUsd(LIQUIDITY_THRESHOLD_USD)} liquidity had a status change`
    );
  }

  // ── Check 2: new-asset symbol squats ─────────────────────────────────────
  const squatHits = [];
  let newSymbols = [];
  // Absent file is NOT the same as "no new assets". The workflow always writes
  // new-assets.txt (possibly empty), so a missing file means the step ordering
  // changed or the path is wrong, and the squat check silently examined nothing.
  // That is a missing decision input, exactly like an unreadable lifecycle diff
  // or assetlist, so it blocks rather than merely warning: a squatted symbol
  // could have slipped through unseen. Warning-only here would have let the run
  // auto-merge while reporting a clean collision check that never ran.
  const newAssetsMissing = !fs.existsSync(newAssetsPath);
  if (!newAssetsMissing) {
    newSymbols = fs.readFileSync(newAssetsPath, 'utf8')
      .split('\n').map((s) => s.trim()).filter(Boolean);
  }

  for (const sym of newSymbols) {
    const norm = normaliseSymbol(sym);
    if (!norm) continue;

    const collidesWith = findVerifiedSymbolCollision(sym, verifiedSymbolIndexes);
    if (!collidesWith) continue;

    const fe = feBySymbol.get(sym);

    // A newly listed asset that is itself verified reached that state only by a
    // curator hand-editing osmosis_verified (nothing in the daily pipeline
    // writes it), so it is a deliberate listing, not a squat. This also covers
    // the asset that legitimately owns the bare symbol appearing as "new" in
    // its first run.
    if (fe?.verified) continue;

    // Defensive: an exact self-match belongs to the verified asset already
    // skipped above. Keep the guard in case indexing or dedupe changes.
    if (collidesWith === sym) continue;

    const market = fe?.coinMinimalDenom
      ? resolveMarket(numia, constituentToAlloy, fe.coinMinimalDenom)
      : undefined;

    squatHits.push({
      symbol: sym,
      normalised: norm,
      collidesWith,
      // Case-only collision (usdc vs USDC) versus a wider normalised match
      // (USD-C, homoglyph ATOM). A byte-exact match cannot reach here: such a
      // symbol would belong to the verified owner and be skipped above.
      // Case-insensitive equality is the strongest comparison still meaningful
      // at this point, and it tells the reviewer whether the squat is a pure
      // case flip or something that needed separator/homoglyph folding.
      matchKind: collidesWith.toLowerCase() === sym.toLowerCase() ? 'case' : 'normalised',
      chain: fe?.chainName ?? '?',
      denom: fe?.coinMinimalDenom ?? '?',
      verified: fe?.verified === true,
      liquidity: market?.liquidity,
    });
  }

  if (squatHits.length > 0) {
    reasons.push(
      `${squatHits.length} newly listed asset(s) collide with a verified asset's symbol`
    );
  }

  // ── Check 3: sensitive-field changes to established assets ───────────────
  // Symbol-keyed add/remove detection cannot see an upstream refresh that
  // rewrites decimals, denoms, origin chain or IBC path on an asset that keeps
  // its symbol. Compare the pre-generation snapshot field by field.
  //
  // Identity: match on coinMinimalDenom OR the IBC-path key, because both are
  // themselves sensitive fields. 970 of the 1336 current keys embed sourceDenom
  // in the path, so keying on the path alone would read a denom change as a
  // remove plus an add and miss the modification.
  const identityChanges = [];
  let beforeMissing = false;
  const beforeData = loadJSON(beforePath, null);

  if (!Array.isArray(beforeData?.assets) || beforeData.assets.length === 0) {
    // No usable snapshot means every asset would read as unchanged, which is a
    // silent pass on exactly the class of change this check exists to catch.
    beforeMissing = true;
  } else {
    identityChanges.push(...findIdentityChanges(beforeData.assets, frontendData.assets));
  }

  if (beforeMissing) {
    reasons.push(
      `no usable pre-generation snapshot at ${beforePath}, so sensitive-field `
      + 'changes to existing assets could not be checked'
    );
  }
  if (identityChanges.length > 0) {
    const v = identityChanges.filter((c) => c.verified).length;
    reasons.push(
      `${identityChanges.length} existing asset(s) had a financially sensitive `
      + `field change (${v} verified)`
    );
  }

  if (unresolvedHits.length > 0) {
    reasons.push(
      `${unresolvedHits.length} mutated asset(s) could not be resolved in the generated assetlist`
    );
  }

  if (newAssetsMissing) {
    reasons.push(
      `the new-asset list (${newAssetsPath}) was missing, so the symbol-collision `
      + 'check could not run'
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
    report += 'No sensitive-field changes to existing assets, no status changes to '
      + 'verified assets';
    if (LIQUIDITY_THRESHOLD_USD !== null) {
      report += ` (or to unverified assets above ${fmtUsd(LIQUIDITY_THRESHOLD_USD)} liquidity)`;
    }
    // newAssetsMissing always pushes a reason, so this branch only runs when the
    // collision check actually examined the list.
    report += ', and no new-asset symbol collisions with verified assets.\n\n';
  }

  /** Shared table renderer for the two hit tables. */
  const renderHitTable = (hits) => {
    let out = '| Symbol | Chain | Liquidity | 24h vol | Change | Reason |\n';
    out += '|--------|-------|-----------|---------|--------|--------|\n';
    for (const h of hits) {
      const liq = h.liquidity === undefined ? 'unknown' : fmtUsd(h.liquidity);
      const vol = h.volume24h === undefined ? 'unknown' : fmtUsd(h.volume24h);
      out += `| \`${h.symbol}\` | ${h.chain} | ${liq} | ${vol} `
        + `| ${h.categories.join(', ')} | ${h.reason || '-'} |\n`;
    }
    return out + '\n';
  };

  if (verifiedHits.length > 0) {
    report += '### Verified assets with a status change\n\n';
    report += 'These are in the curated, default-visible set, so the change is '
      + 'user-facing regardless of liquidity.\n\n';
    report += renderHitTable(verifiedHits);
  }

  if (deepUnverifiedHits.length > 0) {
    report += '### Unverified assets above the liquidity threshold '
      + `(${fmtUsd(LIQUIDITY_THRESHOLD_USD)})\n\n`;
    report += renderHitTable(deepUnverifiedHits);
  }

  if (squatHits.length > 0) {
    report += '### New assets colliding with a verified symbol\n\n';
    report += '| New symbol | Collides with | Match | Chain | Liquidity | Denom |\n';
    report += '|------------|---------------|-------|-------|-----------|-------|\n';
    for (const s of squatHits) {
      report += `| \`${s.symbol}\` | \`${s.collidesWith}\` | ${s.matchKind} `
        + `| ${s.chain} | ${s.liquidity === undefined ? 'unknown' : fmtUsd(s.liquidity)} `
        + `| \`${s.denom}\` |\n`;
    }
    report += '\n';
    report += '_Normalised matches ignore case, separators, and homoglyphs, so a '
      + 'lookalike symbol is caught even though symbol deduplication treats it as '
      + 'a distinct string._\n\n';
  }

  if (identityChanges.length > 0) {
    report += '### Existing assets with financially sensitive field changes\n\n';
    report += 'These assets already existed and kept their identity, but a field '
      + 'that affects pricing, routing, or impersonation changed. Confirm each '
      + 'against the upstream chain-registry commit before merging.\n\n';
    report += '| Symbol | Chain | Verified | Field | Before | After |\n';
    report += '|--------|-------|----------|-------|--------|-------|\n';
    for (const c of identityChanges) {
      for (const ch of c.changed) {
        const fmt = (x) => (x === null ? '_(none)_' : `\`${String(x)}\``);
        report += `| \`${c.symbol}\` | ${c.chain} | ${c.verified ? 'yes' : 'no'} `
          + `| ${ch.field} | ${fmt(ch.from)} | ${fmt(ch.to)} |\n`;
      }
    }
    report += '\n';
  }

  if (beforeMissing) {
    report += '### No pre-generation snapshot\n\n';
    report += `No usable asset snapshot was found at \`${beforePath}\`, so changes to `
      + 'decimals, denoms, origin chain, contract, or IBC path on existing assets could not '
      + 'be checked. Every asset would have read as unchanged, so auto-merge was '
      + 'withheld rather than passing that silently.\n\n';
  }

  if (unresolvedHits.length > 0) {
    report += '### Mutated assets not found in the generated assetlist\n\n';
    report += 'Verified status could not be determined for these, so they block by '
      + 'default. A row here means the lifecycle diff and the generated assetlist '
      + 'disagree about what exists.\n\n';
    for (const h of unresolvedHits) {
      report += `- \`${h.symbol}\` (${h.chain}): ${h.why} (${h.categories.join(', ')})\n`;
    }
    report += '\n';
  }

  if (numiaError || numia.size === 0) {
    report += '> ℹ️ Liquidity data was unavailable this run, so the Liquidity and 24h '
      + 'vol columns read "unknown". The gate decision keys on verified status, '
      + 'which is unaffected.\n\n';
  } else if (!alloyUpliftAvailable) {
    report += '> ℹ️ SQS alloy composition was unavailable, so alloy constituents were '
      + 'priced on their own liquidity only. A constituent of a deep alloy may read '
      + 'lower than its effective depth. Shown for context only unless a liquidity '
      + 'threshold is armed.\n\n';
  }

  if (newAssetsMissing) {
    report += '### New-asset list missing\n\n';
    report += `The new-asset list (\`${newAssetsPath}\`) was not found, so the `
      + 'symbol-collision check examined nothing this run and a squatted symbol '
      + 'would not have been caught. The workflow always writes this file (possibly '
      + 'empty), so its absence points at a step-ordering or path problem rather '
      + 'than an empty run. Auto-merge was withheld for that reason; verified-status '
      + 'gating still ran normally.\n\n';
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
