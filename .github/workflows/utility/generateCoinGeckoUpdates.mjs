// Purpose:
//   to generate the recommended updates to CoinGecko assets


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';
import * as path from 'path';
import * as state_mgmt from 'state_management';


//-- Globals --

const coinGeckoDirName = "coingecko";
const coinGeckoDir = path.join(zone.externalDir, coinGeckoDirName);

const numberOfUnseenAssetsToQuery = 1;
const numberOfPendingAssetsToCheck = 1;

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

async function queryCoinGeckoAssetForOsmosisDenom(id) {

  const coinGeckoAPI = "https://api.coingecko.com/api/v3/coins/";
  const url = coinGeckoAPI + id;

  try {
    // Fetch data from the API
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Error fetching data: ${response.statusText}`);
      return;
    }

    const coinGeckoAssetData = await response.json();
    console.log("Successfully fetched CoinGecko Asset Data.");
    return coinGeckoAssetData;
    
  } catch (error) {
    console.log('Error fetching CoinGecko asset data:', error);
    return;
  }

}


async function queryCoinGeckoAssetsForOsmosisDenom(chainName, coinGeckoIdToAssetMap, assetsToQuery, assetsToUpdate, confirmedAssets) {

  for (let i = 0; i < numberOfUnseenAssetsToQuery && i < assetsToQuery?.length; i++) {
    const coinGeckoAssetData = await queryCoinGeckoAssetForOsmosisDenom(asset); // result of API query
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


async function checkPendingUpdates(chainName, state, value, output, coinGeckoIdToAssetMap) {
  if (!(state?.[state_mgmt.Status.PENDING]?.length > 0)) { return; }
  let assetsToQuery = [];
  for (let i = 0; i < numberOfPendingAssetsToCheck; i++) {
    const item = state[state_mgmt.Status.PENDING][i];
    assetsToQuery.push(item);
  }
  let assetsToUpdate = [];
  let confirmedAssets = [];
  await queryCoinGeckoAssetsForOsmosisDenom(chainName, coinGeckoIdToAssetMap, assetsToQuery, assetsToUpdate, confirmedAssets);
  if (confirmedAssets.length === 0) { return; } // The pending assets are not completed
  state_mgmt.removeFromState(state, value, state.Status.PENDING, confirmedAssets);
  state_mgmt.addToState(state, value, state.Status.COMPLETED, confirmedAssets);
  state_mgmt.removeFromOutput(output, value, confirmedAssets);
}


async function findAssetsMissingOsmosisDemon(chainName, state, output, updated) {

  //Which CoinGecko asset value am I concerned with? Whether the asset's Contracts contains the Osmosis Denom
  const value = "osmosisDenom";

  //read state file, so we know which cgid's to skip
  const completeAssets = state?.[value]?.[state.Status.COMPLETED] || [];
  const pendingAssets = state?.[value]?.[state.Status.PENDING] || [];
  let assetsToSkip = [...completeAssets, ...pendingAssets];
  console.log(`Assets to Skip: ${assetsToSkip}`);

  //get a list of assets whose denom should be listed to the coingecko page
  let coinGeckoIdToAssetMap = getAssetsThatAreSupposedToHaveOsmosisDenom(chainName);
  const requiredAssets = Array.from(coinGeckoIdToAssetMap.keys());
  //console.log(`CoinGeckoId to Asset Map: ${coinGeckoIdToAssetMap}`);

  //omit the assets that we already know ahve the osmosis denom in the coingecko asset
  const assetsToQuery = zone.removeElements(requiredAssets, assetsToSkip);
  console.log(`Assets to Query: ${assetsToQuery}`);

  //query the remaining coingecko assets to see if they still aren't on coingecko
  let assetsToUpdate = [];
  let confirmedAssets = [];
  await queryCoinGeckoAssetsForOsmosisDenom(chainName, coinGeckoIdToAssetMap, assetsToQuery, assetsToUpdate, confirmedAssets);
  console.log(`Confirmed Assets: ${confirmedAssets}`);
  console.log(`Assets To Update: ${assetsToUpdate}`);


  //if the coingecko asset already has the osmosis denom, save that in the coingecko assets file so we don't keep querying them
  //console.log(assetsToAddToState);
  state_mgmt.addToState(state, value, state_mgmt.Status.COMPLETED, confirmedAssets);
  state_mgmt.addToState(state, value, state_mgmt.Status.PENDING, assetsToUpdate);

  //if the coingecko asset doesn't have the osmosis denom, add the osmosis denom to the list of update assets
  //console.log(assetsToUpdate);
  assetsToUpdate = prepareAssetUpdatesForOsmosisDenom(assetsToUpdate, coinGeckoIdToAssetMap);
  state_mgmt.addToOutput(output, value, assetsToUpdate);

  //check the earliest pending asset
  checkPendingUpdates(chainName, state, value, output, coinGeckoIdToAssetMap);

  //remember to update
  if (assetsToUpdate.length !== 0 || confirmedAssets.length !== 0) {
    updated.value = 1;
  }

}

async function generateCoinGeckoUpdates(chainName, state, output) {

  let updated = { value: 0 };

  await findAssetsMissingOsmosisDemon(chainName, state, output, updated);

  if (updated.value) {
    state_mgmt.writeStateFile(chainName, coinGeckoDir, state);
    state_mgmt.writeOutputFile(chainName, coinGeckoDir, output);
    console.log("Updated files!");
  }

}

async function main() {
  let chainName = "osmosis";
  let state = state_mgmt.readStateFile(chainName, coinGeckoDir); //This is where we save the state of API results
  let output = state_mgmt.readOutputFile(chainName, coinGeckoDir); //This is where we save the desired output
  await generateCoinGeckoUpdates(chainName, state, output);
  console.log("Done");
}

main();