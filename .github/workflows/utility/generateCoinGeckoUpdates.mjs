// Purpose:
//   to generate the recommended updates to CoinGecko assets


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';
import * as path from 'path';
import * as api_mgmt from './api_management.mjs';
import * as json_mgmt from './json_management.mjs';

export const Status = Object.freeze({
  PENDING: "PENDING",
  COMPLETED: "COMPLETED"
});

//-- Globals --

const outputFileName = "output.json";
const stateFileName = "state.json";
const coinGeckoDirName = "coingecko";
const coinGeckoDir = path.join(zone.externalDir, coinGeckoDirName);

const numberOfUnseenAssetsToQuery = 2;
const numberOfPendingAssetsToCheck = 1;
const querySleepTime = 2000;

async function queryCoinGeckoId(id) {
  const coinGeckoAPI = "https://api.coingecko.com/api/v3/coins/";
  const url = coinGeckoAPI + id;
  return api_mgmt.queryApi(url);
}

function getAssetsThatAreSupposedToHaveOsmosisDenom(chainName) {

  const traces = [
    "ibc",
    "ibc-cw20",
    "additional-mintage"
  ];

  let coinGeckoIdToAssetMap = new Map();

  //iterate osmosis assets
  const assets = chain_reg.getAssetPointersByChain(chainName);
  //  for each asset, get its coingecko ID, but only by certain traces.
  assets?.forEach((asset) => {
    let coinGeckoId = chain_reg.getAssetPropertyWithTraceCustom(chainName, asset.base_denom, "coingecko_id", traces);
    if (coinGeckoId) {
      let decimals = chain_reg.getAssetDecimals(chainName, asset.base_denom);
      let detailPlatform = {
        [chainName]: {
          decimal_place: decimals,
          contract_address: asset.base_denom
        }
      };
      coinGeckoIdToAssetMap.set(coinGeckoId, detailPlatform);
    }
  });

  return coinGeckoIdToAssetMap;

}

function prepareAssetUpdatesForOsmosisDenom(assetsToUpdate, coinGeckoIdToAssetMap) {
  let assetsToUpdateWithPlatformDetail = [];
  assetsToUpdate.forEach((asset) => {
    let assetWithPlatformDetail = coinGeckoIdToAssetMap.get(asset);
    if (assetWithPlatformDetail) {
      assetsToUpdateWithPlatformDetail.push({ [asset]: assetWithPlatformDetail });
    }
  });
  return assetsToUpdateWithPlatformDetail;
}


async function checkUnseenAssets(memory, state, stateLocation, output, outputLocation, assets) {

  if (!(assets.length > 0)) { return; }

  let newlyCompletedAssets = [];
  let newlyPendingAssets = [];
  let limitedAssets = assets.slice(0, numberOfUnseenAssetsToQuery);
  for (const asset of limitedAssets) {
    console.log(asset);
    let apiResponse = await queryCoinGeckoId(asset);
    if (!apiResponse) { continue; }
    if (apiResponse?.detail_platforms?.[memory.chainName]) {
      newlyCompletedAssets.push(asset);
    } else {
      newlyPendingAssets.push(asset);
    }
    apiResponse = undefined;
    await api_mgmt.sleep(querySleepTime);
  }
  if (!(newlyCompletedAssets.length > 0) && !(newlyPendingAssets.length > 0)) { return; }

  let pendingAssets = json_mgmt.getStructureValue(state, stateLocation)?.[Status.PENDING];
  let completedAssets = json_mgmt.getStructureValue(state, stateLocation)?.[Status.COMPLETED];
  let outputAssets = json_mgmt.getStructureValue(output, outputLocation);
  json_mgmt.setStructureValue(state, `${stateLocation}.${Status.PENDING}`, pendingAssets.concat(newlyPendingAssets));
  json_mgmt.setStructureValue(state, `${stateLocation}.${Status.COMPLETED}`, completedAssets.concat(newlyCompletedAssets));
  let updatedOutputAssets = outputAssets.concat(
    prepareAssetUpdatesForOsmosisDenom(newlyPendingAssets, memory.coinGeckoIdToAssetMap)
  );
  json_mgmt.setStructureValue(output, outputLocation, updatedOutputAssets);
  memory.updated = 1;

  console.log("Done Checking Assets");
}

async function checkPendingAssets(memory, state, stateLocation, output, outputLocation) {

  let pendingAssets = json_mgmt.getStructureValue(state, stateLocation)?.[Status.PENDING];
  if (!(pendingAssets.length > 0)) { return; }

  let newlyCompletedAssets = [];
  let limitedPendingAssets = pendingAssets.slice(0, numberOfPendingAssetsToCheck);
  for (const asset of limitedPendingAssets) {
    console.log(asset);
    let apiResponse = await queryCoinGeckoId(asset);
    if (!apiResponse) { continue; }
    if (apiResponse?.detail_platforms?.[memory.chainName]) {
      newlyCompletedAssets.push(asset);
    }
    apiResponse = undefined;
    await api_mgmt.sleep(querySleepTime);
  }

  //Move the top pending assets to the bottom
  pendingAssets = zone.removeElements(pendingAssets, limitedPendingAssets).concat(limitedPendingAssets);
  json_mgmt.setStructureValue(state, `${stateLocation}.${Status.PENDING}`, pendingAssets);
  memory.updated = 1;

  //Make sure there is an actual update before proceeding
  if (!(newlyCompletedAssets.length > 0)) { return; }

  pendingAssets = zone.removeElements(pendingAssets, newlyCompletedAssets);
  let completedAssets = json_mgmt.getStructureValue(state, stateLocation)?.[Status.COMPLETED].concat(newlyCompletedAssets);
  let outputAssets = json_mgmt.getStructureValue(output, outputLocation);

  //Save changes to state and output
  json_mgmt.setStructureValue(state, `${stateLocation}.${Status.PENDING}`, pendingAssets);
  json_mgmt.setStructureValue(state, `${stateLocation}.${Status.COMPLETED}`, completedAssets);
  outputAssets = outputAssets.filter(
    outputAsset => !newlyCompletedAssets.includes(Object.keys(outputAsset)[0])
  );
  json_mgmt.setStructureValue(output, outputLocation, outputAssets);

  console.log("Done Checking Pending");
}


async function findAssetsMissingOsmosisDemon(memory, state, output) {

  //Which CoinGecko asset value am I concerned with? Whether the asset's Contracts contains the Osmosis Denom
  const value = "osmosisDenom";
  const stateLocation = `${value}`;
  const outputLocation = `${value}`;

  //read state file, so we know which cgid's to skip
  const completeAssets = state?.[value]?.[Status.COMPLETED] || [];
  const pendingAssets = state?.[value]?.[Status.PENDING] || [];
  let assetsToSkip = [...completeAssets, ...pendingAssets];
  console.log(`Assets to Skip: ${assetsToSkip}`);

  //get a list of assets whose denom should be listed to the coingecko page
  memory.coinGeckoIdToAssetMap = getAssetsThatAreSupposedToHaveOsmosisDenom(memory.chainName);
  const requiredAssets = Array.from(memory.coinGeckoIdToAssetMap?.keys());
  //console.log(`CoinGeckoId to Asset Map: ${coinGeckoIdToAssetMap}`);

  //omit the assets that we already know ahve the osmosis denom in the coingecko asset
  const assetsToQuery = zone.removeElements(requiredAssets, assetsToSkip);
  console.log(`Assets to Query: ${assetsToQuery}`);

  await checkUnseenAssets(memory, state, stateLocation, output, outputLocation, assetsToQuery);

  await checkPendingAssets(memory, state, stateLocation, output, outputLocation);

}

export function saveUpdates(memory, state, output) {
  console.log(`Update? ${memory.updated ? "Yes" : "No"}`);
  if (memory.updated) {
    zone.writeToFile(memory.chainName, coinGeckoDir, stateFileName, state);
    zone.writeToFile(memory.chainName, coinGeckoDir, outputFileName, output);
    console.log("Updated files!");
  }
}

async function generateCoinGeckoUpdates(memory, state, output) {

  //call for each property to assess
  await findAssetsMissingOsmosisDemon(memory, state, output);

  //finally, save the findings
  saveUpdates(memory, state, output);

}

async function main() {
  let memory = { chainName: "osmosis" };
  let state = zone.readFromFile(memory.chainName, coinGeckoDir, stateFileName);
  let output = zone.readFromFile(memory.chainName, coinGeckoDir, outputFileName);
  await generateCoinGeckoUpdates(memory, state, output);
  console.log("Done");
}

main();