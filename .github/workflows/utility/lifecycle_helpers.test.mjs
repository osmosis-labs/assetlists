// Unit tests for the pure cross-source market guards in lifecycle_helpers.mjs.
// Run with:  node --test .github/workflows/utility/
//
// Focus is isMarketGenuinelyFailing, the guard that stops a Numia "liquidity 0"
// reading from being treated as measured illiquidity when it actually means
// "Numia does not price this denom". canClearExtendedHalt is covered alongside
// it to pin the intended asymmetry between setting and clearing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSqsLiquidityMap,
  canClearExtendedHalt,
  isMarketGenuinelyFailing,
} from './lifecycle_helpers.mjs';

const FLOORS = { lowLiquidityUsd: 1000, lowVolumeUsd: 100 };

// ── isMarketGenuinelyFailing ────────────────────────────────────────────────

test('both sources agree the market is dead → failing', () => {
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 0 },
      sqsLiquidity: 30,
      ...FLOORS,
    }),
    true
  );
});

test('unpriced-but-liquid asset is NOT failing (the NTRN case)', () => {
  // Numia returns price:null → liquidity 0, volume 0, indistinguishable from
  // a dead market. SQS shows real pooled value, so no halt.
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 0 },
      sqsLiquidity: 46848,
      ...FLOORS,
    }),
    false
  );
});

test('SQS exactly at the floor is not "below" it → not failing', () => {
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 0 },
      sqsLiquidity: 1000,
      ...FLOORS,
    }),
    false
  );
});

test('SQS one cent under the floor → failing', () => {
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 0 },
      sqsLiquidity: 999.99,
      ...FLOORS,
    }),
    true
  );
});

test('Numia passing on liquidity → not failing regardless of SQS', () => {
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 5000, volume24h: 0 },
      sqsLiquidity: 0,
      ...FLOORS,
    }),
    false
  );
});

test('Numia passing on volume alone → not failing', () => {
  // SAGA's shape: liquidity 0 but real 24h volume. Volume above the floor is
  // enough to spare it, matching the original single-source condition.
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 167.58 },
      sqsLiquidity: 0,
      ...FLOORS,
    }),
    false
  );
});

test('missing market (no Numia entry) → not failing', () => {
  // Absent data must never be a reason to mutate.
  assert.equal(
    isMarketGenuinelyFailing({ market: undefined, sqsLiquidity: 0, ...FLOORS }),
    false
  );
});

test('denom absent from a populated map is an observation → failing', () => {
  // "In no pool at all" is the strongest evidence of illiquidity, not missing
  // data. The 14 zero-pool assets in the 2026-07-28 batch (SHIB.axl, UNI.axl,
  // the int3face set, maxBTC…) rely on this to remain haltable. Whole-map
  // unavailability is a caller concern (sqsAvailable), not this function's.
  for (const absent of [undefined, null]) {
    assert.equal(
      isMarketGenuinelyFailing({
        market: { liquidity: 0, volume24h: 0 },
        sqsLiquidity: absent,
        ...FLOORS,
      }),
      true,
      `expected true for sqsLiquidity=${String(absent)}`
    );
  }
});

test('non-finite SQS readings never drive a mutation → not failing', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'abc']) {
    assert.equal(
      isMarketGenuinelyFailing({
        market: { liquidity: 0, volume24h: 0 },
        sqsLiquidity: bad,
        ...FLOORS,
      }),
      false,
      `expected false for sqsLiquidity=${String(bad)}`
    );
  }
});

test('numeric strings are honoured', () => {
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 0 },
      sqsLiquidity: '30',
      ...FLOORS,
    }),
    true
  );
  assert.equal(
    isMarketGenuinelyFailing({
      market: { liquidity: 0, volume24h: 0 },
      sqsLiquidity: '5000',
      ...FLOORS,
    }),
    false
  );
});

// ── canClearExtendedHalt: the intended asymmetry ────────────────────────────

test('clearing requires BOTH sources positive', () => {
  assert.equal(
    canClearExtendedHalt({
      market: { liquidity: 5000, volume24h: 0 },
      sqsLiquidity: 5000,
      ...FLOORS,
    }),
    true
  );
  // Numia positive, SQS silent → stays halted (phantom-liquidity guard).
  assert.equal(
    canClearExtendedHalt({
      market: { liquidity: 5000, volume24h: 0 },
      sqsLiquidity: 0,
      ...FLOORS,
    }),
    false
  );
});

test('phantom Numia liquidity cannot confirm recovery (the axlUSDT case)', () => {
  // Live shape 2026-07-28: Numia reports $162,830 liquidity for a denom with
  // $0 of pooled value in SQS. This is the predicate the market-health
  // recovery path now gates on, so such an asset can neither reopen deposits
  // nor lose osmosis_unstable on Numia's word alone.
  assert.equal(
    canClearExtendedHalt({
      market: { liquidity: 162830.91, volume24h: 0 },
      sqsLiquidity: 0,
      ...FLOORS,
    }),
    false
  );
});

test('recovery is blocked when the SQS reading is absent entirely', () => {
  assert.equal(
    canClearExtendedHalt({
      market: { liquidity: 5000, volume24h: 500 },
      sqsLiquidity: undefined,
      ...FLOORS,
    }),
    false
  );
});

test('setting and clearing are not mutually exhaustive', () => {
  // An asset Numia does not price but SQS shows as liquid must neither be
  // halted nor auto-cleared: both guards return false. This is the deliberate
  // "no confident conclusion" middle ground.
  const input = {
    market: { liquidity: 0, volume24h: 0 },
    sqsLiquidity: 46848,
    ...FLOORS,
  };
  assert.equal(isMarketGenuinelyFailing(input), false);
  assert.equal(canClearExtendedHalt(input), false);
});

// ── buildSqsLiquidityMap: the whole-pool-cap convention ─────────────────────

test('whole-pool caps are summed per denom, error pools skipped', () => {
  const map = buildSqsLiquidityMap({
    data: [
      { liquidity_cap: 100, balances: [{ denom: 'a' }, { denom: 'b' }] },
      { liquidity_cap: 50, balances: [{ denom: 'a' }] },
      { liquidity_cap: 900, liquidity_cap_error: 'x', balances: [{ denom: 'a' }] },
      { liquidity_cap: 0, balances: [{ denom: 'c' }] },
    ],
  });
  // 'a' gets the FULL cap of each pool it appears in, not its share.
  assert.equal(map.get('a'), 150);
  assert.equal(map.get('b'), 100);
  assert.equal(map.has('c'), false);
});

test('malformed SQS body yields an empty map, not a throw', () => {
  assert.equal(buildSqsLiquidityMap(undefined).size, 0);
  assert.equal(buildSqsLiquidityMap({}).size, 0);
});
