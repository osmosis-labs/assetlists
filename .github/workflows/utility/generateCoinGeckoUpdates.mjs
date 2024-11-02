// Purpose:
//   to generate the recommended updates to CoinGecko assets


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';
import * as path from 'path';
import * as state_mgmt from './state_management.mjs';
import * as api_mgmt from './api_management.mjs';


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

//const extractDataPath = ['detail_platforms', chainName];

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

async function queryCoinGeckoAssetsForOsmosisDenom(chainName, coinGeckoIdToAssetMap, assetsToQuery, assetsToUpdate, confirmedAssets) {

  for (let i = 0; i < numberOfUnseenAssetsToQuery && i < assetsToQuery?.length; i++) {
    const asset = assetsToQuery[i];
    const coinGeckoAssetData = await queryCoinGeckoId(asset); // result of API query
    const osmosisPlatform = coinGeckoAssetData?.detail_platforms?.[chainName]; // extracts what we're interested in
    if (osmosisPlatform) {
      console.log(`${chainName} already included for ${asset}.`);
      if (
        osmosisPlatform.contract_address !== coinGeckoIdToAssetMap.get(asset)?.[chainName]?.contract_address
          ||
        osmosisPlatform.decimal_place !== coinGeckoIdToAssetMap.get(asset)?.[chainName]?.decimal_place
      ) {
        console.log(`Mismatch! ${osmosisPlatform.decimal_place} does not equal ${coinGeckoIdToAssetMap.get(asset)?.[chainName]?.decimal_place}.`);
      } else {
        confirmedAssets.push(asset);
      }
    } else {
      console.log(`Need to update: ${asset}`);
      assetsToUpdate.push(asset);
    }
    await zone.sleep(2000);

  }

  return;

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


async function checkPendingUpdatesCoinGecko(condition, state, output) {
  const query = {
    function: queryCoinGeckoId,
    limit: numberOfPendingAssetsToCheck,
    sleepTime: querySleepTime
  };
  state_mgmt.checkPendingUpdates(query, condition, state, output);
}

async function checkNextAssets(memory, condition, keys, conditionMet, conditionNotMet) {
  const query = {
    function: queryCoinGeckoId,
    limit: numberOfUnseenAssetsToQuery,
    sleepTime: querySleepTime
  };
  await api_mgmt.queryKeys(query, keys, condition, conditionMet, conditionNotMet);
}


async function findAssetsMissingOsmosisDemon(memory, state, output) {

  //Which CoinGecko asset value am I concerned with? Whether the asset's Contracts contains the Osmosis Denom
  const value = "osmosisDenom";
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

  //query the remaining coingecko assets to see if they still aren't on coingecko
  let assetsToUpdate = [];
  let confirmedAssets = [];
  //await queryCoinGeckoAssetsForOsmosisDenom(memory.chainName, memory.coinGeckoIdToAssetMap, assetsToQuery, assetsToUpdate, confirmedAssets);
  await checkNextAssets(memory, condition, assetsToQuery, confirmedAssets, assetsToUpdate);
  console.log(`Confirmed Assets: ${confirmedAssets}`);
  console.log(`Assets To Update: ${assetsToUpdate}`);

  //if the coingecko asset already has the osmosis denom, save that in the coingecko assets file so we don't keep querying them
  //console.log(assetsToAddToState);
  state_mgmt.addToState(state, value, state_mgmt.Status.COMPLETED, confirmedAssets);
  state_mgmt.addToState(state, value, state_mgmt.Status.PENDING, assetsToUpdate);

  //if the coingecko asset doesn't have the osmosis denom, add the osmosis denom to the list of update assets
  //console.log(assetsToUpdate);
  assetsToUpdate = prepareAssetUpdatesForOsmosisDenom(assetsToUpdate, memory.coinGeckoIdToAssetMap);
  state_mgmt.addToOutput(output, value, assetsToUpdate);

  //check the earliest pending asset
  //checkPendingUpdates(chainName, state, value, output, coinGeckoIdToAssetMap);
  checkPendingUpdatesCoinGecko(memory, condition, state, output);

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