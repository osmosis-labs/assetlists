// Pure helpers for check_automerge_gate.mjs. Kept separate so regression tests
// can import the decision logic without executing the workflow entrypoint.

export const SENSITIVE_FIELDS = [
  'decimals',
  'coinMinimalDenom',
  'sourceDenom',
  'chainName',
  'contract',
  'ibcPath',
  'name',
  'isAlloyed',
  'coingeckoId',
];

export function sensitiveShape(asset) {
  const ibcPath = (asset.transferMethods ?? [])
    .find((tm) => tm?.type === 'ibc' && tm?.chain?.path)?.chain?.path ?? null;
  return {
    decimals: asset.decimals ?? null,
    coinMinimalDenom: asset.coinMinimalDenom ?? null,
    sourceDenom: asset.sourceDenom ?? null,
    chainName: asset.chainName ?? null,
    contract: asset.contract ?? null,
    ibcPath,
    name: asset.name ?? null,
    isAlloyed: asset.isAlloyed === true,
    coingeckoId: asset.coingeckoId ?? null,
  };
}

const HOMOGLYPHS = new Map(Object.entries({
  // Cyrillic -> Latin
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
  'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's',
  'ј': 'j', 'ԁ': 'd', 'ɡ': 'g',
  // Greek -> Latin
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ζ': 'z', 'η': 'n',
  // U+04CF Cyrillic palochka renders as l/I and survives NFKC.
  'ӏ': 'l',
}));

export function foldSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  let out = '';
  for (const ch of symbol.toLowerCase().normalize('NFKC')) {
    out += HOMOGLYPHS.get(ch) ?? ch;
  }
  return out.replace(/[^a-z0-9]/g, '');
}

/**
 * Every dot-boundary prefix of a symbol, longest first, folded.
 *
 * Replaces a hardcoded chain-suffix vocabulary. That list had two failure
 * modes: one unmapped segment stopped the right-to-left walk and defeated
 * stripping for the whole symbol (`DOT.glmr.axl` folded to `dotglmr`, never
 * reaching `dot`), and it needed hand-editing as chains were added. Emitting
 * every prefix and letting the caller intersect against symbols that actually
 * exist needs no vocabulary and cannot drift.
 *
 * `full` is the whole symbol folded, so a dot used as a separator inside a
 * claimed symbol still collides: `USD.C` -> `usdc`.
 */
export function symbolKeys(symbol) {
  if (typeof symbol !== 'string') return { full: '', stripped: '', prefixes: [] };
  const parts = symbol.split('.');
  const prefixes = [];
  for (let end = parts.length; end >= 1; end -= 1) {
    const folded = foldSymbol(parts.slice(0, end).join('.'));
    if (folded && !prefixes.includes(folded)) prefixes.push(folded);
  }
  return {
    full: foldSymbol(symbol),
    // Longest proper prefix, i.e. the whole symbol minus its last dot segment.
    // Retained for callers that want the single most likely bare form.
    stripped: prefixes[prefixes.length - 1] ?? '',
    prefixes,
  };
}

export function normaliseSymbol(symbol) {
  return symbolKeys(symbol).stripped;
}

export function feKey(asset) {
  const ibcPath = (asset.transferMethods ?? [])
    .find((tm) => tm?.type === 'ibc' && tm?.chain?.path)?.chain?.path;
  return ibcPath ?? `${asset.chainName}|${asset.sourceDenom}`;
}

export function hasUsableAssetlist(data) {
  return Array.isArray(data?.assets) && data.assets.length > 0;
}

export function findActiveUnknownCategories(diffRows, knownFields) {
  const unknownCategories = new Set();
  const activeUnknownCategories = new Set();
  for (const row of diffRows) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (typeof value !== 'boolean' || knownFields.has(key)) continue;
      unknownCategories.add(key);
      if (value === true) activeUnknownCategories.add(key);
    }
  }
  return { unknownCategories, activeUnknownCategories };
}

/**
 * Indexes of verified bare symbols (no dot), plus each one's variantGroupKey.
 *
 * The variant group is what separates an impostor from an ordinary bridged
 * listing: every legitimate variant of USDC (USDC.eth.axl, USDC.avax.axl, ...)
 * carries the SAME variantGroupKey as bare USDC, because they are the same
 * underlying asset arriving by different routes.
 */
export function buildVerifiedSymbolIndexes(assets) {
  const bare = new Map();
  const groupBySymbol = new Map();

  for (const asset of assets) {
    if (asset?.verified !== true
        || typeof asset.symbol !== 'string'
        || asset.symbol.includes('.')) continue;
    const normalized = foldSymbol(asset.symbol);
    if (normalized && !bare.has(normalized)) {
      bare.set(normalized, asset.symbol);
      groupBySymbol.set(asset.symbol, asset.variantGroupKey ?? null);
    }
  }

  return { bare, groupBySymbol };
}

/**
 * The verified bare symbol a candidate collides with, or undefined.
 *
 * Two behaviours the previous vocabulary-based version got wrong:
 *
 *   - It matched only the suffix-stripped form, so every routine bridged
 *     variant of a verified asset (USDC.eth.axl, ETH.arb.carbon) resolved to
 *     the bare owner and was reported as a squat. 29 existing unverified assets
 *     flagged that way, which would have blocked ordinary daily runs. A
 *     candidate sharing the owner's variantGroupKey is the same asset by another
 *     route, so it is exempt.
 *   - It stopped stripping at the first unmapped segment, so a squat on an
 *     unmapped suffix slipped through. Now every dot-boundary prefix is tried.
 *
 * Pass the candidate's own asset record (when it exists) so the variant-group
 * exemption can be applied; without it, every prefix match is reported.
 */
export function findVerifiedSymbolCollision(symbol, indexes, candidateAsset) {
  const { full, prefixes } = symbolKeys(symbol);
  const candidateGroup = candidateAsset?.variantGroupKey ?? null;

  // Longest first: prefer the most specific match.
  for (const key of [full, ...prefixes]) {
    const owner = indexes.bare.get(key);
    if (!owner) continue;
    // Exact same string is not a squat; that is the owner itself.
    if (owner === symbol) return undefined;
    const ownerGroup = indexes.groupBySymbol?.get(owner) ?? null;
    if (candidateGroup !== null && ownerGroup !== null && candidateGroup === ownerGroup) {
      // Legitimate variant of this asset, not an impersonation of it.
      return undefined;
    }
    return owner;
  }
  return undefined;
}

/**
 * Assets present in the snapshot but absent from the generated list.
 *
 * findIdentityChanges only walks afterAssets, so a removal produces no row
 * there. That was a fail-open hole: a generation bug or a failed chain-registry
 * submodule fetch that drops most of the list yields no identity changes, no
 * lifecycle rows and no new symbols, and hasUsableAssetlist accepts anything
 * with at least one asset, so the gate reported a clean pass and auto-merged a
 * mass delisting. Removals are reported separately so they can block.
 *
 * Keyed on coinMinimalDenom (unique across the generated list) with the
 * IBC-path key as a second chance, so an asset whose denom changed counts as
 * modified (findIdentityChanges' job) rather than removed.
 */
export function findRemovedAssets(beforeAssets, afterAssets) {
  const afterDenoms = new Set();
  const afterPaths = new Set();
  for (const asset of afterAssets) {
    if (asset.coinMinimalDenom) afterDenoms.add(asset.coinMinimalDenom);
    const key = feKey(asset);
    if (key) afterPaths.add(key);
  }

  const removed = [];
  for (const asset of beforeAssets) {
    const stillPresent = (asset.coinMinimalDenom && afterDenoms.has(asset.coinMinimalDenom))
      || afterPaths.has(feKey(asset));
    if (stillPresent) continue;
    removed.push({
      symbol: asset.symbol ?? asset.coinMinimalDenom ?? '?',
      chain: asset.chainName ?? '?',
      denom: asset.coinMinimalDenom ?? '?',
      verified: asset.verified === true,
    });
  }

  // Verified removals first: those are the curated, user-visible delistings.
  removed.sort((x, y) => (y.verified ? 1 : 0) - (x.verified ? 1 : 0));
  return removed;
}

export function findIdentityChanges(beforeAssets, afterAssets) {
  const beforeByDenom = new Map();
  const beforeByPath = new Map();
  const beforeBySymbol = new Map();
  // First-write-wins on every index. The generated list contains duplicate
  // symbols (two LINK.eth.terra entries differ only by denom), and last-wins
  // would silently discard the earlier record, comparing a change against the
  // wrong asset.
  for (const asset of beforeAssets) {
    if (asset.coinMinimalDenom && !beforeByDenom.has(asset.coinMinimalDenom)) {
      beforeByDenom.set(asset.coinMinimalDenom, asset);
    }
    const key = feKey(asset);
    if (key && !beforeByPath.has(key)) beforeByPath.set(key, asset);
    if (asset.symbol && !beforeBySymbol.has(asset.symbol)) {
      beforeBySymbol.set(asset.symbol, asset);
    }
  }

  // Symbols claimed by more than one before-asset are ambiguous, so the
  // symbol-only fallback must not fire for them.
  const ambiguousSymbols = new Set();
  const seenSymbols = new Set();
  for (const asset of beforeAssets) {
    if (!asset.symbol) continue;
    if (seenSymbols.has(asset.symbol)) ambiguousSymbols.add(asset.symbol);
    seenSymbols.add(asset.symbol);
  }

  const identityChanges = [];
  for (const asset of afterAssets) {
    // Symbol is the weakest key and is only consulted when both stable keys
    // miss, i.e. the denom AND the path changed together. Require the origin
    // chain to agree too: otherwise a relisting that reuses a removed asset's
    // symbol is paired with that unrelated record and reported as a sensitive
    // change ("decimals 6 -> 18", "chainName terra -> ethereum") that never
    // happened to any single asset.
    const bySymbol = (asset.symbol && !ambiguousSymbols.has(asset.symbol))
      ? beforeBySymbol.get(asset.symbol)
      : undefined;
    const prior = beforeByDenom.get(asset.coinMinimalDenom)
      ?? beforeByPath.get(feKey(asset))
      ?? (bySymbol?.chainName === asset.chainName ? bySymbol : undefined);
    if (!prior) continue;

    const now = sensitiveShape(asset);
    const was = sensitiveShape(prior);
    const changed = SENSITIVE_FIELDS
      .filter((field) => JSON.stringify(was[field]) !== JSON.stringify(now[field]))
      .map((field) => ({ field, from: was[field], to: now[field] }));

    if (changed.length > 0) {
      identityChanges.push({
        symbol: asset.symbol ?? prior.symbol ?? '?',
        chain: asset.chainName ?? '?',
        verified: asset.verified === true || prior.verified === true,
        changed,
      });
    }
  }

  identityChanges.sort((x, y) => (y.verified ? 1 : 0) - (x.verified ? 1 : 0));
  return identityChanges;
}
