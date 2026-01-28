import * as zone from "./assetlist_functions.mjs";
import * as fs from 'fs';
import * as path from 'path';

async function syncKeplrFactoryTokens(chainName) {
  console.log(`\n========== Syncing Keplr Factory Tokens for ${chainName} ==========\n`);

  // Check if generated file exists, otherwise use base template
  let baseTemplate;
  try {
    baseTemplate = zone.readFromFile(
      chainName,
      zone.keplrDir,
      "osmosis.json"
    );
    console.log("Using existing generated file as base");
  } catch (error) {
    baseTemplate = zone.readFromFile(
      chainName,
      zone.noDir,
      "keplr_base_template.json"
    );
    console.log("Using base template (first run)");
  }

  // Read generated assetlists
  const frontendAssetlist = zone.readFromFile(
    chainName,
    zone.frontendAssetlistDir,
    zone.assetlistFileName
  );
  const assetDetailAssetlist = zone.readFromFile(
    chainName,
    zone.zoneAssetDetail,
    zone.assetlistFileName
  );

  console.log(`Base template loaded: ${baseTemplate.currencies.length} currencies`);
  console.log(`Frontend assetlist loaded: ${frontendAssetlist.assets.length} assets`);
  console.log(`Asset detail assetlist loaded: ${assetDetailAssetlist.assets.length} assets\n`);

  // Build lookup map for CoinGecko IDs from asset_detail
  const assetDetailMap = createAssetDetailMap(assetDetailAssetlist);

  // Get existing currency denoms from template
  const existingDenoms = new Set(
    baseTemplate.currencies.map(c => c.coinMinimalDenom)
  );

  console.log(`Existing currencies in template: ${existingDenoms.size}`);

  // Extract and transform factory tokens
  const factoryTokens = frontendAssetlist.assets
    .filter(asset => asset.coinMinimalDenom && asset.coinMinimalDenom.startsWith('factory/'))
    .filter(asset => !asset.disabled);

  console.log(`Total factory tokens in frontend: ${factoryTokens.length}`);

  // Find NEW factory tokens
  const newFactoryTokens = factoryTokens
    .filter(asset => !existingDenoms.has(asset.coinMinimalDenom))
    .map(asset => transformToCurrency(asset, assetDetailMap));

  console.log(`New factory tokens to add: ${newFactoryTokens.length}\n`);

  if (newFactoryTokens.length > 0) {
    console.log('Sample of new tokens being added:');
    newFactoryTokens.slice(0, 5).forEach(token => {
      console.log(`  - ${token.coinDenom} (${token.coinMinimalDenom.substring(0, 60)}...)`);
    });
    console.log('');
  }

  // Append new tokens to currencies
  baseTemplate.currencies.push(...newFactoryTokens);

  // Ensure output directory exists
  const outputDir = path.join(zone.assetlistsRoot, `${chainName}-1`, zone.keplrDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
  }

  // Write output
  zone.writeToFile(
    chainName,
    zone.keplrDir,
    "osmosis.json",
    baseTemplate,
    2
  );

  console.log(`\n✓ Updated Keplr config: ${baseTemplate.currencies.length} total currencies`);
  console.log(`  - Non-factory tokens: ${existingDenoms.size}`);
  console.log(`  - Factory tokens: ${baseTemplate.currencies.length - existingDenoms.size}`);

  // Count tokens with CoinGecko IDs
  const withCoinGecko = baseTemplate.currencies.filter(c => c.coinGeckoId).length;
  console.log(`  - With CoinGecko IDs: ${withCoinGecko}`);

  // Count alloyed tokens
  const alloyedTokens = baseTemplate.currencies.filter(c =>
    c.coinMinimalDenom.includes('/alloyed/')
  ).length;
  console.log(`  - Alloyed tokens: ${alloyedTokens}\n`);
}

function createAssetDetailMap(assetDetailAssetlist) {
  const map = new Map();
  assetDetailAssetlist.assets.forEach(asset => {
    map.set(asset.base, asset);
  });
  return map;
}

function transformToCurrency(asset, assetDetailMap) {
  // Handle alloyed token naming
  let coinDenom = asset.symbol;
  if (asset.coinMinimalDenom.includes('/alloyed/') && !coinDenom.startsWith('all')) {
    coinDenom = 'all' + coinDenom;
  }

  const currency = {
    coinDenom: coinDenom,
    coinMinimalDenom: asset.coinMinimalDenom,
    coinDecimals: asset.decimals
  };

  // CoinGecko ID resolution (priority: asset_detail > frontend)
  const detailEntry = assetDetailMap.get(asset.coinMinimalDenom);
  if (detailEntry?.coingeckoID) {
    currency.coinGeckoId = detailEntry.coingeckoID;
  } else if (asset.coingeckoId) {
    currency.coinGeckoId = asset.coingeckoId;
  }

  // Image URL mapping
  if (asset.logoURIs?.png) {
    currency.coinImageUrl = mapToKeplrImageUrl(asset.coinMinimalDenom, asset.symbol);
  }

  return currency;
}

function mapToKeplrImageUrl(denom, symbol) {
  const keplrBase = "https://raw.githubusercontent.com/chainapsis/keplr-chain-registry/main/images/osmosis/";

  // Factory tokens: extract address and subdenom
  if (denom.startsWith('factory/')) {
    const parts = denom.replace('factory/', '').split('/');

    // For alloyed tokens, use the path structure
    if (denom.includes('/alloyed/')) {
      // factory/address/alloyed/subdenom -> factory/address/alloyed/subdenom.png
      return keplrBase + 'factory/' + parts.join('/') + '.png';
    }

    // For regular factory tokens: factory/address/subdenom.png
    return keplrBase + 'factory/' + parts.join('/') + '.png';
  }

  return keplrBase + denom.toLowerCase() + '.png';
}

async function main() {
  try {
    await syncKeplrFactoryTokens("osmosis"); // Maps to osmosis-1
    console.log("========== Sync Complete ==========\n");
  } catch (error) {
    console.error("Error syncing Keplr factory tokens:", error);
    process.exit(1);
  }
}

main();
