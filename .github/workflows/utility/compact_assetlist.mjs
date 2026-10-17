// v1 contract mirrored by frontend/config/compact-asset-list.ts.
// Only top-level keys are table-encoded; nested bridge metadata is untouched.
// null means omitted/default. Explicit top-level null is rejected, not lost.
export const FORMAT = 'osmosis-assetlist-v1';
const DEFAULTS = {
  categories: [],
  transferMethods: [],
  counterparty: [],
  isAlloyed: false,
  verified: false,
  unstable: false,
  disabled: false,
  preview: false,
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function encodeAssetList({ chainName, assets }) {
  const defaults = Object.fromEntries(
    Object.entries(DEFAULTS).filter(
      ([key]) =>
        assets.length > 0 && assets.every((asset) => Object.hasOwn(asset, key)),
    ),
  );
  const keys = [...new Set(assets.flatMap(Object.keys))];
  for (const asset of assets) {
    for (const [key, value] of Object.entries(asset)) {
      if (
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        value == null
      ) {
        throw new Error(`Unsupported asset field: ${key}`);
      }
    }
  }
  // Put sparse columns last so trailing nulls can be omitted.
  const counts = new Map(
    keys.map((key) => [
      key,
      assets.filter(
        (asset) =>
          Object.hasOwn(asset, key) && !same(asset[key], defaults[key]),
      ).length,
    ]),
  );
  const fields = keys.sort(
    (a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'en'),
  );
  const rows = assets.map((asset) => {
    const row = fields.map((key) =>
      !Object.hasOwn(asset, key) || same(asset[key], defaults[key])
        ? null
        : asset[key],
    );
    while (row.length && row.at(-1) === null) row.pop();
    return row;
  });
  return { format: FORMAT, chainName, fields, defaults, rows };
}

export function decodeAssetList(data) {
  if (
    data.format !== FORMAT ||
    !Array.isArray(data.fields) ||
    !Array.isArray(data.rows) ||
    new Set(data.fields).size !== data.fields.length ||
    data.fields.some(
      (key) =>
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key),
    ) ||
    !data.defaults ||
    Object.keys(data.defaults).some(
      (key) =>
        !data.fields.includes(key) ||
        !Object.hasOwn(DEFAULTS, key) ||
        !same(data.defaults[key], DEFAULTS[key]),
    )
  ) {
    throw new Error('Invalid compact asset list');
  }
  const assets = data.rows.map((row) => {
    if (!Array.isArray(row) || row.length > data.fields.length)
      throw new Error('Invalid asset row');
    const asset = Object.fromEntries(
      Object.entries(data.defaults).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    );
    row.forEach((value, i) => {
      if (value !== null) asset[data.fields[i]] = value;
    });
    return asset;
  });
  return { chainName: data.chainName, assets };
}
