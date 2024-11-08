
// Purpose:
//   to generate the assets file for Mintscan asset recognition


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';
import * as path from 'path';

const mintscanAssetsFileName = "assets.json";
const mintscanDirName = "mintscan";
const mintscanDir = path.join(zone.externalDir, mintscanDirName);


// Function to map the source "coinMinimalDenom" to the target "denom"
const mapAssets = (sourceAssets) => {
  return sourceAssets.map(asset => {
    return {
      denom: asset.coinMinimalDenom
    };
  });
};

function isStaking(chainName, baseDenom) {

  let stakingAssetDenom = chain_reg.getFileProperty(chainName, "chain", "staking")?.staking_tokens?.[0].denom;
  if (baseDenom === stakingAssetDenom) {
    return true;
  } else {
    return false;
  }

}

function getAssetType(asset) {

  const ibc_type = "ics20";
  if (asset.type_asset === ibc_type) {
    return "ibc";
  }

  const bridge_type = "bridge";
  if (Array.isArray(asset.traces) && asset.traces.length > 0) {
    const typeOfLastTrace = asset.traces[asset.traces.length - 1]?.type;
    if (typeOfLastTrace === bridge_type) {
      return "bridge";
    }
  }

  return "native";

}

function getAssetDecimals(chainName, asset) {

  return chain_reg.getAssetDecimals(chainName, asset.base);

}

function getAssetPath(chainName, asset) {

  if (Array.isArray(asset.traces) && asset.traces.length > 0) {
    const traces = asset.traces;
    let path = "";
    for (let i = traces.length - 1; i >= 0; i--) {
      if (traces[i].type === "bridge") {
        path = getCosmoStationChainName(traces[i].counterparty.chain_name) + ">" + path;
        break;
      }
      if (
        traces[i].type === "ibc" ||
        traces[i].type === "ibc-cw20"
      ) {
        path = getCosmoStationChainName(traces[i].counterparty.chain_name) + ">" + path;
      } else { break; }
    }
    if (path) {
      path += chainName;
    }
    return path;
  }

}

function getIbcInfo(chainName, asset) {

  const transferPort = "transfer";
  const trace = asset.traces[asset.traces.length - 1];
  let ibc_info = {};
  ibc_info.path = getAssetPath(chainName, asset);
  ibc_info.client = {
    channel: trace.chain.channel_id,
    port: trace.chain.port ?? transferPort
  };
  ibc_info.counterparty = {
    channel: trace.counterparty.channel_id,
    port: trace.counterparty.port ?? transferPort,
    chain: getCosmoStationChainName(trace.counterparty.chain_name),
    denom: trace.counterparty.base_denom
  };

  //Remove "cw20:" from the start of the denom
  ibc_info.counterparty.denom =
    ibc_info.counterparty.denom.startsWith("cw20:")
     ?
    ibc_info.counterparty.denom.slice(5)
     :
    ibc_info.counterparty.denom;
  //---

  return ibc_info;

}

function getBridgeInfo(chainName, asset) {

  let bridge_info = {};
  bridge_info.path = getAssetPath(chainName, asset);
  return bridge_info;

}

function getAssetCoinGeckoId(chainName, asset) {

  const traceTypes = [
    "ibc",
    "ibc-cw20",
    "additional-mintage"
  ];

  let coinGeckoId = chain_reg.getAssetPropertyWithTraceCustom(chainName, asset.base, "coingecko_id", traceTypes);
  //find a way to make it return the canonical cgid when it's canonical
  return coinGeckoId;

}


//Global Var
const cosmoStationChainsMap = new Map();

async function saveCosmoStationChainNames() {

  const cosmoStationApiUrl = "https://front.api.mintscan.io/v10/meta/support/chains";

  try {
    // Fetch data from the API
    const response = await fetch(cosmoStationApiUrl);
    if (!response.ok) {
      throw new Error(`Error fetching data: ${response.statusText}`);
    }

    const cosmoStationData = await response.json();
    const cosmoStationChains = cosmoStationData.chains;

    // Populate the map with chainId as key and cosmoStationChainName as value
    if (Array.isArray(cosmoStationChains)) {
      cosmoStationChains.forEach(chainObject => {
        cosmoStationChainsMap.set(chainObject.chain_id, chainObject.chain);
      });
    }

    console.log("Map initialized with chain ID to Cosmo Station chain name pairs.");
  } catch (error) {
    console.error('Error initializing Cosmo Station chains map:', error);
  }
  
}

function getCosmoStationChainName(chainRegistryChainName) {

  // Get chain-id from chain name
  const chainId = chain_reg.getFileProperty(chainRegistryChainName, "chain", "chain_id");
  if (!chainId) {
    return chainRegistryChainName;
  }

  //Get the chain name from the map
  return cosmoStationChainsMap.get(chainId) || chainRegistryChainName;

}

function getAssetImage(asset) {

  //Use CosmoStation's custom 3D logo if it's OSMO
  if (asset.base === "uosmo") {
    return "https://raw.githubusercontent.com/cosmostation/chainlist/master/chain/osmosis/asset/osmo.png";
  }
  //Otherwise, may use the Chain Registry logo
  return asset.images?.[0].svg ?? asset.images?.[0].png;

}


const processAsset = (chainName, asset) => {

  let assetObject = {};
  assetObject.type = getAssetType(asset);
  assetObject.denom = asset.base;
  assetObject.name = asset.name;
  assetObject.symbol = asset.symbol;
  assetObject.description = asset.description;
  assetObject.decimals = getAssetDecimals(chainName, asset);
  assetObject.image = getAssetImage(asset);
  assetObject.color = asset.images?.[0].theme?.primary_color_hex;
  assetObject.coinGeckoId = getAssetCoinGeckoId(chainName, asset);
  if (assetObject.type === "ibc") {
    assetObject.ibc_info = getIbcInfo(chainName, asset);
  }
  if (assetObject.type === "bridge") {
    assetObject.bridge_info = getBridgeInfo(chainName, asset);
  }
  return assetObject;
};


// Main function to convert one JSON file to another
const generateMintscanAssets = (chainName) => {

  // Read the source file
  const sourceData = zone.readFromFile(chainName, zone.chainRegAssetlist, zone.assetlistFileName);
  const transformedAssets = [];
  for (const asset of sourceData.assets) {
    // Process each asset using the custom processing function
    const transformedAsset = processAsset(chainName, asset);

    // Add the transformed asset to the resultant array
    transformedAssets.push(transformedAsset);
  }

  // Write the transformed data to the target file
  zone.writeToFile(chainName, mintscanDir, mintscanAssetsFileName, transformedAssets, 4);
  console.log(`Conversion completed. Data saved.`);
};

// Convert JSON
async function main() {
  await saveCosmoStationChainNames();
  let chainName = "osmosis";
  generateMintscanAssets(chainName);
}

main();