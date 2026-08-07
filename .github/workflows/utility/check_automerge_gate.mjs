// Purpose:
//   Auto-merge safety gate for the daily "Generate All Files" pipeline.
//
//   The daily run opens a PR and immediately auto-merges it. Two classes of
//   change are too consequential to land unreviewed:
//
//     1. High-liquidity modification. A lifecycle script flagging a deep asset
//        (OSMO, ATOM, USDC, wBTC, ...) unstable or halting a transfer direction
//        is user-visible and money-adjacent. Liquidity is read live from Numia
//        (alloy-aware, via resolveMarket) rather than from a hardcoded asset
//        list, so the gate tracks the market instead of drifting against it.
//
//     2. Symbol squat by a newly listed asset. A new asset whose symbol
//        collides with an existing *verified* asset's symbol is a listing that
//        wants a human to look at it. deduplicate_symbols.mjs already suffixes
//        the non-preferred variant, so this is defence in depth: it also
//        catches case-only and separator-only near-matches that dedupe treats
//        as distinct strings (exact-equality grouping), plus the reverse case
//        where a squat lands on a symbol whose canonical owner is unverified.
//
//   Report-only with respect to the pipeline: never mutates repo files, and
//   exits 0 even when it blocks. The decision is communicated via the
//   GATE_BLOCKED / GATE_REASON_COUNT variables written to $GITHUB_ENV (when
//   set) and a markdown block on stdout for the PR body. Exit code 1 is
//   reserved for the gate itself failing (bad input, Numia unreachable), which
//   is also treated as blocking by the caller. See "fail closed" below.
//
//   Fail closed: if Numia can't be reached, liquidity is unknown for every
//   asset, so a mutation to the deepest asset on the chain would look
//   identical to one on a dust asset. The gate blocks in that case rather than
//   waving the run through. This is the reason a liquidity threshold is safe
//   to use without an allowlist backstop: absence of data blocks, it does not
//   permit.
//
// Usage:
//   node check_automerge_gate.mjs [<zone_name>] [--threshold <usd>] [--json <path>]
//
//   <zone_name>        default osmosis-1
//   --threshold <usd>  liquidity above which a mutation blocks; default 250000
//   --json <path>      lifecycle diff produced by the workflow's
//                      "Extract per-mutation symbol lists" step;
//                      default /tmp/lifecycle-diff.json
//   --new-assets <path>  newline-delimited new symbols; default ./new-assets.txt
//
// Exit codes:
//   0  ran to completion (check GATE_BLOCKED for the verdict)
//   1  the gate could not evaluate (missing inputs, Numia down) -> caller blocks

import * as fs from 'fs';
import * as path from 'path';

import {
  fetchAlloyConstituentMap,
  fetchNumia,
  loadJSON,
  resolveMarket,
} from './lifecycle_helpers.mjs';

// ── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flagValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return v;
}

const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  // Drop values consumed by a preceding flag.
  return !(i > 0 && argv[i - 1].startsWith('--'));
});

const zoneBasePath = positional[0] || 'osmosis-1';
const LIQUIDITY_THRESHOLD_USD = Number(flagValue('--threshold', '250000'));
const diffPath = flagValue('--json', '/tmp/lifecycle-diff.json');
const newAssetsPath = flagValue('--new-assets', path.join('..', '..', '..', 'new-assets.txt'));

if (!Number.isFinite(LIQUIDITY_THRESHOLD_USD) || LIQUIDITY_THRESHOLD_USD <= 0) {
  console.error(`Invalid --threshold: ${flagValue('--threshold', '')}`);
  process.exit(1);
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

// ── Symbol normalisation for squat detection ─────────────────────────────────

/**
 * Collapse a symbol to a comparison key that survives the tricks a squatter
 * would use: case, separators, and the handful of Latin/Cyrillic/Greek
 * homoglyphs that render identically in the frontend's font.
 *
 * The chain suffix that deduplicate_symbols.mjs appends (USDC.axl) is stripped
 * so a new "USDC" from a junk chain still compares against verified "USDC".
 */
const HOMOGLYPHS = new Map(Object.entries({
  // Cyrillic -> Latin
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
  'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's',
  'ј': 'j', 'ԁ': 'd', 'ɡ': 'g',
  // Greek -> Latin
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ζ': 'z', 'η': 'n',
  // Fullwidth / lookalike digits and letters
  'ｏ': 'o', '０': '0', 'ⅰ': 'i', 'l': 'l',
}));

function normaliseSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  // Strip a trailing .chain suffix (one or more), e.g. USDC.eth.axl -> USDC.
  const base = symbol.split('.')[0];
  let out = '';
  for (const ch of base.toLowerCase().normalize('NFKC')) {
    out += HOMOGLYPHS.get(ch) ?? ch;
  }
  // Drop separators and anything non-alphanumeric so USD-C / USD_C / USDC tie.
  return out.replace(/[^a-z0-9]/g, '');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Mirror of the workflow's feKey: first IBC transferMethod path, else chain|sourceDenom. */
function feKey(asset) {
  const ibcPath = (asset.transferMethods ?? [])
    .find((tm) => tm?.type === 'ibc' && tm?.chain?.path)?.chain?.path;
  return ibcPath ?? `${asset.chainName}|${asset.sourceDenom}`;
}

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

  process.exit(evaluationFailed ? 1 : 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
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
  if (!frontendData?.assets) {
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: [`cannot read frontend assetlist at ${frontendPath}`],
      report: blockReport([`The generated frontend assetlist (\`${frontendPath}\`) was missing or empty.`]),
    });
  }

  // ── Detect diff schema drift ──────────────────────────────────────────────
  // Any boolean key in the diff that this script doesn't classify is treated as
  // unknown. We report it loudly but do not block on it alone: blocking on an
  // unclassified cosmetic field would wedge the daily run on a harmless
  // workflow edit. The report tells the operator to classify it.
  const known = new Set([...BLOCKING_CATEGORIES, ...NON_BLOCKING_CATEGORIES, ...METADATA_FIELDS]);
  const unknownCategories = new Set();
  for (const row of diffRows) {
    for (const [k, v] of Object.entries(row ?? {})) {
      if (typeof v === 'boolean' && !known.has(k)) unknownCategories.add(k);
    }
  }

  // ── Liquidity lookup (live, alloy-aware) ──────────────────────────────────
  // hardFail:true, because a Numia outage must not silently downgrade the gate to
  // "everything looks like dust". The throw is caught here and converted into
  // a blocking verdict.
  let numia;
  try {
    numia = await fetchNumia({ hardFail: true });
  } catch (err) {
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: [`Numia unavailable: ${err.message}`],
      report: blockReport([
        `Liquidity data could not be fetched: ${err.message}`,
        '',
        'The gate cannot tell a deep asset from a dust asset without it, so',
        'auto-merge was withheld. Re-run the workflow once Numia is reachable,',
        'or review and merge this PR by hand.',
      ]),
    });
  }

  if (numia.size === 0) {
    return finish({
      blocked: true,
      evaluationFailed: true,
      reasons: ['Numia returned zero tokens'],
      report: blockReport([
        'Numia returned an empty token list, so every asset would evaluate as',
        'zero liquidity. Auto-merge was withheld rather than trusting that.',
      ]),
    });
  }

  const alloyedDenomSet = new Set(
    frontendData.assets.filter((a) => a.isAlloyed).map((a) => a.coinMinimalDenom)
  );
  // Degrades to an empty map on SQS error; that only removes the
  // max(self, alloy) uplift, which can lower a constituent's apparent
  // liquidity. Noted in the report so a missing uplift is visible.
  const constituentToAlloy = await fetchAlloyConstituentMap(alloyedDenomSet);
  const alloyUpliftAvailable = constituentToAlloy.size > 0 || alloyedDenomSet.size === 0;

  // ── Index the frontend list by the same key the diff uses ─────────────────
  const feByKey = new Map();
  // normalised -> canonical symbol, built ONLY from verified assets whose
  // symbol carries no chain suffix.
  //
  // Why unsuffixed only: normaliseSymbol strips the .chain suffix, so all seven
  // verified USDC variants (USDC, USDC.eth.axl, USDC.avax.axl, ...) collapse to
  // the same key. Registering every one of them would make the *legitimate*
  // bare USDC collide with its own suffixed siblings and block the run on a
  // false positive. The asset a squatter is impersonating is always the one
  // holding the bare symbol, so that is the only comparison target that means
  // anything. Suffixed variants are still protected: a new asset trying to
  // squat "USDC.eth.axl" would first have to claim bare "USDC", which this
  // catches.
  const verifiedNormSymbols = new Map();
  for (const a of frontendData.assets) {
    feByKey.set(feKey(a), a);
    if (a.verified && typeof a.symbol === 'string' && !a.symbol.includes('.')) {
      const n = normaliseSymbol(a.symbol);
      if (n && !verifiedNormSymbols.has(n)) verifiedNormSymbols.set(n, a.symbol);
    }
  }

  // Symbol -> asset, for resolving new-asset rows (new-assets.txt holds the
  // post-dedupe frontend symbol, which is unique by construction).
  const feBySymbol = new Map(frontendData.assets.map((a) => [a.symbol, a]));

  // ── Check 1: high-liquidity modifications ────────────────────────────────
  const highValueHits = [];
  const unpricedHits = [];

  for (const row of diffRows) {
    const fired = BLOCKING_CATEGORIES.filter((c) => row?.[c] === true);
    if (fired.length === 0) continue;

    // Re-derive the diff row's key. The diff carries chain+symbol but not
    // coinMinimalDenom, so resolve through the frontend list by symbol first
    // (unique post-dedupe) and fall back to chain|symbol scanning.
    const fe = feBySymbol.get(row.symbol)
      ?? frontendData.assets.find((a) => a.chainName === row.chain && a.symbol === row.symbol);

    if (!fe?.coinMinimalDenom) {
      // Can't price it. An unresolvable mutated asset is suspicious in its own
      // right (it means the diff and the generated list disagree), so treat it
      // as blocking rather than skipping.
      unpricedHits.push({ ...row, categories: fired, why: 'not found in generated assetlist' });
      continue;
    }

    const market = resolveMarket(numia, constituentToAlloy, fe.coinMinimalDenom);
    if (!market) {
      // Present in the assetlist but absent from Numia: usually a genuinely
      // unlisted/dust asset. Not blocking on its own, but recorded.
      unpricedHits.push({
        ...row,
        categories: fired,
        denom: fe.coinMinimalDenom,
        why: 'no Numia market row',
      });
      continue;
    }

    if (market.liquidity >= LIQUIDITY_THRESHOLD_USD) {
      highValueHits.push({
        chain: row.chain,
        symbol: row.symbol,
        denom: fe.coinMinimalDenom,
        liquidity: market.liquidity,
        volume24h: market.volume24h,
        verified: fe.verified === true,
        categories: fired,
        reason: row.reason ?? '',
      });
    }
  }

  highValueHits.sort((a, b) => b.liquidity - a.liquidity);

  if (highValueHits.length > 0) {
    reasons.push(
      `${highValueHits.length} asset(s) above ${fmtUsd(LIQUIDITY_THRESHOLD_USD)} liquidity were modified`
    );
  }

  // ── Check 2: new-asset symbol squats ─────────────────────────────────────
  const squatHits = [];
  let newSymbols = [];
  if (fs.existsSync(newAssetsPath)) {
    newSymbols = fs.readFileSync(newAssetsPath, 'utf8')
      .split('\n').map((s) => s.trim()).filter(Boolean);
  }

  for (const sym of newSymbols) {
    const norm = normaliseSymbol(sym);
    if (!norm) continue;

    const collidesWith = verifiedNormSymbols.get(norm);
    if (!collidesWith) continue;

    const fe = feBySymbol.get(sym);

    // A newly listed asset that is itself verified reached that state only by a
    // curator hand-editing osmosis_verified (nothing in the daily pipeline
    // writes it), so it is a deliberate listing, not a squat. This also covers
    // the asset that legitimately owns the bare symbol appearing as "new" in
    // its first run.
    if (fe?.verified) continue;

    // Exact self-match on an unverified asset: the asset holding the bare
    // symbol is the one being compared against itself. Only reachable if the
    // canonical owner is unverified, in which case there is no verified victim.
    if (collidesWith === sym) continue;

    const market = fe?.coinMinimalDenom
      ? resolveMarket(numia, constituentToAlloy, fe.coinMinimalDenom)
      : undefined;

    squatHits.push({
      symbol: sym,
      normalised: norm,
      collidesWith,
      exact: collidesWith === sym,
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

  if (unpricedHits.some((h) => h.why === 'not found in generated assetlist')) {
    const n = unpricedHits.filter((h) => h.why === 'not found in generated assetlist').length;
    reasons.push(`${n} mutated asset(s) could not be resolved in the generated assetlist`);
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
    report += `No modifications to assets above ${fmtUsd(LIQUIDITY_THRESHOLD_USD)} liquidity, `;
    report += 'and no new-asset symbol collisions with verified assets.\n\n';
  }

  if (highValueHits.length > 0) {
    report += `### High-liquidity assets modified (threshold ${fmtUsd(LIQUIDITY_THRESHOLD_USD)})\n\n`;
    report += '| Symbol | Chain | Liquidity | 24h vol | Verified | Change | Reason |\n';
    report += '|--------|-------|-----------|---------|----------|--------|--------|\n';
    for (const h of highValueHits) {
      report += `| \`${h.symbol}\` | ${h.chain} | ${fmtUsd(h.liquidity)} | ${fmtUsd(h.volume24h)} `
        + `| ${h.verified ? 'yes' : 'no'} | ${h.categories.join(', ')} | ${h.reason || '-'} |\n`;
    }
    report += '\n';
  }

  if (squatHits.length > 0) {
    report += '### New assets colliding with a verified symbol\n\n';
    report += '| New symbol | Collides with | Match | Chain | Liquidity | Denom |\n';
    report += '|------------|---------------|-------|-------|-----------|-------|\n';
    for (const s of squatHits) {
      report += `| \`${s.symbol}\` | \`${s.collidesWith}\` | ${s.exact ? 'exact' : 'normalised'} `
        + `| ${s.chain} | ${s.liquidity === undefined ? 'unknown' : fmtUsd(s.liquidity)} `
        + `| \`${s.denom}\` |\n`;
    }
    report += '\n';
    report += '_Normalised matches ignore case, separators, and homoglyphs, so a '
      + 'lookalike symbol is caught even though symbol deduplication treats it as '
      + 'a distinct string._\n\n';
  }

  if (unpricedHits.length > 0) {
    report += '<details><summary>Mutated assets without liquidity data '
      + `(${unpricedHits.length})</summary>\n\n`;
    for (const h of unpricedHits) {
      report += `- \`${h.symbol}\` (${h.chain}): ${h.why} (${h.categories.join(', ')}\n`;
    }
    report += '\n</details>\n\n';
  }

  if (!alloyUpliftAvailable) {
    report += '> ⚠️ SQS alloy composition was unavailable, so alloy constituents were '
      + 'priced on their own liquidity only. A constituent of a deep alloy may read '
      + 'lower than its effective depth.\n\n';
  }

  if (unknownCategories.size > 0) {
    report += `> ⚠️ Unclassified lifecycle-diff fields: \`${[...unknownCategories].join('`, `')}\`. `
      + 'These did not participate in the gate decision. Classify them in '
      + '`check_automerge_gate.mjs` (BLOCKING_CATEGORIES / NON_BLOCKING_CATEGORIES).\n\n';
  }

  return finish({ blocked, reasons, report });
}

/** Report shell for the fail-closed paths. */
function blockReport(lines) {
  return ['## 🛑 Auto-merge withheld (gate could not evaluate)', '', ...lines, ''].join('\n');
}

main().catch((err) => {
  // Any unexpected throw is a gate failure -> fail closed.
  finish({
    blocked: true,
    evaluationFailed: true,
    reasons: [`unexpected gate error: ${err.message}`],
    report: blockReport([
      `The auto-merge gate threw an unexpected error: ${err.message}`,
      '',
      'Auto-merge was withheld. Review this PR manually.',
    ]),
  });
});
