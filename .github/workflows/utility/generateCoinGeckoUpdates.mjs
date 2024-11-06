// Purpose:
//   to generate the recommended updates to CoinGecko assets


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';
import * as path from 'path';
import * as state_mgmt from './state_management.mjs';
import * as api_mgmt from './api_management.mjs';

export const Status = Object.freeze({
  PENDING: "PENDING",
  COMPLETED: "COMPLETED"
});

//-- Globals --

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

async function checkUnseenAssetsOld(condition, keys, conditionMet, conditionNotMet) {
  const query = {
    function: queryCoinGeckoId,
    limit: numberOfUnseenAssetsToQuery,
    sleepTime: querySleepTime
  };
  await api_mgmt.queryKeys(query, keys, condition, conditionMet, conditionNotMet);
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
    await zone.sleep(querySleepTime);
  }
  if (!(newlyCompletedAssets.length > 0) && !(newlyPendingAssets.length > 0)) { return; }

  let pendingAssets = state_mgmt.getStructureValue(state, stateLocation)?.[Status.PENDING];
  let completedAssets = state_mgmt.getStructureValue(state, stateLocation)?.[Status.COMPLETED];
  let outputAssets = state_mgmt.getStructureValue(output, outputLocation);
  state_mgmt.setStructureValue(state, `${stateLocation}.${Status.PENDING}`, pendingAssets.concat(newlyPendingAssets));
  state_mgmt.setStructureValue(state, `${stateLocation}.${Status.COMPLETED}`, completedAssets.concat(newlyCompletedAssets));
  let updatedOutputAssets = outputAssets.concat(
    prepareAssetUpdatesForOsmosisDenom(newlyPendingAssets, memory.coinGeckoIdToAssetMap)
  );
  state_mgmt.setStructureValue(output, outputLocation, updatedOutputAssets);
  state.updated = 1;

  console.log("Done Checking Assets");
}

async function checkPendingAssets(memory, state, stateLocation, output, outputLocation) {

  let pendingAssets = state_mgmt.getStructureValue(state, stateLocation)?.[Status.PENDING];
  if (!(pendingAssets.length > 0)) { return; }

  let newlyCompletedAssets = [];
  let limitedPendingAssets = pendingAssets.slice(0, numberOfPendingAssetsToCheck);
  for (const asset of limitedPendingAssets) {
    console.log(asset);
    let apiResponse = await queryCoinGeckoId(asset);
    if (apiResponse?.detail_platforms?.[memory.chainName]) {
      newlyCompletedAssets.push(asset);
    }
    apiResponse = undefined;
    await zone.sleep(querySleepTime);
  }
  if (!(newlyCompletedAssets.length > 0)) { return; }

  let completedAssets = state_mgmt.getStructureValue(state, stateLocation)?.[Status.COMPLETED];
  let outputAssets = state_mgmt.getStructureValue(output, outputLocation);
  state_mgmt.setStructureValue(state, `${stateLocation}.${Status.PENDING}`, zone.removeElements(pendingAssets, newlyCompletedAssets));
  state_mgmt.setStructureValue(state, `${stateLocation}.${Status.COMPLETED}`, completedAssets.concat(newlyCompletedAssets));
  state_mgmt.setStructureValue(output, outputLocation, zone.removeElements(outputAssets, completedAssets));
  state.updated = 1;

  //TODO move top asset to bottom

  console.log("Done Checking Pending");
}


async function findAssetsMissingOsmosisDemon(memory, state, output) {

  //Which CoinGecko asset value am I concerned with? Whether the asset's Contracts contains the Osmosis Denom
  const value = "osmosisDenom";
  const stateLocation = `${value}`;
  const outputLocation = `${value}`;
  const condition = (data) => data?.detail_platforms?.[memory.chainName];

  //read state file, so we know which cgid's to skip
  const completeAssets = state?.[value]?.[state_mgmt.Status.COMPLETED] || [];
  const pendingAssets = state?.[value]?.[state_mgmt.Status.PENDING] || [];
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

async function generateCoinGeckoUpdates(memory, state, output) {

  await findAssetsMissingOsmosisDemon(memory, state, output);
  state_mgmt.saveUpdates(memory, state, output);

}

async function main() {
  let memory = { chainName: "osmosis", dir: coinGeckoDir };
  let state = state_mgmt.readStateFile(memory.chainName, coinGeckoDir); //This is where we save the state of API results
  let output = state_mgmt.readOutputFile(memory.chainName, coinGeckoDir); //This is where we save the desired output
  await generateCoinGeckoUpdates(memory, state, output);
  console.log("Done");
}

main();