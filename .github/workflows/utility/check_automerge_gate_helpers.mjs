// Pure helpers for check_automerge_gate.mjs. Kept separate so regression tests
// can import the decision logic without executing the workflow entrypoint.

// Fields where a silent change to a VERIFIED asset is a money bug or an
// impersonation vector. Deliberately excludes:
//   isAlloyed    - a routing/pricing property the pipeline manages; a change
//                  here does not move funds to a different place.
//   coingeckoId  - price-feed metadata, wrong values misprice the display but
//                  do not redirect a transfer.
export const SENSITIVE_FIELDS = [
  'decimals',
  'coinMinimalDenom',
  'sourceDenom',
  'chainName',
  'contract',
  'ibcPath',
  'name',
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
  };
}

/**
 * Split the diff's boolean fields into "unknown to this gate" and "unknown AND
 * actually fired". A field merely present but false everywhere is inert, so it
 * only warns; one that fired means an unclassified mutation happened and the
 * gate cannot tell whether it is financially sensitive, so it blocks.
 */
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
 * Stable identity key for an asset: its first IBC transfer path, else
 * chain|sourceDenom. Mirrors the feKey definition in the workflow's
 * "Extract per-mutation symbol lists" jq so both sides pair the same rows.
 */
export function feKey(asset) {
  const ibcPath = (asset.transferMethods ?? [])
    .find((tm) => tm?.type === 'ibc' && tm?.chain?.path)?.chain?.path;
  return ibcPath ?? `${asset.chainName}|${asset.sourceDenom}`;
}

/**
 * An empty array is truthy, so `!data?.assets` accepted {assets: []} and a
 * generation run that emitted zero assets read as a quiet day. Require content.
 */
export function hasUsableAssetlist(data) {
  return Array.isArray(data?.assets) && data.assets.length > 0;
}

/**
 * Assets present in the snapshot but absent from the generated list.
 *
 * findIdentityChanges only walks afterAssets, so a removal produces no row
 * there. Keyed on coinMinimalDenom (unique across the generated list) with the
 * IBC-path key as a second chance, so an asset whose denom changed counts as
 * modified rather than removed. `verified` is tagged so the caller can block on
 * verified removals and merely report the rest.
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

    // VERIFIED only. Verified is the curated, default-visible set, and it is the
    // only place an identity rewrite is user-facing; an unverified asset is
    // hidden by default, so a decimals or path change on it is not worth holding
    // the daily run for. Either side counts as verified so that a curator
    // verifying an asset in the same window still gets its change reviewed.
    if (asset.verified !== true && prior.verified !== true) continue;

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
