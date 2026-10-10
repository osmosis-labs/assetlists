// Read-only audit of every generated row and configured asset. No API calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeAssetList } from './compact_assetlist.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const hash = (value) =>
  'ibc/' +
  crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const registry = new Map();
for (const base of [
  'chain-registry',
  'chain-registry/testnets',
  'chain-registry/_non-cosmos',
]) {
  if (!fs.existsSync(path.join(root, base))) continue;
  for (const dir of fs.readdirSync(path.join(root, base), {
    withFileTypes: true,
  })) {
    if (!dir.isDirectory()) continue;
    const prefix = `${base}/${dir.name}`;
    if (!fs.existsSync(path.join(root, prefix, 'chain.json'))) continue;
    const chain = read(`${prefix}/chain.json`);
    const assets = fs.existsSync(path.join(root, prefix, 'assetlist.json'))
      ? read(`${prefix}/assetlist.json`).assets
      : [];
    registry.set(chain.chain_name, { chain, assets });
  }
}

const report = {
  scope:
    'Checked-in generated lists, zone config and pinned Chain Registry. No live endpoint, client, logo or market checks.',
  zones: [],
};
for (const zone of ['osmosis-1', 'osmo-test-5']) {
  const prefix = `${zone}/generated/frontend`;
  const list = read(`${prefix}/assetlist.json`);
  const chainlist = read(`${prefix}/chainlist.json`);
  const config = read(`${zone}/osmosis.zone_assets.json`);
  const issues = [];
  const add = (severity, code, asset, message) =>
    issues.push({
      severity,
      code,
      symbol: asset.symbol ?? asset._comment,
      denom: asset.coinMinimalDenom ?? asset.base_denom,
      message,
    });
  const byDenom = new Map();
  const bySymbol = new Map();
  const flagPairs = [
    ['osmosis_verified', 'verified'],
    ['osmosis_unlisted', 'preview'],
    ['osmosis_unstable', 'unstable'],
    ['osmosis_disabled', 'disabled'],
    ['osmosis_halt_deposits', 'haltDeposits'],
    ['osmosis_halt_withdrawals', 'haltWithdrawals'],
  ];
  const reasons = {
    unstableReason: ['ibc_client', 'source_chain_killed', 'market', 'manual'],
    depositHaltReason: [
      'bridge_down',
      'extended_unstable_market',
      'planned_shutdown',
      'source_chain_killed',
      'manual',
    ],
    withdrawalHaltReason: ['bridge_down', 'source_chain_killed', 'manual'],
  };
  const url = (value, asset, key) => {
    // External interfaces may point at an app-local route (e.g. /wormhole).
    const appRoute =
      ['depositUrl', 'withdrawUrl'].includes(key) &&
      typeof value === 'string' &&
      value.startsWith('/') &&
      !value.startsWith('//');
    try {
      if (
        !['http:', 'https:'].includes(
          new URL(value, appRoute ? 'https://app.osmosis.zone' : undefined)
            .protocol,
        )
      )
        throw new Error();
    } catch {
      add('error', 'invalid_url', asset, `${key}: ${value}`);
    }
  };
  for (const asset of list.assets) {
    for (const key of [
      'chainName',
      'sourceDenom',
      'coinMinimalDenom',
      'symbol',
      'name',
    ]) {
      if (typeof asset[key] !== 'string' || !asset[key].trim())
        add('error', 'missing_field', asset, key);
    }
    if (!Number.isSafeInteger(asset.decimals) || asset.decimals < 0)
      add('error', 'decimals', asset, 'Invalid decimals');
    if (byDenom.has(asset.coinMinimalDenom))
      add('error', 'duplicate_denom', asset, 'Ambiguous denom lookup');
    byDenom.set(asset.coinMinimalDenom, asset);
    const symbolKey = String(asset.symbol ?? '').toUpperCase();
    if (bySymbol.has(symbolKey))
      add(
        'warning',
        'duplicate_symbol',
        asset,
        `Also used by ${bySymbol.get(symbolKey)}`,
      );
    bySymbol.set(symbolKey, asset.coinMinimalDenom);
    for (const key of ['categories', 'transferMethods', 'counterparty']) {
      if (!Array.isArray(asset[key])) add('error', 'missing_array', asset, key);
    }
    for (const [, key] of flagPairs) {
      if (asset[key] !== undefined && typeof asset[key] !== 'boolean')
        add('error', 'flag_type', asset, key);
    }
    for (const [flag, reason] of [
      ['unstable', 'unstableReason'],
      ['haltDeposits', 'depositHaltReason'],
      ['haltWithdrawals', 'withdrawalHaltReason'],
    ]) {
      if (asset[flag] && !asset[reason])
        add('error', 'missing_reason', asset, flag);
      if (asset[reason] && !reasons[reason].includes(asset[reason]))
        add('error', 'invalid_reason', asset, reason);
      if (asset[reason] && !asset[flag])
        add('warning', 'orphan_reason', asset, reason);
    }
    for (const key of [
      'listingDate',
      'lastDowntimeDate',
      'lastRecoveryDate',
      'plannedShutdownDate',
    ]) {
      if (asset[key] && !Number.isFinite(Date.parse(asset[key])))
        add('error', 'invalid_date', asset, key);
    }
    if (asset.isAlloyed && !asset.contract)
      add('error', 'alloy_contract', asset, 'Missing alloy contract');
    for (const [key, value] of Object.entries(asset.logoURIs ?? {}))
      url(value, asset, `logoURIs.${key}`);
    if (!asset.logoURIs?.svg && !asset.logoURIs?.png)
      add('warning', 'missing_logo', asset, 'No logo URL');
    const source = registry.get(asset.chainName);
    if (
      registry.size &&
      !source?.assets.some((a) => a.base === asset.sourceDenom)
    )
      add(
        'warning',
        'registry_source_missing',
        asset,
        `${asset.chainName}:${asset.sourceDenom}`,
      );
    if (
      source?.chain.status === 'killed' &&
      (!asset.haltDeposits || !asset.haltWithdrawals)
    )
      add('warning', 'killed_chain_open_direction', asset, asset.chainName);
    for (const method of asset.transferMethods ?? []) {
      if (
        !['ibc', 'integrated_bridge', 'external_interface'].includes(
          method.type,
        )
      )
        add('error', 'transfer_type', asset, method.type);
      if (method.type === 'external_interface') {
        for (const key of ['depositUrl', 'withdrawUrl', 'logoUri'])
          if (method[key]) url(method[key], asset, key);
      }
      if (method.type === 'ibc') {
        if (
          !method.chain?.path ||
          hash(method.chain.path) !== asset.coinMinimalDenom
        )
          add(
            'error',
            'ibc_hash',
            asset,
            'Transfer path does not hash to denom',
          );
        if (
          !method.counterparty?.channelId ||
          !method.counterparty?.port ||
          !method.counterparty?.sourceDenom ||
          !method.chain?.channelId ||
          !method.chain?.port
        )
          add('error', 'ibc_fields', asset, 'Incomplete transfer method');
        const chain = chainlist.chains.find(
          (c) => c.chain_name === method.counterparty?.chainName,
        );
        if (!chain?.chain_id || chain.chain_id !== method.counterparty?.chainId)
          add(
            'error',
            'ibc_chain',
            asset,
            `${method.counterparty?.chainName}: expected ${method.counterparty?.chainId}, generated chain ID ${chain?.chain_id ?? 'missing'}`,
          );
        // Both sides of an IBC channel must match the pinned registry, not just
        // the local hash. Fallback traces must never invent a remote channel.
        const local = zone === 'osmosis-1' ? 'osmosis' : 'osmosistestnet';
        const remote = method.counterparty?.chainName;
        const dir = zone === 'osmosis-1' ? '_IBC' : 'testnets/_IBC';
        const filename = `chain-registry/${dir}/${[local, remote].sort().join('-')}.json`;
        if (registry.size && fs.existsSync(path.join(root, filename))) {
          const ibc = read(filename);
          const localSide =
            ibc.chain_1.chain_name === local ? 'chain_1' : 'chain_2';
          const remoteSide = localSide === 'chain_1' ? 'chain_2' : 'chain_1';
          if (
            !ibc.channels.some(
              (c) =>
                c[localSide].channel_id === method.chain.channelId &&
                c[localSide].port_id === method.chain.port &&
                c[remoteSide].channel_id === method.counterparty.channelId &&
                c[remoteSide].port_id === method.counterparty.port,
            )
          )
            add('error', 'registry_ibc_mismatch', asset, filename);
        } else if (registry.size)
          add('warning', 'registry_ibc_missing', asset, filename);
      }
    }
    for (const cp of asset.counterparty ?? []) {
      if (
        !cp.chainName ||
        !cp.sourceDenom ||
        !cp.symbol ||
        !Number.isSafeInteger(cp.decimals) ||
        cp.decimals < 0 ||
        (cp.chainType !== 'non-cosmos' && !cp.chainId)
      )
        add('error', 'counterparty_fields', asset, cp.chainName);
    }
    if (
      asset.chainName !==
        (zone === 'osmosis-1' ? 'osmosis' : 'osmosistestnet') &&
      asset.transferMethods?.length &&
      !asset.transferMethods.some((m) => m.type === 'ibc') &&
      asset.counterparty?.[0] &&
      !chainlist.chains.some(
        (c) => c.chain_name === asset.counterparty[0].chainName,
      )
    )
      add(
        'warning',
        'legacy_frontend_skips_asset',
        asset,
        `Old codegen silently drops this token: no wallet config for ${asset.counterparty[0].chainName}. Use Osmosis grouping for non-Cosmos origins.`,
      );
  }
  for (const asset of list.assets) {
    if (asset.variantGroupKey && !byDenom.has(asset.variantGroupKey))
      add('error', 'variant_reference', asset, asset.variantGroupKey);
  }
  for (const asset of config.assets) {
    const denom = asset.path ? hash(asset.path) : asset.base_denom;
    // Testnet config may omit the path; the generator resolves a default IBC
    // route. Match its source pointer rather than assuming a native denom.
    const generated =
      !asset.path &&
      zone === 'osmo-test-5' &&
      asset.chain_name !== 'osmosistestnet'
        ? list.assets.find(
            (a) =>
              a.chainName === asset.chain_name &&
              a.sourceDenom === asset.base_denom,
          )
        : byDenom.get(denom);
    if (!generated) {
      add('error', 'config_asset_missing', asset, denom);
      continue;
    }
    for (const [input, output] of flagPairs) {
      if (!!asset[input] !== !!generated[output])
        add('error', 'flag_drift', generated, input);
    }
    for (const [input, output] of [
      ['osmosis_unstable_reason', 'unstableReason'],
      ['osmosis_deposit_halt_reason', 'depositHaltReason'],
      ['osmosis_withdrawal_halt_reason', 'withdrawalHaltReason'],
      ['tooltip_message', 'tooltipMessage'],
    ])
      if (asset[input] !== generated[output])
        add('error', 'metadata_drift', generated, input);
  }
  const originalBytes = fs.readFileSync(
    path.join(root, prefix, 'assetlist.json'),
  );
  const compactBytes = fs.readFileSync(
    path.join(root, prefix, 'assetlist.compact.json'),
  );
  try {
    assert.deepEqual(decodeAssetList(JSON.parse(compactBytes)), list);
  } catch (error) {
    add('error', 'compact_roundtrip', {}, error.message);
  }
  report.zones.push({
    zone,
    assets: list.assets.length,
    configuredAssets: config.assets.length,
    chains: chainlist.chains.length,
    flags: Object.fromEntries(
      flagPairs.map(([, key]) => [
        key,
        list.assets.filter((a) => a[key]).length,
      ]),
    ),
    bytes: {
      original: originalBytes.length,
      minified: Buffer.byteLength(JSON.stringify(list)),
      compact: compactBytes.length,
      originalGzip: gzipSync(originalBytes).length,
      minifiedGzip: gzipSync(JSON.stringify(list)).length,
      compactGzip: gzipSync(compactBytes).length,
    },
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    issues,
  });
}
report.registryChecked = registry.size > 0;
const output = process.argv.includes('--json')
  ? JSON.stringify(report, null, 2)
  : [
      '# Asset list audit',
      '',
      report.scope,
      '',
      `Pinned Chain Registry checked: ${report.registryChecked ? 'yes' : 'NO — initialize the submodule to complete registration/channel checks'}.`,
      '',
      ...report.zones.flatMap((z) => [
        `## ${z.zone}`,
        '',
        `${z.assets} generated assets; ${z.configuredAssets} configured assets; ${z.chains} chain entries. **${z.errors} errors, ${z.warnings} warnings.**`,
        '',
        `Flags: ${JSON.stringify(z.flags)}`,
        '',
        '| Encoding | Bytes | gzip bytes |',
        '|---|---:|---:|',
        `| Original (pretty) | ${z.bytes.original} | ${z.bytes.originalGzip} |`,
        `| Original (minified) | ${z.bytes.minified} | ${z.bytes.minifiedGzip} |`,
        `| Compact v1 | ${z.bytes.compact} | ${z.bytes.compactGzip} |`,
        '',
        ...z.issues.map(
          (i) =>
            `- **${i.severity}: ${i.code}** — ${i.symbol ?? ''} (${i.denom ?? ''}): ${i.message}`,
        ),
        '',
      ]),
      '## Remaining validity checks',
      '',
      'Run existing endpoint validation, IBC client, market-health and verification-criteria utilities against live services. A structural pass is not proof that a chain, bridge, logo or market is currently live. Warnings are review candidates, not instructions to remove tokens or clear halts.',
      '',
    ].join('\n');
console.log(output);
if (report.zones.some((z) => z.errors)) process.exitCode = 1;
