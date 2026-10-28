// Run with: node --test ".github/workflows/utility/*.test.mjs"

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findActiveUnknownCategories,
  findIdentityChanges,
  findRemovedAssets,
  hasUsableAssetlist,
  statusChangeReason,
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

test('status-change reason explains the change that fired', () => {
  // A cleared unstable flag has no current reason, so the old one is shown.
  assert.equal(statusChangeReason({ reason: '?', unstableReasonOld: 'market' }, ['ibcCleared']), 'was market');
  // A halt being set shows the halt reason, not the unstable reason.
  assert.equal(
    statusChangeReason(
      { reason: 'market', depositHaltReason: 'bridge_down', withdrawalHaltReason: 'bridge_down' },
      ['bridgeOrKillWithdrawalSet', 'bridgeOrKillDepositSet'],
    ),
    'bridge_down',
  );
  assert.equal(
    statusChangeReason({ reason: 'bridge_down', unstableReasonOld: 'market' }, ['unstableReasonChanged']),
    'market → bridge_down',
  );
  assert.equal(statusChangeReason({ reason: 'market' }, ['ibcFlagged']), 'market');
  assert.equal(statusChangeReason({ reason: '?' }, ['ibcCleared']), '');
});

test('flags a changed counterparty channel, symbol or external link on a verified asset', () => {
  const ibc = (channelId) => ({
    type: 'ibc',
    counterparty: { chainName: 'cosmoshub', chainId: 'cosmoshub-4', port: 'transfer', channelId },
    chain: { port: 'transfer', channelId: 'channel-0', path: 'transfer/channel-0/uatom' },
  });
  const link = (url) => ({ type: 'external_interface', depositUrl: url, withdrawUrl: url });
  const before = asset({ transferMethods: [link('https://bridge.example/a'), ibc('channel-141')] });

  // Same Osmosis path: only the counterparty channel deposits leave from moved.
  const [redirected] = findIdentityChanges([before], [
    asset({ transferMethods: [link('https://bridge.example/a'), ibc('channel-0')] }),
  ]);
  assert.deepEqual(redirected.changed.map(({ field }) => field), ['ibcCounterpartyChannelId']);

  const [relinked] = findIdentityChanges([before], [
    asset({ symbol: 'ATOM.x', transferMethods: [link('https://parked.example/'), ibc('channel-141')] }),
  ]);
  assert.deepEqual(relinked.changed.map(({ field }) => field).sort(), ['externalUrls', 'symbol']);
});

test('treats swapped deposit and withdraw links as a change', () => {
  const method = (depositUrl, withdrawUrl) => ({ type: 'external_interface', name: 'Bridge', depositUrl, withdrawUrl });
  const before = asset({ transferMethods: [method('https://a.example/in', 'https://a.example/out')] });
  const [swapped] = findIdentityChanges([before], [
    asset({ transferMethods: [method('https://a.example/out', 'https://a.example/in')] }),
  ]);
  assert.deepEqual(swapped.changed.map(({ field }) => field), ['externalUrls']);
});
