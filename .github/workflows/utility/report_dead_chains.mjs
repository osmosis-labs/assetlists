// Purpose:
//   Report-only detection of two lifecycle signals that nothing else surfaces:
//
//     Part 1 — Dead chain candidates. A chain whose chain-registry status is
//       still "live"/"upcoming" but which has shown a death signal on the
//       Osmosis endpoint probe for N consecutive daily runs, corroborated by
//       status.cosmos.directory showing no recent endpoint success. The endpoint
//       death signal is one of: every RPC and REST endpoint failing connectivity
//       (all_dead), an endpoint answering with a >1h-old block (stale), or the
//       block height not advancing across runs while endpoints still answer
//       (frozen — a halted chain whose node still serves status). These are
//       candidates for a chain-registry `status: killed` PR — a human decides;
//       this script never asserts a chain is dead and never mutates chain.json.
//       Part 1 also emits a DAILY staleness watch-list (independent of the
//       streak gate): every chain answering with a >1h-old block, split into
//       "recently stale — possibly halted" (under a month, shown visibly so a
//       fresh halt is caught early) and a collapsed long-stale block.
//
//     Part 2 — Possible planned shutdowns. Scans on-chain governance proposals
//       (Cosmos SDK gov v1/v1beta1) for shutdown/sunset language on chains
//       Osmosis has registered. Surfaces candidates a curator may want to
//       turn into a `planned_shutdown_date` on the zone_asset, which then
//       feeds the existing check_extended_halts automation. Never auto-sets
//       the field; keyword matching has false positives by nature.
//
//     Part 3 — Marked killed by Osmosis, not yet killed upstream. The inverse
//       of Part 1: chains we have ALREADY flagged source_chain_killed on, but
//       whose chain-registry status is still not "killed". The upstreaming
//       worklist — each is a candidate for a `status: killed` PR to
//       cosmos/chain-registry. Pure local data (no network), but rendered on
//       the weekly run only: it's a slow-changing static list, so repeating it
//       on every daily PR is reviewer noise. Host chains that are themselves
//       still live (the killed asset is a bridged/LST derivative of some other
//       dead chain) are excluded.
//
//   Output is REPORT-ONLY. The script mutates nothing in zone_assets.json or
//   chain.json. It writes:
//     • generated/state/dead_chain_streaks.json — persistent per-chain
//       consecutive-failure counters (owned solely by this script, so the
//       wholesale record replacement in validateEndpoints.mjs can't wipe it).
//     • generated/state/dead_chain_heights.json — persistent per-chain last
//       block height + consecutive-stall run count, for the frozen-height
//       signal. Separate from the streaks file because it must survive a healthy
//       run (the streak is deleted on health, but the last height must persist so
//       a later freeze is detectable). Also owned solely by this script.
//     • A markdown block on stdout, captured by the workflow and appended to
//       the daily [AUTO] PR body.
//
//   Cost control: Part 2 (gov-proposal scan + cosmos.directory lookups) is the
//   expensive, externally-dependent half. It runs only when invoked with
//   --weekly (the workflow passes this on Mondays). Part 1 reads state.json
//   that validateEndpoints already produced, so it is cheap and runs daily.
//
// Usage:
//   node report_dead_chains.mjs [<zone_name>] [--weekly] [--dry-run]
//
//   --weekly   Also run Part 2 (gov-proposal scan) and the cosmos.directory
//              corroboration for Part 1. Without it, Part 1 reports purely on
//              local state.json signals (no external calls).
//   --dry-run  Do not write the state files (dead_chain_streaks.json,
//              dead_chain_heights.json); print the report only.

import * as fs from 'fs';
import * as path from 'path';

import { loadJSON } from './lifecycle_helpers.mjs';
import {
  populateChainDirectories,
  getFileProperty,
} from './chain_registry.mjs';

// ── Tunables ─────────────────────────────────────────────────────────────────

// Consecutive daily runs with every endpoint dead before a chain is listed as
// a dead candidate. Filters transient single-day outages (the agoric case in
// state.json, where one provider 503s but a backup answers, never reaches
// this because validationSuccess stays true).
const DEAD_STREAK_THRESHOLD = 7;

// status.cosmos.directory corroboration window. A chain is only escalated to
// the high-confidence table if its best endpoint lastSuccessAt is older than
// this. Mirrors the spirit of remove-stale-endpoints.py's 30-day default.
const COSMOS_DIRECTORY_STALE_DAYS = 14;

// Consecutive runs of UNCHANGED block height before a chain whose endpoints
// still answer /status is judged "frozen" (consensus halted, node serving a
// stale-but-live-looking status). At the daily cadence each run is ~1 day apart,
// so a live chain advances its height every run; 2 identical heights in a row is
// already a strong halt signal while tolerating a single odd run (a cached
// response, or our probe hitting one lagging node). The frozen verdict then
// still has to clear the same DEAD_STREAK_THRESHOLD + cosmos.directory gate as
// any other death signal before it is published as a candidate.
const FROZEN_HEIGHT_RUNS = 2;

// Daily staleness watch-list split. Every chain whose endpoints answer but whose
// latest block is over an hour old (the `stale` verdict) is surfaced daily for
// visibility, independent of the 7-run kill streak. Within that, a chain stale
// for LESS than this many days is the higher-priority case: it may be a chain
// that has *just* halted (a live incident worth catching early), so it goes in
// the visible summary rather than a collapsed block. A chain stale longer than
// this is most likely long-abandoned — still listed, but folded away. Purely a
// presentation split; both tiers feed the kill streak identically.
//
// 28 days = four daily runs short of a full month, so a chain that halts is shown
// visibly for at least its first ~3 weeks of staleness (well past the point a
// real halt is actionable) before folding into the collapsed long-stale block.
const RECENT_STALE_DAYS = 28;

// Per-chain HTTP timeout for the weekly external lookups.
const HTTP_TIMEOUT_MS = 8000;

// Proposal-recency cutoff for the planned-shutdown scan. After the first live
// run, the dominant noise was old, already-resolved governance (upgrade halts,
// token merges, inflation tweaks) from months/years back that merely contained
// the word "sunset"/"shutdown". A genuine planned shutdown a curator can still
// act on is, by definition, recent. So we skip any proposal submitted longer ago
// than this — a hard cutoff with no exceptions (a proposal this old is dropped
// even if it names a concrete future date/height). submit_time is top-level on
// both gov v1 and v1beta1.
const SHUTDOWN_PROPOSAL_MAX_AGE_DAYS = 62;

// Gov-proposal scan keywords, in two precision tiers.
//
// Lesson from the first live run: bare lifecycle verbs ("wind down", "sunset",
// "shutdown") match overwhelmingly feature/market/token actions — dYdX
// "Wind down X-USD market", Kujira "wind down USK", fetchhub upgrade halts —
// not chain death. So we split:
//
//   STRONG: phrases specific enough to stand alone (they almost always mean
//     the chain itself). A title hit here is reported on its own.
//   WEAK: lifecycle verbs that only count when they co-occur with a
//     chain-scope noun (CHAIN_SCOPE) in the same field, e.g. "Stargaze Chain
//     Sunset", "Shut Down Desmos Chain". A weak verb with no chain noun is
//     dropped as feature-level noise.
//
// Still recall-favouring within those constraints, and every hit is shown with
// its title for human triage — this only trims the obvious market/token rows.
const STRONG_SHUTDOWN_PHRASES = [
  'halt block production',
  'chain halt at height',
  'permanently halt the chain',
  'deprecate the chain',
  'cease chain operation',
  'cease block production',
  'shut down the chain',
  'chain shutdown',
  'chain sunset',
  'network shutdown',
  'network sunset',
  'mainnet shutdown',
  'mainnet sunset',
];

const WEAK_SHUTDOWN_VERBS = [
  'shut down',
  'shutdown',
  'sunset',
  'wind down',
  'winddown',
  'end of life',
  'end-of-life',
  'cease operation',
];

// A weak verb only counts when one of these chain-scope nouns appears in the
// same text. "market", "token", "pool", "module" are deliberately NOT here —
// those are the feature-level actions we want to exclude.
const CHAIN_SCOPE_NOUNS = ['chain', 'network', 'mainnet', 'blockchain', 'validator set'];

// Target-date / target-height extraction. A shutdown proposal usually names the
// date or block height the chain actually stops, which is the single most useful
// thing for a curator to lift into a `planned_shutdown_date`. We don't parse it
// into a canonical date (proposal prose is too varied to trust an auto-parse on
// a financially-sensitive field) — we just surface the candidate strings, in
// context, for the human to confirm. Recall-favouring on purpose.
const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|' +
  'aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_PATTERNS = [
  // ISO 8601: 2026-03-01 (optionally with time).
  /\b\d{4}-\d{2}-\d{2}(?:[ tT]\d{2}:\d{2}(?::\d{2})?z?)?\b/gi,
  // "1 March 2026" / "1st March 2026".
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?\\s+\\d{4}\\b`, 'gi'),
  // "March 1, 2026" / "March 2026".
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{4}\\b`, 'gi'),
  // Numeric: 01/03/2026 or 2026/03/01 (ambiguous order — surfaced verbatim).
  /\b\d{1,4}[/.]\d{1,2}[/.]\d{1,4}\b/g,
];
// "block height 12345678", "at height 12,345,678", "halt height: 12345678".
const HEIGHT_PATTERN = /\b(?:block\s+)?height[:\s]+#?([\d,]{5,})\b/gi;

// Cap how much extracted context the report carries per proposal, so a single
// noisy description can't blow up the PR body.
const MAX_TARGETS_PER_PROPOSAL = 4;

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const weekly = args.includes('--weekly');
const dryRun = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));
const zoneBasePath = positional[0] || 'osmosis-1';

const zonePath = path.join('..', '..', '..', zoneBasePath);
const statePath = path.join(zonePath, 'generated', 'state', 'state.json');
const streaksPath = path.join(zonePath, 'generated', 'state', 'dead_chain_streaks.json');
// Per-chain block-height history for run-over-run progression. Kept SEPARATE
// from the failure-streak file because it must survive a healthy run: when a
// chain's endpoints pass, its streak is deleted, but we still need the last
// height to detect a chain that goes from healthy to frozen. Owned solely by
// this script (like dead_chain_streaks.json).
const heightsPath = path.join(zonePath, 'generated', 'state', 'dead_chain_heights.json');
const chainlistPath = path.join(zonePath, 'generated', 'frontend', 'chainlist.json');
const frontendAssetlistPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');
const zoneAssetsPath = (() => {
  const filePrefix = zoneBasePath.split('-')[0];
  return path.join(zonePath, `${filePrefix}.zone_assets.json`);
})();

const nowMs = new Date().getTime();
const nowIso = new Date(nowMs).toISOString();

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    clearTimeout(id);
    return undefined;
  }
}

/**
 * Highest block height reported by any tested RPC endpoint this run, or null if
 * no endpoint answered /status. validateEndpoints attaches latestBlockHeight to
 * the RPC_ENDPOINTS ("status") test result. Used for run-over-run progression:
 * a height that does not advance across runs means the chain has halted, even if
 * its RPC still answers.
 */
function currentHeightFromState(stateChain) {
  let best = null;
  for (const e of stateChain?.allTestedEndpoints ?? []) {
    for (const t of e.testResults ?? []) {
      if (typeof t.latestBlockHeight === 'number' && Number.isFinite(t.latestBlockHeight)) {
        if (best === null || t.latestBlockHeight > best) best = t.latestBlockHeight;
      }
    }
  }
  return best;
}

/**
 * The freshest stale-block reading across a chain's tested endpoints this run:
 * the most recent latestBlockTime among status results flagged stale, plus the
 * height seen alongside it. "Freshest" (newest block time) deliberately — if any
 * endpoint reports a stale-but-newer block we show that, so the displayed age is
 * the least-alarming true reading, never overstated. Returns null when no stale
 * status result carries a usable block time.
 */
function staleBlockInfo(stateChain) {
  let newestMs = null;
  let info = null;
  for (const e of stateChain?.allTestedEndpoints ?? []) {
    for (const t of e.testResults ?? []) {
      if (t.stale !== true || !t.latestBlockTime) continue;
      const ms = new Date(t.latestBlockTime).getTime();
      if (Number.isNaN(ms)) continue;
      if (newestMs === null || ms > newestMs) {
        newestMs = ms;
        info = {
          blockTime: t.latestBlockTime,
          ageHours: (nowMs - ms) / (60 * 60 * 1000),
          height:
            typeof t.latestBlockHeight === 'number' ? t.latestBlockHeight : null,
        };
      }
    }
  }
  return info;
}

/**
 * Per-chain liveness verdict from this run's state.json record. A chain counts
 * as "all_dead" only when NO tested endpoint — RPC or REST — passed connectivity
 * (not just CORS; connectivity excludes CORS). "stale" means some endpoint
 * answered but reported a block older than the wall-clock staleness window. A
 * chain with zero tested endpoints is "unverifiable" (can't be probed), reported
 * separately and never auto-flagged. The "frozen" verdict (height not advancing
 * across runs) is NOT decided here — it needs the prior run's height, which lives
 * in the streak state, so runPart1 layers it on top of this single-run verdict.
 */
function classifyChainFromState(stateChain) {
  if (!stateChain) return { verdict: 'unknown' };

  const tested = stateChain.allTestedEndpoints ?? [];
  if (tested.length === 0) return { verdict: 'unverifiable' };

  // validationSuccess is true when a working RPC OR REST connectivity was found.
  if (stateChain.validationSuccess === true) return { verdict: 'alive' };

  // validationSuccess false → at least one direction has no working endpoint.
  // Distinguish "all endpoints dead" (every tested endpoint failed
  // connectivity) from "stale only" (some answered but the block is old).
  const anyConnectivityPass = tested.some((e) => e.connectivityPassed === true);
  const anyStale = tested.some((e) =>
    (e.testResults ?? []).some((t) => t.stale === true)
  );

  if (!anyConnectivityPass) return { verdict: 'all_dead' };
  if (anyStale) return { verdict: 'stale' };
  // Connectivity passed somewhere but the chain still failed overall (e.g. one
  // direction has no working endpoint). Treat as a softer "partial" signal.
  return { verdict: 'partial' };
}

/**
 * Corroborate a chain's death against status.cosmos.directory. Returns:
 *   { corroborates: true,  days, reason }   — external source agrees it's dead
 *   { corroborates: false, days, reason }   — external source shows it ALIVE
 *   { corroborates: null,  reason }          — couldn't tell (transport error)
 *
 * Decisions baked in (confirmed against a live early-corroboration run of all
 * flagged chains):
 *   • A 404 ("chain not tracked") and a tracked-but-zero-endpoints response
 *     COUNT AS corroborating death — cosmos.directory drops chains it can no
 *     longer reach, so absence is itself weak evidence of death.
 *   • A transport error / timeout is NOT corroborating — we genuinely don't
 *     know, so it must not be read as either alive or dead.
 *   • A recent success (< COSMOS_DIRECTORY_STALE_DAYS) actively REFUTES death;
 *     this is what caught nomic / arkh / gravitybridge / rebus failing
 *     Osmosis's probe while being alive elsewhere.
 */
async function cosmosDirectoryVerdict(chainName) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`https://status.cosmos.directory/${chainName}`, {
      signal: controller.signal,
    });
    clearTimeout(id);
  } catch {
    clearTimeout(id);
    return { corroborates: null, reason: 'fetch error (no signal)' };
  }

  // 404 → not tracked → treat as corroborating death.
  if (res.status === 404) {
    return { corroborates: true, days: Infinity, reason: 'not tracked (404)' };
  }
  if (!res.ok) {
    return { corroborates: null, reason: `HTTP ${res.status} (no signal)` };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { corroborates: null, reason: 'unparseable body (no signal)' };
  }

  // Payload shape (confirmed against chain-registry/_scripts/remove-stale-endpoints.py):
  //   { rpc: { current: { "<address>": { lastSuccessAt, ... } } }, rest: {...} }
  let best = -1;
  let count = 0;
  for (const type of ['rpc', 'rest']) {
    const current = data?.[type]?.current ?? {};
    for (const addr of Object.keys(current)) {
      count++;
      const t = Number(current[addr]?.lastSuccessAt ?? -1);
      if (t > best) best = t;
    }
  }

  // Tracked but no endpoints listed → nothing left reachable → corroborates.
  if (count === 0) {
    return { corroborates: true, days: Infinity, reason: 'no endpoints listed' };
  }
  // No success on record at all.
  if (best <= 0) {
    return { corroborates: true, days: Infinity, reason: 'no success on record' };
  }

  const days = (nowMs - best) / (24 * 60 * 60 * 1000);
  return {
    corroborates: days >= COSMOS_DIRECTORY_STALE_DAYS,
    days,
    reason: `${Math.floor(days)}d since success`,
  };
}

/**
 * Set of chain_names already in a curator-recorded TERMINAL state on any of
 * their zone_assets — either:
 *   • a planned_shutdown_date is set (knowingly dying; check_extended_halts
 *     owns the halt), or
 *   • any reason field reads source_chain_killed (the curator has already
 *     declared the source chain dead and halted the asset; the EVMOS case).
 *
 * Both reports exempt these: the chain is known and handled, so re-surfacing it
 * adds no information. Note this intentionally does NOT exempt softer reasons
 * like ibc_client / bridge_down / market — those describe a recoverable outage,
 * not a dead chain, and a chain stuck on one for 7+ days is exactly what the
 * dead-candidate report should escalate.
 */
const KILLED_REASON = 'source_chain_killed';
function knownTerminalChains(zoneAssets) {
  const terminal = new Set();
  for (const a of zoneAssets?.assets ?? []) {
    if (
      a.planned_shutdown_date ||
      a.osmosis_unstable_reason === KILLED_REASON ||
      a.osmosis_deposit_halt_reason === KILLED_REASON ||
      a.osmosis_withdrawal_halt_reason === KILLED_REASON
    ) {
      terminal.add(a.chain_name);
    }
  }
  return terminal;
}

/** True when any of an asset's reason fields is source_chain_killed. */
function isAssetKilled(a) {
  return (
    a.osmosis_unstable_reason === KILLED_REASON ||
    a.osmosis_deposit_halt_reason === KILLED_REASON ||
    a.osmosis_withdrawal_halt_reason === KILLED_REASON
  );
}

// ── Part 3: marked-killed-by-Osmosis-but-still-live-upstream ────────────────

/**
 * Upstreaming worklist. Chains Osmosis has flagged source_chain_killed on at
 * least one asset, but whose chain-registry status is NOT yet "killed". Each is
 * a candidate for an upstream `status: killed` PR (we've already done the
 * curation; the registry just hasn't caught up). Pure local data — no network —
 * so this runs on every run, daily and weekly.
 *
 * For "when did we mark it dead", we don't record a dedicated flag timestamp,
 * so we surface state.lastDowntimeDate as the closest proxy: the earliest
 * downtime first observed across the chain's killed assets. Labelled "first
 * seen down" rather than "marked killed" because that's what it actually is —
 * an approximate first-observed-dead date (and several chains share a single
 * backfill timestamp from when this tracking began).
 *
 * Host-chain exclusion: a chain whose own endpoints are still healthy
 * (state validationSuccess === true) is alive — the killed asset on it is a
 * wrapped/bridged/liquid-staking derivative of some OTHER dead chain (e.g. the
 * Router `.rt` assets on `osmosis`, milkINIT on `initia`, LSTs of dead chains
 * on `stride`/`quicksilver`). Killing the host chain upstream would be wrong,
 * so these are excluded from the worklist and surfaced separately for context.
 *
 * Returns { candidates, excludedHostChains } — candidates sorted by chain name,
 * each { chainName, registryStatus, assetCount, firstSeenDown }.
 */
function buildKilledNotUpstream(zoneAssets, frontendAssets, stateAssets, stateChains) {
  // state record by Osmosis coinMinimalDenom (state is keyed that way).
  const stateByDenom = new Map(
    (stateAssets ?? []).map((a) => [a.base_denom, a])
  );
  // (chainName, sourceDenom) → ALL matching coinMinimalDenoms. A single origin
  // pair can be listed on more than one IBC path (re-pathed assets whose old,
  // dead channel still lingers), each with a distinct coinMinimalDenom, so this
  // is a multimap — collapsing to one denom would drop the others' state dates.
  const denomsByChainSrc = new Map();
  for (const a of frontendAssets ?? []) {
    if (!a.chainName || !a.sourceDenom) continue;
    const k = `${a.chainName}|${a.sourceDenom}`;
    (denomsByChainSrc.get(k) ?? denomsByChainSrc.set(k, []).get(k)).push(a.coinMinimalDenom);
  }
  // chain_name → is the chain's own endpoint validation currently passing?
  const chainAlive = new Map(
    (stateChains ?? []).map((c) => [c.chain_name, c.validationSuccess === true])
  );

  const byChain = new Map();
  for (const a of zoneAssets?.assets ?? []) {
    if (!isAssetKilled(a)) continue;
    const registryStatus = getFileProperty(a.chain_name, 'chain', 'status') ?? 'unknown';
    if (registryStatus === 'killed') continue; // already upstreamed — nothing to do

    let row = byChain.get(a.chain_name);
    if (!row) {
      row = {
        chainName: a.chain_name,
        registryStatus,
        assetCount: 0,
        firstSeenDown: null,
        hostAlive: chainAlive.get(a.chain_name) === true,
      };
      byChain.set(a.chain_name, row);
    }
    row.assetCount++;

    // Earliest downtime across EVERY coinMinimalDenom this (chain, base_denom)
    // resolves to, so multi-path variants all contribute their date.
    for (const cmd of denomsByChainSrc.get(`${a.chain_name}|${a.base_denom}`) ?? []) {
      const downAt = stateByDenom.get(cmd)?.lastDowntimeDate;
      if (downAt && (!row.firstSeenDown || downAt < row.firstSeenDown)) {
        row.firstSeenDown = downAt;
      }
    }
  }

  const all = [...byChain.values()].sort((a, b) => a.chainName.localeCompare(b.chainName));
  return {
    candidates: all.filter((r) => !r.hostAlive),
    excludedHostChains: all.filter((r) => r.hostAlive).map((r) => r.chainName),
  };
}

// ── Part 1: dead-chain candidates ──────────────────────────────────────────

async function runPart1(state, chainlist, zoneAssets, streaks, heights) {
  const knownTerminal = knownTerminalChains(zoneAssets);

  populateChainDirectories();

  // Scope: only chains Osmosis actually lists an asset from. The report exists
  // to flag Osmosis deposit-risk surface and to drive a source_chain_killed /
  // status:killed follow-up on chains we have exposure to — not as a general
  // upstream registry-cleanup tool. Chains present in state.json/chainlist but
  // with no zone_asset (e.g. nim, mande, moo) are out of scope and skipped.
  const chainsWithAssets = new Set(
    (zoneAssets?.assets ?? []).map((a) => a.chain_name)
  );

  // Chains that hit the local consecutive-failure streak this run. Gated to
  // actual candidates by cosmos.directory corroboration below (weekly only).
  const streakReached = [];
  const unverifiable = [];
  // Daily snapshot of every chain whose endpoints answer but report a block over
  // an hour old (verdict 'stale'), regardless of streak maturity. Informational;
  // it does not change candidate gating. Split into recent vs long-stale at
  // render time. Each row: { chainName, registryStatus, ageHours, height, streak }.
  const currentlyStale = [];

  for (const stateChain of state.chains ?? []) {
    const chainName = stateChain.chain_name;
    if (!chainName) continue;

    if (!chainsWithAssets.has(chainName)) {
      delete streaks[chainName];
      delete heights[chainName];
      continue;
    }

    // Non-cosmos chains (ethereum, solana, tron, …) can't be health-checked by
    // Cosmos RPC /status or REST /node_info, so a failed validation there is
    // meaningless. Scope the whole detector to chain_type "cosmos". A chain
    // absent from the registry returns undefined and is also skipped.
    const chainType = getFileProperty(chainName, 'chain', 'chain_type');
    if (chainType !== 'cosmos') {
      delete streaks[chainName];
      delete heights[chainName];
      continue;
    }

    const registryStatus = getFileProperty(chainName, 'chain', 'status');
    // Already killed upstream → nothing to surface.
    if (registryStatus === 'killed') {
      delete streaks[chainName];
      delete heights[chainName];
      continue;
    }

    // Curator has already recorded a terminal state (planned_shutdown_date, or
    // source_chain_killed on the asset) → known and handled. Fully exempt: no
    // streak, no candidate row, not even an unverifiable mention. Mirrors the
    // same exemption in Part 2.
    if (knownTerminal.has(chainName)) {
      delete streaks[chainName];
      delete heights[chainName];
      continue;
    }

    let { verdict } = classifyChainFromState(stateChain);

    if (verdict === 'unverifiable') {
      // No testable endpoints this run. Don't advance the streak (no new
      // evidence) and don't reset it (a missing probe isn't a passing one) —
      // freeze it. But if a PRIOR streak is already mature, the chain still
      // carries solid accumulated evidence, so carry it into streakReached at
      // its existing (frozen) streak so weekly corroboration still runs and the
      // daily count still includes it. Only chains without a mature streak fall
      // through to the "unverifiable" bucket.
      const existing = streaks[chainName];
      if (existing && existing.streak >= DEAD_STREAK_THRESHOLD) {
        streakReached.push({
          chainName,
          registryStatus: registryStatus ?? 'unknown',
          streak: existing.streak,
          firstSeen: existing.firstSeen ?? nowIso,
          verdict: 'unverifiable',
        });
      } else {
        unverifiable.push({ chainName, registryStatus: registryStatus ?? 'unknown' });
      }
      continue;
    }

    // Block-height progression. A chain whose endpoints still answer /status but
    // whose height does not advance run-over-run has halted consensus — a death
    // signal that connectivity (endpoints respond) and wall-clock staleness (the
    // node may serve a recent-looking cached time) can both miss. Tracked in its
    // own persisted map so the last height survives a healthy run (when the
    // streak is deleted). stallRuns counts consecutive runs at the SAME height,
    // the run that first set a height counting as 1; FROZEN_HEIGHT_RUNS in a row
    // → frozen.
    const currentHeight = currentHeightFromState(stateChain);
    if (currentHeight !== null) {
      const prevH = heights[chainName];
      const stallRuns =
        prevH && prevH.height === currentHeight ? (prevH.stallRuns ?? 1) + 1 : 1;
      heights[chainName] = { height: currentHeight, stallRuns, lastSeen: nowIso };
      if (stallRuns >= FROZEN_HEIGHT_RUNS) {
        // Frozen overrides a benign verdict (alive/partial/stale): the chain is
        // not producing blocks regardless of whether endpoints answer.
        verdict = 'frozen';
      }
    }
    // No height this run (RPC didn't answer /status): leave the height record
    // untouched (carry the prior height/stall forward), same spirit as the
    // unverifiable freeze — a missing probe is not evidence the chain recovered.

    // Daily staleness snapshot. Any chain with a stale block reading this run
    // (an endpoint answered but its block is >1h old) is recorded for the daily
    // watch-list, independent of streak maturity. Captured here, but the row is
    // pushed AFTER the streak is resolved below so the displayed streak reflects
    // what actually happened this run — a stale RPC reading does NOT always
    // advance the streak: if REST connectivity passes the run verdict is 'alive'
    // and the streak resets to 0, even though one /status read was stale.
    const staleInfo = staleBlockInfo(stateChain);

    const isDeadSignal =
      verdict === 'all_dead' || verdict === 'stale' || verdict === 'frozen';
    let resolvedStreak = 0;
    if (!isDeadSignal) {
      // Any health on this run resets the streak. (Height history is preserved in
      // the separate heights map, so a later freeze is still detectable.) A stale
      // RPC reading on an otherwise-healthy chain still lands on the watch-list
      // below, but with a streak of 0 — it did not advance the kill streak.
      delete streaks[chainName];
    } else {
      // Increment the persistent consecutive-failure streak.
      const prev = streaks[chainName] ?? { streak: 0, firstSeen: nowIso };
      const next = {
        streak: prev.streak + 1,
        firstSeen: prev.firstSeen ?? nowIso,
        lastSeen: nowIso,
        lastVerdict: verdict,
      };
      streaks[chainName] = next;
      resolvedStreak = next.streak;
    }

    if (staleInfo) {
      currentlyStale.push({
        chainName,
        registryStatus: registryStatus ?? 'unknown',
        ageHours: staleInfo.ageHours,
        height: staleInfo.height,
        streak: resolvedStreak,
      });
    }

    if (!isDeadSignal) continue;

    if (resolvedStreak >= DEAD_STREAK_THRESHOLD) {
      streakReached.push({
        chainName,
        registryStatus: registryStatus ?? 'unknown',
        streak: resolvedStreak,
        firstSeen: streaks[chainName].firstSeen,
        verdict,
      });
    }
  }

  // Corroboration GATE. A chain is only published as a candidate when it has
  // BOTH hit the local streak AND been corroborated dead by cosmos.directory.
  // This is what stops single-/few-day Osmosis-probe failures on chains that
  // are actually alive (nomic, arkh, gravitybridge, rebus in the live test)
  // from ever surfacing as candidates.
  //
  // Corroboration requires a network call per chain, so it runs only on weekly
  // runs. On daily runs streaks still advance (above), but no candidate list is
  // published — the report says so explicitly rather than showing a half-gated
  // list. Chains whose streak is mature but which cosmos.directory shows ALIVE
  // are surfaced separately as "probe mismatches": that's a signal Osmosis's
  // own endpoint set for the chain is broken, not that the chain is dead.
  const candidates = [];
  const probeMismatches = [];
  if (weekly) {
    for (const c of streakReached) {
      const v = await cosmosDirectoryVerdict(c.chainName);
      c.cosmosDirectory = v.reason;
      c.cosmosDirectoryDays = v.days;
      if (v.corroborates === true) {
        candidates.push(c);
      } else if (v.corroborates === false) {
        probeMismatches.push(c); // alive externally; Osmosis probe is the problem
      }
      // corroborates === null → couldn't tell → drop from both (stay cautious).
    }
  }

  return {
    streakReached,
    candidates,
    probeMismatches,
    unverifiable,
    currentlyStale,
    weeklyGated: weekly,
  };
}

// ── Part 2: planned-shutdown discovery via governance proposals ─────────────

/**
 * Pull candidate shutdown dates and block heights out of proposal prose. We do
 * NOT canonicalise — the strings are surfaced verbatim for a human to lift into
 * `planned_shutdown_date`. Returns up to MAX_TARGETS_PER_PROPOSAL unique, short
 * snippets across all date/height patterns. `text` should be the ORIGINAL-case
 * title+body (case matters for readability, the regexes are case-insensitive).
 */
function extractTargets(text) {
  if (!text) return [];
  const found = [];
  const seen = new Set();
  const push = (s) => {
    const v = s.trim();
    const key = v.toLowerCase();
    if (v && !seen.has(key)) {
      seen.add(key);
      found.push(v);
    }
  };
  for (const re of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) push(m[0]);
  }
  for (const m of text.matchAll(HEIGHT_PATTERN)) {
    // Keep the matched substring (e.g. "height 12,345,678"), trimmed, so the
    // reader sees it's a height not a date.
    push(m[0].replace(/\s+/g, ' '));
  }
  return found.slice(0, MAX_TARGETS_PER_PROPOSAL);
}

/**
 * Pull recent governance proposals from a chain's first working REST endpoint
 * (recorded in state.json validatedEndpoints) and keyword-match for shutdown
 * language. Tries gov v1 first, falls back to v1beta1. Returns matched
 * proposals with the text that matched, for human triage.
 */
async function scanGovProposals(chainName, restAddress) {
  if (!restAddress) return [];
  const base = restAddress.replace(/\/+$/, '');

  // v1 first (status 3 = PASSED, but we scan all recent regardless of status:
  // a voting/passed shutdown proposal is exactly what we want to catch early).
  const endpoints = [
    `${base}/cosmos/gov/v1/proposals?pagination.limit=50&pagination.reverse=true`,
    `${base}/cosmos/gov/v1beta1/proposals?pagination.limit=50&pagination.reverse=true`,
  ];

  for (const url of endpoints) {
    const data = await fetchJsonWithTimeout(url);
    const proposals = data?.proposals;
    if (!Array.isArray(proposals) || proposals.length === 0) continue;

    const matches = [];
    for (const p of proposals) {
      // v1: { id, title, summary }. v1beta1: { proposal_id, content: { title, description } }.
      const id = p.id ?? p.proposal_id ?? '?';
      const title = p.title ?? p.content?.title ?? '';
      const body = p.summary ?? p.content?.description ?? '';
      const hay = `${title}\n${body}`.toLowerCase();

      // Strong phrase anywhere → report.
      let hit = STRONG_SHUTDOWN_PHRASES.find((kw) => hay.includes(kw));

      // Otherwise a weak verb only counts when a chain-scope noun co-occurs,
      // which filters "wind down X-USD market" / "sunset $TOKEN" / feature
      // halts that dominated the first run.
      if (!hit) {
        const weak = WEAK_SHUTDOWN_VERBS.find((kw) => hay.includes(kw));
        if (weak && CHAIN_SCOPE_NOUNS.some((n) => hay.includes(n))) {
          hit = weak;
        }
      }

      if (!hit) continue;

      const targets = extractTargets(`${title}\n${body}`);

      // Recency gate (hard cutoff). Drop proposals filed longer ago than the
      // cutoff, since an actionable planned shutdown is recent by nature and the
      // old hits are resolved-governance noise. There is no future-target
      // exception: a proposal filed more than the cutoff ago is dropped even if
      // it names a concrete date/height. submit_time absent (unparseable) → keep,
      // so a missing timestamp never silently hides a hit.
      const submitMs = p.submit_time ? new Date(p.submit_time).getTime() : NaN;
      const ageDays = Number.isNaN(submitMs)
        ? null
        : (nowMs - submitMs) / (24 * 60 * 60 * 1000);
      if (ageDays !== null && ageDays > SHUTDOWN_PROPOSAL_MAX_AGE_DAYS) {
        continue;
      }

      matches.push({
        chainName,
        proposalId: id,
        title: title.slice(0, 120),
        matchedKeyword: hit,
        // Title hits are far higher-signal than body-only hits; flag so the
        // report can sort them to the top.
        inTitle: title.toLowerCase().includes(hit),
        status: p.status ?? p.status,
        // Proposal recency: submit_time is top-level on both v1 and v1beta1,
        // voting_end_time too. We show submit_time (when it was filed) as the
        // "how new is this result" signal; a curator reading the weekly report
        // wants to know whether this is a fresh proposal or one from a year ago
        // that already resolved. Sliced to the date (YYYY-MM-DD).
        submitTime: (p.submit_time ?? '').slice(0, 10),
        votingEndTime: (p.voting_end_time ?? '').slice(0, 10),
        // Candidate shutdown date(s) / block height(s) lifted from the prose,
        // verbatim, for the curator to confirm into planned_shutdown_date.
        targets,
      });
    }
    // Return as soon as an endpoint yields matches. If an endpoint returned
    // proposals but NONE matched, fall through to the next (v1beta1): legacy
    // proposals can carry shutdown wording in content.description that the v1
    // view exposes as an empty `summary`, so a zero-match v1 response must not
    // suppress the v1beta1 scan.
    if (matches.length > 0) return matches;
  }
  return [];
}

async function runPart2(state, chainlist, zoneAssets) {
  // Idempotent: just fills the chainName→directory Map. Calling it here too
  // means Part 2 doesn't depend on Part 1 having run first.
  populateChainDirectories();

  // Chains in a known terminal state (planned_shutdown_date or
  // source_chain_killed) are skipped — the curator already knows. Same
  // exemption as Part 1.
  const knownTerminal = knownTerminalChains(zoneAssets);

  const listedChainNames = new Set(
    (chainlist?.chains ?? []).map((c) => c.chain_name)
  );

  // Only scan chains Osmosis actually lists (the surface we care about) and
  // for which we have a known-good REST endpoint from this run.
  const restByChain = new Map();
  for (const sc of state.chains ?? []) {
    const rest = sc.validatedEndpoints?.restAddress;
    if (rest && listedChainNames.has(sc.chain_name)) {
      restByChain.set(sc.chain_name, rest);
    }
  }

  const targets = [...restByChain.entries()].filter(([chainName]) => {
    if (knownTerminal.has(chainName)) return false;
    // Already killed upstream → it's dead, a shutdown proposal is moot.
    if (getFileProperty(chainName, 'chain', 'status') === 'killed') return false;
    return true;
  });

  // Bounded concurrency: ~100 chains × an 8s worst-case timeout would blow the
  // CI latency budget if run sequentially. A pool of 12 keeps the weekly scan
  // to roughly (chains / 12) × slowest-response, while staying gentle on the
  // public LCDs.
  const POOL = 12;
  const findings = [];
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const [chainName, rest] = targets[cursor++];
      const matches = await scanGovProposals(chainName, rest);
      findings.push(...matches);
    }
  }
  await Promise.all(Array.from({ length: POOL }, () => worker()));
  return findings;
}

// ── Report rendering ─────────────────────────────────────────────────────────

function renderReport({ part1, part2, part3 }) {
  const lines = [];
  lines.push('## ⚰️ Dead chain candidates');
  lines.push('');
  lines.push(
    `_Chains Osmosis lists an asset from, registered as live, that have shown a ` +
      `death signal on the Osmosis endpoint probe for ${DEAD_STREAK_THRESHOLD}+ ` +
      `consecutive runs AND which status.cosmos.directory corroborates as ` +
      `dead. Candidates for a \`source_chain_killed\` flag and an upstream ` +
      `chain-registry \`status: killed\` PR. Verify before acting._`
  );
  lines.push('');
  lines.push(
    `_**Endpoint probe** verdicts: \`all_dead\` = no RPC or REST endpoint passed ` +
      `connectivity (CORS excluded); \`stale\` = an endpoint answered but its ` +
      `latest block is over an hour old; \`frozen\` = endpoints answer but the ` +
      `block height has not advanced across ${FROZEN_HEIGHT_RUNS} consecutive ` +
      `runs (consensus halted)._`
  );
  lines.push('');
  lines.push(
    `> **On the cosmos.directory signal:** it sources its chain and endpoint ` +
      `list from the cosmos chain-registry, then probes those endpoints. So a ` +
      `stale \`lastSuccessAt\` age IS an independent measurement (real probes ` +
      `against live endpoints), but a 404 / "not tracked" only means the chain ` +
      `isn't in the registry's monitored set (partly circular with the very ` +
      `registry change we're proposing), so treat 404-only corroboration as ` +
      `weak. The local ${DEAD_STREAK_THRESHOLD}-run streak is the independent ` +
      `half of the gate._`
  );
  lines.push('');

  if (!part1.weeklyGated) {
    // Daily run: streaks advanced but corroboration (the gate) didn't run.
    lines.push(
      `_Candidate list publishes on the weekly corroborated run. ` +
        `${part1.streakReached.length} chain(s) currently at or past the ` +
        `${DEAD_STREAK_THRESHOLD}-run streak, pending corroboration._`
    );
  } else if (!part1.candidates.length) {
    lines.push('_None corroborated._');
  } else {
    // Signal columns are grouped: the two independent death signals (the local
    // Osmosis endpoint probe and the cosmos.directory corroboration) sit
    // adjacent, so a reader sees at a glance what each one read. "Streak (days)"
    // is the consecutive-failure run count (one per daily run); "First reported"
    // is the date the streak began.
    lines.push(
      '| Chain | Registry status | Endpoint probe | cosmos.directory | Streak (days) | First reported |'
    );
    lines.push(
      '|-------|-----------------|----------------|------------------|---------------|----------------|'
    );
    for (const c of part1.candidates) {
      lines.push(
        `| ${c.chainName} | ${c.registryStatus} | ${c.verdict} | ${c.cosmosDirectory} | ` +
          `${c.streak} | ${c.firstSeen.slice(0, 10)} |`
      );
    }
  }

  // Probe mismatches: streak mature, but cosmos.directory shows the chain ALIVE.
  // This is an Osmosis-side endpoint problem, not a dead chain — surfacing it
  // lets a curator fix the chain's endpoint set rather than wrongly kill it.
  if (part1.weeklyGated && part1.probeMismatches.length) {
    lines.push('');
    lines.push(
      `<details><summary>⚠️ Probe mismatches (${part1.probeMismatches.length}) — ` +
        `failing Osmosis validation ${DEAD_STREAK_THRESHOLD}+ runs but ALIVE on ` +
        `cosmos.directory. Osmosis's endpoint set is likely the problem, not the chain.</summary>`
    );
    lines.push('');
    lines.push(
      '| Chain | Streak (days) | cosmos.directory |'
    );
    lines.push('|-------|---------------|------------------|');
    for (const c of part1.probeMismatches) {
      lines.push(`| ${c.chainName} | ${c.streak} | ${c.cosmosDirectory} |`);
    }
    lines.push('');
    lines.push('</details>');
  }

  // Daily staleness watch-list. Every chain whose endpoints answer but report a
  // block over an hour old, this run — independent of streak maturity, so it
  // shows on daily runs too. Split by age: recently-stale chains (under
  // RECENT_STALE_DAYS) may have JUST halted and are surfaced VISIBLY so a live
  // incident is caught early; longer-stale chains are most likely long-abandoned
  // and fold into a collapsed block. The streak/cosmos.directory kill pipeline is
  // unaffected — this is a view, not a new escalation path.
  if (part1.currentlyStale?.length) {
    const recent = part1.currentlyStale
      .filter((c) => c.ageHours < RECENT_STALE_DAYS * 24)
      .sort((a, b) => a.ageHours - b.ageHours);
    const longStale = part1.currentlyStale
      .filter((c) => c.ageHours >= RECENT_STALE_DAYS * 24)
      .sort((a, b) => a.ageHours - b.ageHours);

    const fmtAge = (h) =>
      h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;

    if (recent.length) {
      lines.push('');
      lines.push(
        `### ⏱️ Recently stale — possibly halted (${recent.length})`
      );
      lines.push('');
      lines.push(
        `_Endpoints answer but the latest block is over an hour old and under ` +
          `${RECENT_STALE_DAYS} days — recent enough that the chain may have just ` +
          `halted. Worth a look now; not yet a kill candidate (still subject to ` +
          `the ${DEAD_STREAK_THRESHOLD}-run streak + corroboration). Streak is the ` +
          `consecutive death-signal run count so far._`
      );
      lines.push('');
      lines.push('| Chain | Registry status | Block age | Height | Streak (days) |');
      lines.push('|-------|-----------------|-----------|--------|---------------|');
      for (const c of recent) {
        lines.push(
          `| ${c.chainName} | ${c.registryStatus} | ${fmtAge(c.ageHours)} | ` +
            `${c.height ?? '-'} | ${c.streak} |`
        );
      }
    }

    if (longStale.length) {
      lines.push('');
      lines.push(
        `<details><summary>Long-stale chains (block ≥ ${RECENT_STALE_DAYS}d old, ` +
          `${longStale.length}) — endpoints answer but likely long-abandoned</summary>`
      );
      lines.push('');
      lines.push('| Chain | Registry status | Block age | Height | Streak (days) |');
      lines.push('|-------|-----------------|-----------|--------|---------------|');
      for (const c of longStale) {
        lines.push(
          `| ${c.chainName} | ${c.registryStatus} | ${fmtAge(c.ageHours)} | ` +
            `${c.height ?? '-'} | ${c.streak} |`
        );
      }
      lines.push('');
      lines.push('</details>');
    }
  }

  if (part1.unverifiable.length) {
    lines.push('');
    lines.push(
      `<details><summary>Unverifiable chains (zero testable endpoints, ${part1.unverifiable.length}) — cannot confirm dead or alive</summary>`
    );
    lines.push('');
    lines.push(
      part1.unverifiable.map((u) => `${u.chainName} (${u.registryStatus})`).join(', ')
    );
    lines.push('');
    lines.push('</details>');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 🗓️ Possible planned shutdowns');
  lines.push('');
  if (!weekly) {
    lines.push(
      '_Skipped this run (governance-proposal scan runs weekly to bound CI cost and external load)._'
    );
  } else if (!part2.length) {
    lines.push('_No shutdown-language governance proposals detected._');
  } else {
    lines.push(
      `_Governance proposals on listed chains matching shutdown language, ` +
        `filed within the last ${SHUTDOWN_PROPOSAL_MAX_AGE_DAYS} days (older ones ` +
        `are skipped). Sorted newest-submitted first for a quick priority check. ` +
        `False positives are expected (a ` +
        `proposal may reject or merely discuss a shutdown). **Submitted** is the ` +
        `proposal filing date (how new this result is); **Target date / height** ` +
        `lists date/height strings lifted verbatim from the proposal text ` +
        `(unparsed — confirm before trusting). Verify, then a curator may set ` +
        `\`planned_shutdown_date\` on the zone_asset to drive the existing halt ` +
        `automation._`
    );
    lines.push('');
    lines.push(
      '| Chain | Proposal | Submitted | Target date / height | Matched phrase | In title | Status | Title |'
    );
    lines.push(
      '|-------|----------|-----------|----------------------|----------------|----------|--------|-------|'
    );
    // Sort newest-submitted first: Submitted date is the primary key (a quick
    // priority check — the freshest proposals are the ones a curator most likely
    // still needs to act on). Within the same submit date, break ties by title
    // hit (higher signal than a body-only match), then chain name.
    const sorted = [...part2].sort((a, b) => {
      if (a.submitTime !== b.submitTime) {
        return (b.submitTime || '').localeCompare(a.submitTime || '');
      }
      if (a.inTitle !== b.inTitle) return a.inTitle ? -1 : 1;
      return a.chainName.localeCompare(b.chainName);
    });
    for (const m of sorted) {
      // Strip the verbose PROPOSAL_STATUS_ prefix for readability.
      const status = (m.status ?? '-').replace(/^PROPOSAL_STATUS_/, '');
      const targets = (m.targets ?? []).length
        ? m.targets.map((t) => `\`${t.replace(/\|/g, '\\|')}\``).join('<br>')
        : '-';
      lines.push(
        `| ${m.chainName} | #${m.proposalId} | ${m.submitTime || '-'} | ${targets} | ` +
          `\`${m.matchedKeyword}\` | ${m.inTitle ? 'yes' : 'no'} | ${status} | ` +
          `${m.title.replace(/\|/g, '\\|')} |`
      );
    }
  }

  // ── Part 3: marked killed by Osmosis, still live upstream ──────────────────
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 📤 Marked killed by Osmosis, not yet killed upstream');
  lines.push('');
  if (!weekly) {
    // Static worklist that only changes when we mark a new chain killed or an
    // upstream PR merges — daily repetition is reviewer noise, so show it on
    // the weekly run only (same cadence as Part 2).
    lines.push(
      '_Skipped this run (upstreaming worklist is shown on the weekly run to keep daily PRs concise)._'
    );
  } else {
    lines.push(
      `_Chains Osmosis has flagged \`source_chain_killed\` on at least one asset, ` +
        `but whose chain-registry status is not yet \`killed\`. Each is a candidate ` +
        `for an upstream \`status: killed\` PR to cosmos/chain-registry — the ` +
        `curation is already done on our side. "First seen down" is the earliest ` +
        `\`state.lastDowntimeDate\` across the chain's killed assets (an approximate ` +
        `first-observed-dead date, not a precise flag timestamp; chains sharing one ` +
        `date were backfilled when this tracking began)._`
    );
    lines.push('');
    const part3Candidates = part3?.candidates ?? [];
    const part3Excluded = part3?.excludedHostChains ?? [];
    if (!part3Candidates.length) {
      lines.push('_None — our killed set matches upstream._');
    } else {
      lines.push('| Chain | Registry status | Killed assets | First seen down |');
      lines.push('|-------|-----------------|---------------|-----------------|');
      for (const r of part3Candidates) {
        lines.push(
          `| ${r.chainName} | ${r.registryStatus} | ${r.assetCount} | ` +
            `${r.firstSeenDown ? r.firstSeenDown.slice(0, 10) : '-'} |`
        );
      }
    }
    if (part3Excluded.length) {
      lines.push('');
      lines.push(
        `_Excluded (host chain still live — the killed asset is a bridged / ` +
          `liquid-staking derivative of another dead chain, so the host itself ` +
          `should not be killed upstream): ${part3Excluded.join(', ')}._`
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const state = loadJSON(statePath, { chains: [], assets: [] });
  const chainlist = loadJSON(chainlistPath, { chains: [] });
  const frontendAssetlist = loadJSON(frontendAssetlistPath, { assets: [] });
  const zoneAssets = loadJSON(zoneAssetsPath, { assets: [] });
  const streaks = loadJSON(streaksPath, {});
  const heights = loadJSON(heightsPath, {});

  const part1 = await runPart1(state, chainlist, zoneAssets, streaks, heights);
  const part2 = weekly ? await runPart2(state, chainlist, zoneAssets) : [];
  // Part 3 is a static upstreaming worklist; rendered weekly only (daily
  // repetition is reviewer noise), so only compute it on weekly runs.
  const part3 = weekly
    ? buildKilledNotUpstream(
        zoneAssets,
        frontendAssetlist.assets,
        state.assets,
        state.chains
      )
    : { candidates: [], excludedHostChains: [] };

  if (!dryRun) {
    fs.writeFileSync(streaksPath, JSON.stringify(streaks, null, 2) + '\n', 'utf8');
    fs.writeFileSync(heightsPath, JSON.stringify(heights, null, 2) + '\n', 'utf8');
  }

  // The report goes to stdout so the workflow can capture and append it to the
  // PR body, matching how validateEndpoints generateReport is consumed.
  const report = renderReport({ part1, part2, part3 });
  process.stdout.write(report + '\n');

  // Diagnostic counts to stderr (kept out of the captured report).
  const frozenReached = part1.streakReached.filter((c) => c.verdict === 'frozen').length;
  const recentStale = (part1.currentlyStale ?? []).filter(
    (c) => c.ageHours < RECENT_STALE_DAYS * 24
  ).length;
  console.error(
    `dead_chain streak_reached=${part1.streakReached.length} ` +
      `frozen=${frozenReached} ` +
      `stale_total=${(part1.currentlyStale ?? []).length} ` +
      `stale_recent=${recentStale} ` +
      `candidates=${part1.candidates.length} ` +
      `probe_mismatches=${part1.probeMismatches.length} ` +
      `unverifiable=${part1.unverifiable.length} ` +
      `planned_shutdown_hits=${part2.length} ` +
      `killed_not_upstream=${part3.candidates.length} ` +
      `killed_excluded_host=${part3.excludedHostChains.length} weekly=${weekly}`
  );
}

main().catch((err) => {
  console.error('Fatal error in report_dead_chains:', err);
  // Report-only script: never fail the pipeline over a reporting hiccup.
  process.stdout.write(
    '## ⚰️ Dead chain candidates\n\n_Report generation failed this run; see workflow logs._\n'
  );
  process.exit(0);
});
