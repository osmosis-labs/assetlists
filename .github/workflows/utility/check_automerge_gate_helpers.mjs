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

// Suffixes deduplicate_symbols.mjs can append. A dot only starts a generated
// variant suffix when every trailing segment is recognised here; otherwise it
// remains a separator inside the claimed symbol, so USD.C folds to USDC.
const KNOWN_CHAIN_SUFFIXES = new Set([
  'atom', 'carbon', 'axl', 'eth', 'matic', 'avax', 'bsc', 'arb', 'op', 'pica',
  'ntrn', 'strd', 'inj', 'dydx', 'tia', 'wh', 'forex', 'grv', 'kuji', 'nom',
  'orai', 'planq', 'luna', 'nym', 'src', 'rise', 'juno', 'xprt', 'noble',
  'sol', 'e', 'int3', 'legacy', 'old',
]);

export function symbolKeys(symbol) {
  if (typeof symbol !== 'string') return { full: '', stripped: '' };
  const parts = symbol.split('.');
  let end = parts.length;
  while (end > 1 && KNOWN_CHAIN_SUFFIXES.has(parts[end - 1].toLowerCase())) end -= 1;
  return {
    full: foldSymbol(symbol),
    stripped: foldSymbol(parts.slice(0, end).join('.')),
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

export function buildVerifiedSymbolIndexes(assets) {
  const bare = new Map();

  for (const asset of assets) {
    if (asset?.verified !== true
        || typeof asset.symbol !== 'string'
        || asset.symbol.includes('.')) continue;
    const normalized = foldSymbol(asset.symbol);
    if (normalized && !bare.has(normalized)) bare.set(normalized, asset.symbol);
  }

  return { bare };
}

export function findVerifiedSymbolCollision(symbol, indexes) {
  const { full, stripped } = symbolKeys(symbol);
  return indexes.bare.get(stripped) ?? indexes.bare.get(full);
}

export function findIdentityChanges(beforeAssets, afterAssets) {
  const beforeByDenom = new Map();
  const beforeByPath = new Map();
  const beforeBySymbol = new Map();
  for (const asset of beforeAssets) {
    if (asset.coinMinimalDenom) beforeByDenom.set(asset.coinMinimalDenom, asset);
    const key = feKey(asset);
    if (key) beforeByPath.set(key, asset);
    if (asset.symbol) beforeBySymbol.set(asset.symbol, asset);
  }

  const identityChanges = [];
  for (const asset of afterAssets) {
    const prior = beforeByDenom.get(asset.coinMinimalDenom)
      ?? beforeByPath.get(feKey(asset))
      ?? beforeBySymbol.get(asset.symbol);
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
