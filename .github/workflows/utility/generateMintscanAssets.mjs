
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

function getAssetOriginTrace(asset) {
  if (asset.traces) {
    const traces = asset.traces;
    let trace;
    for (let i = traces.length - 1; i >= 0; i--) {
      if (traces[i].type === "bridge") { return traces[i]; }
      if (
        traces[i].type === "ibc" ||
        traces[i].type === "ibc-cw20"
      ) {
        trace = traces[i];
      } else { break; }
    }
    return trace;
  }
}

function isStaking(chainName, baseDenom) {

  let stakingAssetDenom = chain_reg.getFileProperty(chainName, "chain", "staking")?.staking_tokens?.[0].denom;
  if (baseDenom === stakingAssetDenom) {
    return true;
  } else {
    return false;
  }

}

function getOnchainAssetType(chainName, baseDenom) {

  const native_types = [
    "bitcoin-like",
    "evm-base",
    "sdk.coin",
    "svm-base",
    "substrate",
    "unknown"
  ];

  const assetType = chain_reg.getAssetProperty(chainName, baseDenom, "type_asset");

  if (native_types.includes(assetType) || !assetType) {
    if (isStaking(chainName, baseDenom)) {
      return "staking";
    } else {
      return "native";
    }
  } else {
    return assetType;
  }

}

function getLocalAssetType(chainName, asset) {

  if (asset.type_asset === "ics20") {
    return "ibc";
  } else if (Array.isArray(asset.traces) && asset.traces.length > 0) {
    const typeOfLastTrace = asset.traces[asset.traces.length - 1]?.type;
    if (typeOfLastTrace === "bridge") {
      return "bridge";
    }
  }
  return getOnchainAssetType(chainName, asset.base);

}

function getOriginAssetType(localChainName, asset) {

  const originTrace = getAssetOriginTrace(asset);
  let chainName = localChainName;
  let baseDenom = asset.base;
  if (originTrace) {
    chainName = originTrace.counterparty.chain_name;
    baseDenom = originTrace.counterparty.base_denom;
  }
  return getOnchainAssetType(chainName, baseDenom);

}

function getOriginAssetDenom(asset) {

  const originTrace = getAssetOriginTrace(asset);
  if (!originTrace) {
    return asset.base;
  } else {
    return originTrace.counterparty.base_denom;
  }

}

function getOriginAssetChain(chainName, asset) {

  const originTrace = getAssetOriginTrace(asset);
  if (!originTrace) {
    return chainName;
  } else {
    return originTrace.counterparty.chain_name;
  }

}

function getAssetSymbol(asset) {

  return asset.symbol;

}

function getAssetDecimals(chainName, asset) {

  return chain_reg.getAssetDecimals(chainName, asset.base);

}

function getAssetIbcDetails(asset) {

  let trace = asset.traces[asset.traces.length - 1];
  if (trace.type === "ibc") {
    trace.counterparty.port = "transfer";
    trace.chain.port = "transfer";
  }
  return trace;

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

const processAsset = (chainName, asset) => {
  // Customize this logic based on the transformations you need
  let assetObject = {
    denom: asset.base,
    type: getLocalAssetType(chainName, asset),
    origin_chain: getOriginAssetChain(chainName, asset),
    origin_denom: getOriginAssetDenom(asset),
    origin_type: getOriginAssetType(chainName, asset),
    symbol: getAssetSymbol(asset),
    decimals: getAssetDecimals(chainName, asset),
    enable: true,
    path: "path",
  };

  if (assetObject.type === "ibc") {
    const assetIbcDetails = getAssetIbcDetails(asset);
    //console.log(assetIbcDetails);
    assetObject.channel = assetIbcDetails.chain.channel_id;
    assetObject.port = assetIbcDetails.chain.port;
    assetObject.counter_party = {
      channel: assetIbcDetails.counterparty.channel_id,
      port: assetIbcDetails.counterparty.port,
      denom: assetIbcDetails.counterparty.base_denom
    }
    //console.log(assetIbcDetails.counterparty.port);
  }

  assetObject.image = "image";
  assetObject.coinGeckoId = getAssetCoinGeckoId(chainName, asset);

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
  zone.writeToFile(chainName, mintscanDir, mintscanAssetsFileName, transformedAssets);
  console.log(`Conversion completed. Data saved.`);
};

// Convert JSON
function main() {
  let chainName = "osmosis";
  generateMintscanAssets(chainName);
}

main();