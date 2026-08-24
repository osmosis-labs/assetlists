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

async function translateText(text, targetLocale) {
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
    try {
      const response = await fetch(`${TRANSLATE_API_URL}?${query}`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        // 4xx (other than 429) won't improve on retry
        if (response.status < 500 && response.status !== 429) {
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

  const outputs = {}; // locale -> nested object mirroring en.json
  const failures = [];
  let translatedCount = 0;

  const tasks = [];
  for (const locale of targetLocales) {
    for (const leaf of leaves) {
      tasks.push(async () => {
        const result = await translateText(leaf.text, locale);
        if (result.ok) {
          outputs[locale] ??= {};
          outputs[locale][leaf.chainName] ??= {};
          outputs[locale][leaf.chainName][leaf.assetBase] ??= {};
          outputs[locale][leaf.chainName][leaf.assetBase][leaf.propertyName] =
            result.translatedText;
          translatedCount++;
        } else {
          failures.push(
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

await main();
