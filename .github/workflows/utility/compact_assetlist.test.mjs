import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encodeAssetList, decodeAssetList } from './compact_assetlist.mjs';

const asset = {
  chainName: 'osmosis',
  sourceDenom: 'uosmo',
  coinMinimalDenom: 'uosmo',
  symbol: 'OSMO',
  name: 'Osmosis',
  decimals: 6,
  categories: [],
  transferMethods: [],
  counterparty: [],
  isAlloyed: false,
  verified: false,
  unstable: false,
  disabled: false,
  preview: false,
};

test('roundtrips missing optional fields, defaults, safety flags and unknown fields', () => {
  const list = {
    chainName: 'osmosis',
    assets: [
      asset,
      {
        ...asset,
        coinMinimalDenom: 'ibc/ABC',
        verified: true,
        unstable: true,
        haltDeposits: true,
        depositHaltReason: 'manual',
        haltWithdrawals: true,
        withdrawalHaltReason: 'bridge_down',
        unstableReason: 'manual',
        lastDowntimeDate: '2026-01-01T00:00:00Z',
        plannedShutdownDate: '2026-12-01',
        transferMethods: [
          {
            type: 'external_interface',
            depositUrl: '/wormhole',
            name: 'Bridge',
          },
        ],
        futureField: { nested: [1, false, null] },
      },
    ],
  };
  const compact = encodeAssetList(list);
  assert.deepEqual(decodeAssetList(JSON.parse(JSON.stringify(compact))), list);
  assert.ok(compact.rows.every((row) => row.at(-1) !== null));
  assert.equal(
    Object.hasOwn(decodeAssetList(compact).assets[0], 'haltDeposits'),
    false,
  );
});

test('does not create absent fields or share default arrays between assets', () => {
  const list = { chainName: 'osmosis', assets: [asset, { symbol: 'X' }] };
  const compact = encodeAssetList(list);
  assert.deepEqual(decodeAssetList(compact), list);
  const decoded = decodeAssetList(
    encodeAssetList({ chainName: 'osmosis', assets: [asset, asset] }),
  );
  decoded.assets[0].categories.push('meme');
  assert.deepEqual(decoded.assets[1].categories, []);
});

test('empty lists, null rejection, invalid format/columns/rows/defaults', () => {
  const empty = { chainName: 'osmosis', assets: [] };
  assert.deepEqual(decodeAssetList(encodeAssetList(empty)), empty);
  assert.throws(() =>
    encodeAssetList({ ...empty, assets: [{ symbol: null }] }),
  );
  const compact = encodeAssetList({ ...empty, assets: [asset] });
  assert.throws(() => decodeAssetList({ ...compact, format: 'v2' }));
  assert.throws(() =>
    decodeAssetList({ ...compact, fields: ['symbol', 'symbol'] }),
  );
  assert.throws(() => decodeAssetList({ ...compact, fields: ['__proto__'] }));
  assert.throws(() =>
    decodeAssetList({
      ...compact,
      rows: [Array(compact.fields.length + 1).fill(null)],
    }),
  );
  assert.throws(() =>
    decodeAssetList({
      ...compact,
      defaults: { ...compact.defaults, verified: true },
    }),
  );
});

for (const zone of ['osmosis-1', 'osmo-test-5']) {
  test(`${zone}: published artifact equals every original asset, in order`, () => {
    const prefix = new URL(
      `../../../${zone}/generated/frontend/`,
      import.meta.url,
    );
    const original = JSON.parse(
      fs.readFileSync(new URL('assetlist.json', prefix)),
    );
    const compact = JSON.parse(
      fs.readFileSync(new URL('assetlist.compact.json', prefix)),
    );
    assert.deepEqual(decodeAssetList(compact), original);
    assert.deepEqual(encodeAssetList(original), compact);
  });
}
