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
  'ibcCounterpartyChannelId',
  'ibcCounterpartyChainId',
  'ibcCounterpartyPort',
  'externalUrls',
  'symbol',
  'name',
];

export function sensitiveShape(asset) {
  const ibcMethod = (asset.transferMethods ?? [])
    .find((tm) => tm?.type === 'ibc' && tm?.chain?.path);
  const ibcPath = ibcMethod?.chain?.path ?? null;
  // Deposits are sent out of the counterparty channel, so a change there
  // redirects funds even when the Osmosis-side path is unchanged. The
  // "Deposit via ..." links send users to a third-party site.
  // One record per method, keeping which URL is the deposit and which the
  // withdrawal, so swapping the two still reads as a change.
  const externalUrls = (asset.transferMethods ?? [])
    .filter((tm) => tm?.type === 'external_interface')
    .map((tm) => `${tm.name ?? ''} | deposit ${tm.depositUrl ?? '-'} | withdraw ${tm.withdrawUrl ?? '-'}`)
    .sort();
  return {
    decimals: asset.decimals ?? null,
    coinMinimalDenom: asset.coinMinimalDenom ?? null,
    sourceDenom: asset.sourceDenom ?? null,
    chainName: asset.chainName ?? null,
    contract: asset.contract ?? null,
    ibcPath,
    ibcCounterpartyChannelId: ibcMethod?.counterparty?.channelId ?? null,
    ibcCounterpartyChainId: ibcMethod?.counterparty?.chainId ?? null,
    ibcCounterpartyPort: ibcMethod?.counterparty?.port ?? null,
    externalUrls,
    symbol: asset.symbol ?? null,
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

// Reader-facing names for the lifecycle categories in the status-change
// table. ibcFlagged / ibcCleared fire on the unstable flag from any check
// (IBC client, market health, a curator PR), so they are not labelled "IBC".
export const CATEGORY_LABELS = {
  bridgeOrKillWithdrawalSet: 'withdrawal halt set',
  bridgeOrKillDepositSet: 'deposit halt set',
  ibcFlagged: 'flagged unstable',
  extendedHaltSet: 'extended halt set',
  plannedShutdownSet: 'planned shutdown set',
  unstableReasonChanged: 'unstable reason changed',
  bridgeOrKillWithdrawalCleared: 'withdrawal halt cleared',
  bridgeOrKillDepositCleared: 'deposit halt cleared',
  ibcCleared: 'unstable cleared',
  extendedHaltCleared: 'extended halt cleared',
};

// The reason that explains the change: the halt reason for a halt being set,
// the old reason for a cleared unstable flag (the current one is empty), the
// transition for a reason change, otherwise the current unstable reason.
export function statusChangeReason(row, fired) {
  const reasons = [];
  if (fired.includes('bridgeOrKillDepositSet') && row.depositHaltReason) {
    reasons.push(row.depositHaltReason);
  }
  if (fired.includes('bridgeOrKillWithdrawalSet') && row.withdrawalHaltReason) {
    reasons.push(row.withdrawalHaltReason);
  }
  if (fired.includes('ibcCleared') && row.unstableReasonOld) {
    reasons.push(`was ${row.unstableReasonOld}`);
  }
  if (fired.includes('unstableReasonChanged')) {
    reasons.push(`${row.unstableReasonOld || '?'} → ${row.reason || '?'}`);
  }
  if (reasons.length === 0 && row.reason && row.reason !== '?') reasons.push(row.reason);
  return [...new Set(reasons)].join(', ');
}
