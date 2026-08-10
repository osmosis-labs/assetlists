// Run with: node --test ".github/workflows/utility/*.test.mjs"

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildVerifiedSymbolIndexes,
  findActiveUnknownCategories,
  findIdentityChanges,
  findVerifiedSymbolCollision,
  hasUsableAssetlist,
  symbolKeys,
} from './check_automerge_gate_helpers.mjs';

function asset(overrides = {}) {
  return {
    chainName: 'cosmoshub',
    sourceDenom: 'uatom',
    coinMinimalDenom: 'ibc/OLD',
    symbol: 'ATOM',
    decimals: 6,
    name: 'Cosmos Hub Atom',
    isAlloyed: false,
    coingeckoId: 'cosmos',
    verified: true,
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-0/uatom' } }],
    ...overrides,
  };
}

test('requires a non-empty generated asset array', () => {
  assert.equal(hasUsableAssetlist(null), false);
  assert.equal(hasUsableAssetlist({}), false);
  assert.equal(hasUsableAssetlist({ assets: [] }), false);
  assert.equal(hasUsableAssetlist({ assets: [asset()] }), true);
});

test('blocks only unclassified categories that fired', () => {
  const known = new Set(['knownMutation']);
  const { unknownCategories, activeUnknownCategories } = findActiveUnknownCategories([
    { knownMutation: true, futureMetadata: false, futureSensitiveMutation: true },
  ], known);

  assert.deepEqual([...unknownCategories].sort(), [
    'futureMetadata',
    'futureSensitiveMutation',
  ]);
  assert.deepEqual([...activeUnknownCategories], ['futureSensitiveMutation']);
});

test('detects sensitive changes even when denom and IBC identity both change', () => {
  const before = asset({ contract: 'old-contract' });
  const after = asset({
    sourceDenom: 'uatom-v2',
    coinMinimalDenom: 'ibc/NEW',
    decimals: 18,
    contract: 'new-contract',
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-9/uatom-v2' } }],
  });

  const [change] = findIdentityChanges([before], [after]);
  assert.ok(change);
  assert.deepEqual(change.changed.map(({ field }) => field).sort(), [
    'coinMinimalDenom',
    'contract',
    'decimals',
    'ibcPath',
    'sourceDenom',
  ]);
  assert.deepEqual(findIdentityChanges([before], [{ ...before }]), []);
});

test('treats unknown dot segments as symbol separators but leaves dotted targets unreserved', () => {
  const indexes = buildVerifiedSymbolIndexes([
    asset({ symbol: 'USDC' }),
    asset({ symbol: 'SUI.wh', coinMinimalDenom: 'ibc/SUI' }),
  ]);

  assert.deepEqual(symbolKeys('USD.C'), { full: 'usdc', stripped: 'usdc' });
  assert.deepEqual(symbolKeys('USDC.eth.axl'), {
    full: 'usdcethaxl',
    stripped: 'usdc',
  });
  assert.equal(findVerifiedSymbolCollision('USD-C', indexes), 'USDC');
  assert.equal(findVerifiedSymbolCollision('USD.C', indexes), 'USDC');
  assert.equal(findVerifiedSymbolCollision('SUI', indexes), undefined);
  assert.equal(findVerifiedSymbolCollision('SUI-WH', indexes), undefined);
  assert.equal(findVerifiedSymbolCollision('SUI.WH', indexes), undefined);
  assert.equal(findVerifiedSymbolCollision('SUI.other', indexes), undefined);
});
