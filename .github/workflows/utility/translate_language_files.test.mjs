// Unit tests for validateTranslation in translate_language_files.mjs.
// Run with:  node --test .github/workflows/utility/
//
// The validator is the only thing standing between the keyless community
// translation service and auto-merged, user-facing asset descriptions, so the
// bypass table below is the contract: every known injection shape must be
// rejected, and legitimate translation variation (CJK compression, source
// URLs restated, decimals, abbreviations) must pass.

import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTranslation } from "./translate_language_files.mjs";

const SRC =
  "SOVR is the sole unit of account of the Sovren Layer 1: staking, " +
  "governance, gas, and service payments. See https://sovrentech.io for details.";

// ── must be rejected ────────────────────────────────────────────────────────

const REJECTED = [
  ["adds https URL", "SOVR ist gut. Besuchen Sie https://sovren-airdrop.xyz jetzt!"],
  ["adds bare domain, allowlisted TLD", "Claim rewards at sovren-claims.app now"],
  ["adds bare domain, .co", "Visit claim-osmosis.co now"],
  ["adds bare domain, .ai", "Get help at wallet-drainer.ai"],
  ["adds bare domain, .site", "See osmosis-support.site"],
  ["adds www form", "Gehen Sie zu www.sovren-claim.support"],
  ["unicode dot lookalike", "Visit claim-osmosis。co now"],
  ["non-http scheme", "Open ipfs://QmScamHash in your wallet"],
  ["markdown link, javascript scheme", "[click here](javascript:alert(1))"],
  ["markdown link, tg scheme", "[claim](tg://resolve?domain=scam)"],
  ["bare dangerous scheme", "Run javascript:void(fetch('x'))"],
  ["html markup", 'SOVR <a href="x">hier klicken</a>'],
  ["injected essay", "x".repeat(SRC.length * 4 + 201)],
  ["truncated junk", "S"],
  ["https URL to an IP", "Besuchen Sie https://192.0.2.1 jetzt!"],
  ["bare IP address", "Connect to 203.0.113.7 for rewards"],
  [
    "different path on the legitimate source domain",
    "Siehe https://sovrentech.io/claim-airdrop jetzt",
  ],
  ["protocol-relative authority", "Gehen Sie zu //scam-osmosis.example jetzt"],
  ["bracketed IPv6 authority", "Besuchen Sie https://[2001:db8::1]/claim jetzt!"],
  [
    "parenthesized path appended to the source URL",
    "Siehe https://sovrentech.io/(claim) jetzt",
  ],
];

for (const [name, translated] of REJECTED) {
  test(`rejects: ${name}`, () => {
    assert.notEqual(validateTranslation(SRC, translated), undefined);
  });
}

// ── must pass ───────────────────────────────────────────────────────────────

const ACCEPTED = [
  ["plain translation", "SOVR ist die Recheneinheit der Sovren Layer 1."],
  [
    "restates a source URL",
    "SOVR ist die Einheit. Siehe https://sovrentech.io für Details.",
  ],
  [
    "restates source domain without scheme",
    "Details unter sovrentech.io verfügbar.",
  ],
  [
    "CJK compression (~1/4 length)",
    "質押與治理的唯一計價單位。",
  ],
  ["decimal numbers are not domains", "Die Version 2.19 unterstützt 1.5x Staking."],
  ["abbreviations are not domains", "z.B. Staking, d.h. Governance, etc."],
  ["colon in prose", "Sovren Layer 1: Staking, Governance und Gas."],
  [
    "source URL with trailing sentence punctuation",
    "Details: https://sovrentech.io.",
  ],
  [
    "source URL with Korean particle attached (no space)",
    "자세한 내용은 https://sovrentech.io를 참조하세요.",
  ],
  [
    "source URL wrapped in prose parentheses",
    "Die Recheneinheit (siehe https://sovrentech.io) der Sovren Layer 1.",
  ],
  [
    "source URL restated with trailing slash",
    "Details unter https://sovrentech.io/ verfügbar.",
  ],
];

for (const [name, translated] of ACCEPTED) {
  test(`accepts: ${name}`, () => {
    assert.equal(validateTranslation(SRC, translated), undefined);
  });
}

// ── source-relative behavior ────────────────────────────────────────────────

test("markdown link allowed only when source already has one", () => {
  const mdSrc = "See [the docs](https://docs.osmosis.zone) for details.";
  assert.equal(
    validateTranslation(mdSrc, "Siehe [die Docs](https://docs.osmosis.zone)."),
    undefined
  );
  assert.notEqual(
    validateTranslation(SRC, "Siehe [die Docs](https://docs.osmosis.zone)."),
    undefined
  );
});

test("case-sensitive URL components are not folded", () => {
  const pathSrc = "Read https://docs.osmosis.zone/SafePath for details.";
  // Absolute path case swap: a different destination on case-sensitive hosts.
  assert.notEqual(
    validateTranslation(pathSrc, "Lesen Sie https://docs.osmosis.zone/safepath jetzt"),
    undefined
  );
  // Query value case swap.
  assert.notEqual(
    validateTranslation(
      "Use https://osmosis.zone/claim?code=ABC to redeem.",
      "Nutzen Sie https://osmosis.zone/claim?code=abc jetzt"
    ),
    undefined
  );
  // Relative Markdown destination case swap.
  assert.notEqual(
    validateTranslation("See [the docs](/SafePath) for details.", "[die Docs](/safepath)"),
    undefined
  );
  // Host and scheme stay case-insensitive: restating the source URL in
  // uppercase host form is not an added destination.
  assert.equal(
    validateTranslation(pathSrc, "Siehe HTTPS://DOCS.OSMOSIS.ZONE/SafePath."),
    undefined
  );
});

test("parenthesized path extension of a source path URL is rejected", () => {
  const pathSrc = "Read https://docs.osmosis.zone/path for details.";
  assert.notEqual(
    validateTranslation(
      pathSrc,
      "Lesen Sie https://docs.osmosis.zone/path(claim) jetzt"
    ),
    undefined
  );
  // ...while restating the source path URL exactly still passes.
  assert.equal(
    validateTranslation(pathSrc, "Siehe https://docs.osmosis.zone/path."),
    undefined
  );
});

test("domain added relative to a source that has none is rejected", () => {
  assert.notEqual(
    validateTranslation("A short test description", "Kurz. Siehe osmosis.zone"),
    undefined
  );
});

test("markdown destination swap is rejected even when source has markdown", () => {
  const mdSrc = "See [the docs](https://docs.osmosis.zone) for details.";
  assert.notEqual(
    validateTranslation(mdSrc, "[claim](//192.0.2.1)"),
    undefined
  );
  assert.notEqual(
    validateTranslation(mdSrc, "[die Docs](/umleitung)"),
    undefined
  );
});
