// Purpose:
//   Machine-translate language_files/en.json (written by
//   setAssetDetailLocalizationInput during generation) into the other locale
//   files under language_files/, in the same nested shape, so that
//   localization_post.mjs can merge them into the asset_detail files.
//
//   This replaces the former `pnpm inlang machine translate --force` step.
//   The inlang-hosted translation RPC that @inlang/cli 1.20.0 depended on was
//   decommissioned (every call returned Internal Server Error), and the v3 CLI
//   aborts each request after a fixed 15 seconds, which real description
//   lengths exceed on the keyless service. Calling the service directly lets
//   us control timeout, retries, and concurrency.
//
//   The service is the keyless community translation endpoint at
//   translate.demosjarco.dev (Cloudflare Workers AI, Google Translate
//   v2-compatible API). It is not operated by us; treat outages as expected.
//   Failures here must never fail the workflow: missing translations degrade
//   to English-only descriptions (localization.mjs merges partial locale sets
//   and re-queues incomplete assets on the next generation run).
//
// Usage (from .github/workflows/utility/):
//   node translate_language_files.mjs [--dry-run]

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

//-- Config --

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetlistsRoot = path.join(scriptDir, "..", "..", "..");
const languageFilesDir = path.join(assetlistsRoot, "language_files");
const languagesDir = path.join(assetlistsRoot, "languages");
const defaultLocalizationCode = "en";
const fileExtension = ".json";

const TRANSLATE_API_URL =
  process.env.TRANSLATE_API_URL ??
  "https://translate.demosjarco.dev/language/translate/v2";
const REQUEST_TIMEOUT_MS = 120000; // LLM-backed; long descriptions take 20-40s
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [5000, 15000];
const CONCURRENCY = 3; // stay polite to the free community service

// Run-wide bound: with retries, a full-outage worst case is ~380s per
// string-locale pair, which on a busy queue would brush the 6-hour GitHub
// Actions job limit. Past the deadline, or after the circuit breaker trips
// on consecutive failures, remaining pairs are skipped; they re-queue on the
// next daily run.
const RUN_DEADLINE_MS = Number(
  process.env.TRANSLATE_RUN_DEADLINE_MS ?? 20 * 60 * 1000
);
const CIRCUIT_BREAKER_THRESHOLD = 8;

const dryRun = process.argv.includes("--dry-run");

//-- Helpers --

function getLocalizationCodes() {
  const files = fs.readdirSync(languagesDir);
  return files.map((file) => path.basename(file, path.extname(file)));
}

function readEnInput() {
  const filePath = path.join(
    languageFilesDir,
    defaultLocalizationCode + fileExtension
  );
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

// Collect every leaf string as {chainName, assetBase, propertyName, text}
function collectLeaves(enInput) {
  const leaves = [];
  for (const chainName in enInput) {
    for (const assetBase in enInput[chainName]) {
      const properties = enInput[chainName][assetBase];
      for (const propertyName in properties) {
        const text = properties[propertyName];
        if (typeof text !== "string" || text.length === 0) {
          continue;
        }
        leaves.push({ chainName, assetBase, propertyName, text });
      }
    }
  }
  return leaves;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Guard against a compromised or misbehaving translation service: the output
// lands, auto-merged, in user-facing asset descriptions, so reject anything
// that adds link-like tokens absent from the English source, contains markup
// or Markdown link syntax, or is wildly out of proportion to the source.
// Detection is generic rather than TLD-allowlisted: any dot-separated token
// with an alphabetic final label reads as a domain, and any scheme:// counts
// as a URL, so an attacker cannot route around a fixed TLD list. This still
// cannot be exhaustive against an adversary (spelled-out dots, homoglyphs),
// but every rejection is fail-safe: the locale stays English and re-queues,
// and the warning annotation makes repeated rejections visible. A rejected
// pair advances the circuit breaker like any other failure, so an endpoint
// serving malicious 200s gets cut off the same way as an outage.
const DOMAIN_TOKEN_PATTERN = /\b(?:[A-Za-z0-9_-]+\.)+[A-Za-z]{2,24}\b/g;
// Complete URLs (scheme, authority, and path), not just the scheme: comparing
// schemes alone let a translation swap the destination behind a source URL
// (https://192.0.2.1, or a different path on the legitimate domain).
// URL tokens span the full RFC-3986 ASCII character set, including parens
// (paths like /path(claim)) and brackets (IPv6 authorities), but stay
// ASCII-only so a token ends where surrounding prose begins even with no
// space: agglutinative languages attach particles directly to URLs (Korean
// "https://sovrentech.io를"), which must compare equal to the source URL,
// while any ASCII path/query an attacker appends lands inside the token and
// mismatches. Wrapping punctuation is trimmed afterwards (trailing sentence
// punctuation, and closers with no matching opener inside the token, so a
// Markdown or prose ")" is dropped while a balanced "/path(claim)" is kept).
const URL_CANDIDATE_CHARS = "[A-Za-z0-9\\-._~:/?#@!$&*+,;=%()\\[\\]]";
const URL_PATTERN = new RegExp(
  `\\b[a-z][a-z0-9+.-]*:\\/\\/${URL_CANDIDATE_CHARS}+`,
  "gi"
);
// Protocol-relative authorities (//host/...): the lookbehind excludes the //
// inside scheme:// URLs, which URL_PATTERN already captures whole.
const PROTOCOL_RELATIVE_PATTERN = new RegExp(
  `(?<![:\\w])\\/\\/${URL_CANDIDATE_CHARS}+`,
  "g"
);
function trimUrlToken(raw) {
  const count = (s, ch) => s.split(ch).length - 1;
  let token = raw;
  for (;;) {
    const before = token;
    token = token.replace(/[.,;:!?]+$/, "");
    while (token.endsWith(")") && count(token, "(") < count(token, ")")) {
      token = token.slice(0, -1);
    }
    while (token.endsWith("]") && count(token, "[") < count(token, "]")) {
      token = token.slice(0, -1);
    }
    if (token === before) {
      break;
    }
  }
  return token;
}
// Canonicalize through the standard URL parser so equivalent spellings
// compare equal ("https://x.io" vs "https://x.io/", default ports). The
// parser lowercases the case-INsensitive components (scheme, host) and
// preserves the case-SENSITIVE ones (path, query, fragment), so /SafePath
// and /safepath stay distinct destinations. Protocol-relative tokens get a
// scheme so the same authority with and without one compares equal. Tokens
// the parser refuses are lowercased only when they are bare domains (hosts
// are case-insensitive); anything else, e.g. a relative Markdown
// destination, keeps its case.
function canonicalizeUrl(token) {
  const withScheme = token.startsWith("//") ? `https:${token}` : token;
  try {
    return new URL(withScheme).href;
  } catch {
    return /^(?:[A-Za-z0-9_-]+\.)+[A-Za-z]{2,24}$/.test(token)
      ? token.toLowerCase()
      : token;
  }
}
// Strict IPv4 octets (0-255, no leading zeros): European number formatting
// turns "1,000,000,000" into "1.000.000.000", which a loose \d{1,3} octet
// pattern falsely flagged as an IP in real translations.
const IP_PATTERN =
  /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g;
// Markdown destinations, so [text](/redirect) style targets are compared too.
const MARKDOWN_DEST_PATTERN = /\]\(\s*([^)\s]+)/g;
const DANGEROUS_SCHEME_PATTERN = /\b(?:javascript|data|vbscript):/i;
function extractLinkTokens(text) {
  // Normalize unicode dot lookalikes so "claim。co" reads as "claim.co".
  const normalized = text.replace(/[。．｡]/g, ".");
  const tokens = [
    ...(normalized.match(DOMAIN_TOKEN_PATTERN) ?? []),
    ...(normalized.match(URL_PATTERN) ?? []),
    ...(normalized.match(PROTOCOL_RELATIVE_PATTERN) ?? []),
    ...(normalized.match(IP_PATTERN) ?? []),
    ...[...normalized.matchAll(MARKDOWN_DEST_PATTERN)].map((m) => m[1]),
  ];
  return tokens.map((token) => canonicalizeUrl(trimUrlToken(token)));
}
export function validateTranslation(sourceText, translatedText) {
  if (/<[a-zA-Z/][^>]*>/.test(translatedText)) {
    return "contains markup";
  }
  if (DANGEROUS_SCHEME_PATTERN.test(translatedText)) {
    return "contains dangerous URI scheme";
  }
  if (/\]\s*\(/.test(translatedText) && !/\]\s*\(/.test(sourceText)) {
    return "contains Markdown link syntax";
  }
  const sourceLinks = new Set(extractLinkTokens(sourceText));
  for (const token of extractLinkTokens(translatedText)) {
    if (!sourceLinks.has(token)) {
      return `adds link-like token "${token}"`;
    }
  }
  // Loose bounds only: CJK translations legitimately compress well below 1/10
  // of the English length, and Indic scripts expand. This catches injected
  // essays and truncated junk, not normal variation.
  if (
    translatedText.length >
      Math.max(sourceText.length * 4, sourceText.length + 200) ||
    translatedText.length < sourceText.length * 0.05
  ) {
    return `implausible length (${translatedText.length} chars vs ${sourceText.length} source)`;
  }
  return undefined;
}

async function translateText(text, targetLocale, deadlineAt) {
  const query = new URLSearchParams({
    q: text,
    target: targetLocale,
    source: defaultLocalizationCode,
    // "text", not "html": html mode HTML-escapes the output (& -> &amp;),
    // which would leak entities into asset_detail descriptions. The old inlang
    // CLI needed html only to protect placeholder spans, which we don't use.
    format: "text",
  });
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      return { ok: false, error: "run deadline reached", skipped: true };
    }
    try {
      const response = await fetch(`${TRANSLATE_API_URL}?${query}`, {
        method: "POST",
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        // 4xx generally won't improve on retry, except 429 and 403: the
        // service sits behind Cloudflare, which intermittently challenges
        // GitHub runner IPs with 403s that clear on retry (observed 13/160
        // in the first production run, on a runner that got 137 successes).
        if (
          response.status < 500 &&
          response.status !== 429 &&
          response.status !== 403
        ) {
          break;
        }
      } else {
        const json = await response.json();
        const translatedText = json?.data?.translations?.[0]?.translatedText;
        if (typeof translatedText === "string" && translatedText.length > 0) {
          return { ok: true, translatedText };
        }
        lastError = "malformed response";
      }
    } catch (error) {
      lastError = error?.name === "TimeoutError" ? "timeout" : String(error);
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS[attempt - 1] ?? 15000);
    }
  }
  return { ok: false, error: lastError };
}

// Minimal task pool: run tasks with bounded concurrency.
async function runPool(tasks, concurrency) {
  const queue = [...tasks];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      await task();
    }
  });
  await Promise.all(workers);
}

function emitWarning(message) {
  // GitHub Actions annotation; harmless plain output elsewhere.
  console.log(`::warning::${message}`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, `> [!WARNING]\n> ${message}\n\n`);
  }
}

//-- Main --

async function main() {
  const enInput = readEnInput();
  if (!enInput) {
    console.log("No language_files/en.json found; nothing to translate.");
    return;
  }
  const leaves = collectLeaves(enInput);
  if (leaves.length === 0) {
    console.log("language_files/en.json contains no strings; nothing to do.");
    return;
  }

  const targetLocales = getLocalizationCodes().filter(
    (code) => code !== defaultLocalizationCode
  );
  console.log(
    `Translating ${leaves.length} string(s) to ${targetLocales.length} locale(s) via ${TRANSLATE_API_URL}`
  );
  if (dryRun) {
    leaves.forEach((leaf) =>
      console.log(
        `[dry-run] ${leaf.chainName}/${leaf.assetBase}.${leaf.propertyName} (${leaf.text.length} chars)`
      )
    );
    return;
  }

  // Remove any leftover target-locale files (e.g. from an interrupted earlier
  // run) so stale translations of a different en.json can never reach the
  // merge: only files written by this run survive.
  for (const locale of targetLocales) {
    fs.rmSync(path.join(languageFilesDir, locale + fileExtension), {
      force: true,
    });
  }

  const outputs = {}; // locale -> nested object mirroring en.json
  const failures = [];
  let translatedCount = 0;
  let skippedCount = 0;
  const deadlineAt = Date.now() + RUN_DEADLINE_MS;
  const breaker = { consecutiveFailures: 0, tripped: false };

  // Request failures and validation rejections share one accounting path, so
  // an endpoint serving repeated malicious or malformed 200s trips the same
  // circuit breaker as an outage.
  const registerFailure = (message) => {
    failures.push(message);
    breaker.consecutiveFailures++;
    if (
      breaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD &&
      !breaker.tripped
    ) {
      breaker.tripped = true;
      console.log(
        `Circuit breaker tripped after ${CIRCUIT_BREAKER_THRESHOLD} consecutive failures; skipping remaining translations this run.`
      );
    }
  };

  const tasks = [];
  for (const locale of targetLocales) {
    for (const leaf of leaves) {
      tasks.push(async () => {
        if (breaker.tripped || Date.now() >= deadlineAt) {
          skippedCount++;
          return;
        }
        const result = await translateText(leaf.text, locale, deadlineAt);
        if (result.ok) {
          const rejection = validateTranslation(leaf.text, result.translatedText);
          if (rejection) {
            registerFailure(
              `${locale}: ${leaf.chainName}/${leaf.assetBase}.${leaf.propertyName} (rejected: ${rejection})`
            );
            return;
          }
          breaker.consecutiveFailures = 0;
          outputs[locale] ??= {};
          outputs[locale][leaf.chainName] ??= {};
          outputs[locale][leaf.chainName][leaf.assetBase] ??= {};
          outputs[locale][leaf.chainName][leaf.assetBase][leaf.propertyName] =
            result.translatedText;
          translatedCount++;
        } else if (result.skipped) {
          skippedCount++;
        } else {
          registerFailure(
            `${locale}: ${leaf.chainName}/${leaf.assetBase}.${leaf.propertyName} (${result.error})`
          );
        }
      });
    }
  }

  await runPool(tasks, CONCURRENCY);

  // Write one file per locale that got at least one translation. Locales with
  // no successes get no file; localization.mjs merges whatever exists and the
  // next generation run re-queues incomplete assets.
  for (const locale of targetLocales) {
    if (!outputs[locale]) {
      continue;
    }
    const filePath = path.join(languageFilesDir, locale + fileExtension);
    fs.writeFileSync(filePath, JSON.stringify(outputs[locale], null, 2) + "\n");
  }

  const expected = leaves.length * targetLocales.length;
  console.log(`Translated ${translatedCount}/${expected} string-locale pairs.`);
  if (skippedCount > 0) {
    emitWarning(
      `${skippedCount} of ${expected} string-locale pairs were skipped (run deadline or circuit breaker); they re-queue on the next daily run.`
    );
  }
  if (failures.length > 0) {
    emitWarning(
      `Translation service errored on ${failures.length} of ${expected} string-locale pairs; affected descriptions stay English-only until the next run re-queues them.`
    );
    failures.slice(0, 20).forEach((failure) => console.log(`  FAILED ${failure}`));
    if (failures.length > 20) {
      console.log(`  ...and ${failures.length - 20} more`);
    }
  }
}

// Only run when executed directly (validateTranslation is imported by tests).
// realpath both sides so the comparison survives junctions/symlinks, where
// Node may canonicalize one path and not the other.
function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  const selfPath = fileURLToPath(import.meta.url);
  try {
    return (
      fs.realpathSync(path.resolve(process.argv[1])) ===
      fs.realpathSync(selfPath)
    );
  } catch {
    return path.resolve(process.argv[1]) === selfPath;
  }
}
if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    // Translation is best-effort by contract: a crash (e.g. malformed
    // en.json) must not fail the daily pipeline. localization_post.mjs still
    // merges whatever exists, and incomplete assets re-queue on the next run.
    emitWarning(
      `Translation step crashed (${error?.message ?? error}); descriptions stay English-only until a later run succeeds.`
    );
  }
}
