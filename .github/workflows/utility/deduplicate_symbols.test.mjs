// Run with: node --test ".github/workflows/utility/*.test.mjs"

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deduplicateSymbols } from './deduplicate_symbols.mjs';

function asset(symbol, chain, { verified = false, traces } = {}) {
  return {
    frontend: { symbol, verified },
    asset_detail: { symbol },
    source_asset: { chain_name: chain },
    zone_asset: {},
    traces_for_deduplication: traces,
  };
}

function dedupe(assets) {
  const log = console.log;
  console.log = () => {};
  try {
    deduplicateSymbols(assets);
  } finally {
    console.log = log;
  }
  return assets.map((a) => a.frontend.symbol);
}

test('treats symbols that differ only by case as duplicates', () => {
  assert.deepEqual(
    dedupe([asset('SolvBTC', 'babylon'), asset('solvBTC', 'cosmoshub', { verified: true })]),
    ['SolvBTC.babylon', 'solvBTC'],
  );
});

test('falls back to numeric suffixes when no origin is known', () => {
  assert.deepEqual(
    dedupe([asset('FOO', 'juno'), asset('FOO', 'juno'), asset('FOO', 'juno')]),
    ['FOO', 'FOO.juno.1', 'FOO.juno.2'],
  );
});

test('inserts the bridge provider when symbol, chain and origin all match', () => {
  const viaEthereum = (provider) => [
    { type: provider ? 'bridge' : 'synthetic', provider: provider ?? 'Unknown', counterparty: { chain_name: 'ethereum' } },
    { type: 'ibc', counterparty: { chain_name: 'terra' } },
  ];
  const symbols = dedupe([
    asset('LINK', 'axelar', { verified: true }),
    asset('LINK', 'terra', { traces: viaEthereum('Portal') }),
    asset('LINK', 'terra', { traces: viaEthereum() }),
  ]);
  assert.deepEqual(symbols, ['LINK', 'LINK.eth.wh.terra', 'LINK.eth.terra']);
});
