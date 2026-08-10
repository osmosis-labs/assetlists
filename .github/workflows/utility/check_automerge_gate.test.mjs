// Run with: node --test ".github/workflows/utility/*.test.mjs"

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildVerifiedSymbolIndexes,
  findActiveUnknownCategories,
  findIdentityChanges,
  findRemovedAssets,
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
    asset({ symbol: 'USDC', variantGroupKey: 'grp/usdc' }),
    asset({ symbol: 'SUI.wh', coinMinimalDenom: 'ibc/SUI' }),
  ]);

  assert.equal(symbolKeys('USD.C').full, 'usdc');
  assert.equal(symbolKeys('USDC.eth.axl').full, 'usdcethaxl');
  // Every dot-boundary prefix is offered, longest first, so a squat on an
  // unmapped suffix cannot hide behind an unrecognised segment.
  assert.deepEqual(symbolKeys('DOT.glmr.axl').prefixes, ['dotglmraxl', 'dotglmr', 'dot']);

  assert.equal(findVerifiedSymbolCollision('USD-C', indexes), 'USDC');
  assert.equal(findVerifiedSymbolCollision('USD.C', indexes), 'USDC');
  // Only unsuffixed verified symbols reserve a name.
  assert.equal(findVerifiedSymbolCollision('SUI', indexes), undefined);
  assert.equal(findVerifiedSymbolCollision('SUI-WH', indexes), undefined);
  assert.equal(findVerifiedSymbolCollision('SUI.other', indexes), undefined);
});

test('exempts legitimate bridged variants but still catches impostors', () => {
  const indexes = buildVerifiedSymbolIndexes([
    asset({ symbol: 'USDC', variantGroupKey: 'grp/usdc' }),
  ]);

  // Same asset arriving by another route: shares the owner's variantGroupKey.
  // Previously these were reported as squats, which would have blocked routine
  // daily runs (29 existing assets flag that way on the live list).
  const legitimateVariant = asset({
    symbol: 'USDC.eth.axl',
    verified: false,
    variantGroupKey: 'grp/usdc',
  });
  assert.equal(
    findVerifiedSymbolCollision('USDC.eth.axl', indexes, legitimateVariant),
    undefined,
  );

  // A different underlying asset claiming the same name is a squat.
  const impostor = asset({
    symbol: 'USDC.eth.axl',
    verified: false,
    variantGroupKey: 'grp/scam',
  });
  assert.equal(
    findVerifiedSymbolCollision('USDC.eth.axl', indexes, impostor),
    'USDC',
  );

  // Unknown provenance (no record in the generated list) still reports.
  assert.equal(findVerifiedSymbolCollision('USD.C', indexes, undefined), 'USDC');
});

test('scopes sensitive-field changes to verified assets', () => {
  const base = {
    chainName: 'cosmoshub',
    sourceDenom: 'uatom',
    coinMinimalDenom: 'ibc/SAME',
    symbol: 'THING',
    decimals: 6,
    name: 'Thing',
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-0/uatom' } }],
  };

  // Unverified on both sides: not the gate's business.
  const unvBefore = { ...base, verified: false };
  const unvAfter = { ...base, verified: false, decimals: 18 };
  assert.deepEqual(findIdentityChanges([unvBefore], [unvAfter]), []);

  // Verified on either side is reviewed, so a curator verifying an asset in the
  // same window still gets its change surfaced.
  const verBefore = { ...base, verified: true };
  const verAfter = { ...base, verified: true, decimals: 18 };
  assert.equal(findIdentityChanges([verBefore], [verAfter]).length, 1);
  assert.equal(findIdentityChanges([unvBefore], [{ ...unvAfter, verified: true }]).length, 1);
});

test('does not treat isAlloyed or coingeckoId as sensitive', () => {
  const before = asset({ isAlloyed: false, coingeckoId: 'cosmos' });
  const after = asset({ isAlloyed: true, coingeckoId: 'something-else' });
  assert.deepEqual(findIdentityChanges([before], [after]), []);

  // A contract re-point on the same asset still reports.
  const repointed = asset({ contract: 'osmo1evil' });
  const [change] = findIdentityChanges([asset({ contract: 'osmo1good' })], [repointed]);
  assert.ok(change);
  assert.deepEqual(change.changed.map(({ field }) => field), ['contract']);
});

test('reports removed assets so a mass delisting cannot pass as a quiet day', () => {
  const kept = asset({ coinMinimalDenom: 'ibc/KEPT' });
  const dropped = asset({
    symbol: 'GONE',
    coinMinimalDenom: 'ibc/GONE',
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-7/ugone' } }],
  });

  const removed = findRemovedAssets([kept, dropped], [kept]);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].symbol, 'GONE');
  // Tagged so the caller can block on verified removals and merely report the
  // unverified ones.
  assert.equal(removed[0].verified, true);

  const unverifiedDrop = { ...dropped, verified: false };
  const [row] = findRemovedAssets([kept, unverifiedDrop], [kept]);
  assert.equal(row.verified, false);

  // Nothing removed when the list is unchanged.
  assert.deepEqual(findRemovedAssets([kept, dropped], [kept, dropped]), []);

  // A denom change is a modification, not a removal: the IBC path still matches.
  const repriced = { ...dropped, coinMinimalDenom: 'ibc/NEWDENOM' };
  assert.deepEqual(findRemovedAssets([dropped], [repriced]), []);
});

test('does not pair a relisted symbol with an unrelated prior asset', () => {
  // Old asset delisted; a different asset is listed under the same symbol on a
  // different chain. Pairing them fabricated "decimals 6 -> 18" style rows.
  const before = asset({
    symbol: 'FOO',
    chainName: 'terra',
    coinMinimalDenom: 'ibc/OLDFOO',
    decimals: 6,
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-1/uoldfoo' } }],
  });
  const after = asset({
    symbol: 'FOO',
    chainName: 'ethereum',
    coinMinimalDenom: 'ibc/NEWFOO',
    decimals: 18,
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-2/unewfoo' } }],
  });

  assert.deepEqual(findIdentityChanges([before], [after]), []);

  // Same chain with both stable keys changed is still treated as a mutation.
  const sameChainAfter = { ...after, chainName: 'terra' };
  const [change] = findIdentityChanges([before], [sameChainAfter]);
  assert.ok(change);
  assert.ok(change.changed.some(({ field }) => field === 'decimals'));
});

test('prefers the first record for duplicate symbols rather than the last', () => {
  // The live list carries two LINK.eth.terra entries differing only by denom.
  const first = asset({ symbol: 'DUP', coinMinimalDenom: 'ibc/ONE', decimals: 6 });
  const second = asset({
    symbol: 'DUP',
    coinMinimalDenom: 'ibc/TWO',
    decimals: 8,
    transferMethods: [{ type: 'ibc', chain: { path: 'transfer/channel-5/udup' } }],
  });

  // Each pairs with itself by denom, so neither reports a change.
  assert.deepEqual(findIdentityChanges([first, second], [first, second]), []);
});
