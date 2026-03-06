// Purpose:
//   Add stub entries to zone_chains.json for all auto-detected chains
//   This makes it easier for maintainers to add custom endpoints later
//
// Usage:
//   node add_chain_stubs.mjs <zone_name>
//   Example: node add_chain_stubs.mjs osmosis-1

import * as fs from 'fs';
import * as path from 'path';

// Get zone name from command line argument
const zoneBasePath = process.argv[2] || 'osmosis-1';
const zonePath = path.join('..', '..', '..', zoneBasePath);

// Determine file prefix (osmosis-1 -> osmosis, osmo-test-5 -> osmo)
const filePrefix = zoneBasePath.split('-')[0];

console.log(`Adding chain stubs for zone: ${zoneBasePath} (file prefix: ${filePrefix})`);

// Read zone_assets.json
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
let zoneAssets;
try {
  const zoneAssetsContent = fs.readFileSync(zoneAssetsPath, 'utf8');
  zoneAssets = JSON.parse(zoneAssetsContent);
  console.log(`✓ Loaded ${zoneAssets.assets.length} assets from zone_assets.json`);
} catch (error) {
  console.error(`Error reading zone_assets.json: ${error.message}`);
  process.exit(1);
}

// Read zone_chains.json
const zoneChainsPath = path.join(zonePath, `${filePrefix}.zone_chains.json`);
let zoneChains;
try {
  const zoneChainsContent = fs.readFileSync(zoneChainsPath, 'utf8');
  zoneChains = JSON.parse(zoneChainsContent);
  console.log(`✓ Loaded ${zoneChains.chains.length} chains from zone_chains.json`);
} catch (error) {
  console.error(`Error reading zone_chains.json: ${error.message}`);
  process.exit(1);
}

// Extract unique chain names from assets
const assetChainNames = new Set();
zoneAssets.assets.forEach(asset => {
  if (asset.chain_name) {
    assetChainNames.add(asset.chain_name);
  }
});
console.log(`✓ Found ${assetChainNames.size} unique chains in zone_assets.json`);

// Get existing chain names from zone_chains.json
const existingChainNames = new Set();
zoneChains.chains.forEach(chain => {
  if (chain.chain_name) {
    existingChainNames.add(chain.chain_name);
  }
});
console.log(`✓ Found ${existingChainNames.size} existing chains in zone_chains.json`);

// Find chains that need stubs
const chainsNeedingStubs = [];
assetChainNames.forEach(chainName => {
  if (!existingChainNames.has(chainName)) {
    chainsNeedingStubs.push(chainName);
  }
});

if (chainsNeedingStubs.length === 0) {
  console.log('✓ No new chain stubs needed - all asset chains already have entries');
  process.exit(0);
}

console.log(`\n📝 Adding stubs for ${chainsNeedingStubs.length} chains:`);
chainsNeedingStubs.sort().forEach(name => console.log(`   - ${name}`));

// Create stub entries for missing chains, populated from the chain registry.
// The zone_chains.json schema requires rpc, rest, and explorer_tx_url.
const CHAIN_REGISTRY_PATH = path.join('..', '..', '..', 'chain-registry');

function buildStubFromRegistry(chainName) {
  let registryData = null;
  try {
    const chainFile = path.join(CHAIN_REGISTRY_PATH, chainName, 'chain.json');
    registryData = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
  } catch { /* not in registry */ }

  const rpc  = registryData?.apis?.rpc?.[0]?.address  ?? '';
  const rest = registryData?.apis?.rest?.[0]?.address ?? '';

  // Find an explorer with a tx_page containing {txHash} (schema pattern requirement)
  const explorerEntry = registryData?.explorers?.find(e => e.tx_page?.includes('{txHash}'));
  const explorer_tx_url = explorerEntry?.tx_page ?? `https://www.mintscan.io/${chainName}/txs/\${txHash}`;

  return { chain_name: chainName, rpc, rest, explorer_tx_url };
}

const stubEntries = chainsNeedingStubs.sort().map(buildStubFromRegistry);

// Add stub entries to the end of the chains array
zoneChains.chains.push(...stubEntries);

// Write updated zone_chains.json
try {
  const updatedContent = JSON.stringify(zoneChains, null, 2);
  fs.writeFileSync(zoneChainsPath, updatedContent + '\n', 'utf8');
  console.log(`\n✓ Successfully added ${chainsNeedingStubs.length} chain stubs to zone_chains.json`);
  console.log(`✓ Total chains in zone_chains.json: ${zoneChains.chains.length}`);
} catch (error) {
  console.error(`Error writing zone_chains.json: ${error.message}`);
  process.exit(1);
}

console.log('\n✅ Done! Chain stubs added with endpoints from Chain Registry.');
