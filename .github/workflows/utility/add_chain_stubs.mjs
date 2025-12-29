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

// Create minimal stub entries for missing chains
// Only includes chain_name - all fields will be pulled from Chain Registry by default
// Maintainers can add rpc/rest/explorer_tx_url/keplr_features/override_properties as needed
const stubEntries = chainsNeedingStubs.sort().map(chainName => ({
  "chain_name": chainName,
  "_comment": "Auto-detected chain - add rpc/rest/explorer_tx_url/override_properties to customize"
}));

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

console.log('\n✅ Done! Chain stubs added. Add rpc/rest fields to customize endpoints.');
console.log('   All other fields will be pulled from Chain Registry by default.');
