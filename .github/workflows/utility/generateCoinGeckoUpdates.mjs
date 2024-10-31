// Purpose:
//   to generate the recommended updates to CoinGecko assets


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';
import * as path from 'path';


//-- Globals --

const coinGeckoUpdatesFileName = "updates.json";
const coinGeckoStateFileName = "state.json";
const coinGeckoDirName = "coingecko";
const coinGeckoDir = path.join(zone.externalDir, coinGeckoDirName);

/*
 *  --CoinGecko State File--
 *  The State file saves from having to query CoinGecko's API repeatedly for assets that are already configured well.
 *  
 *   assetsWithOsmosisDenom[
 *     "coingecko-id-1",
 *     "coingecko-id-2",
 *     "etc.
 *   ];
 *   
 *   
 *  --Coingecko Updates File--
 *  The Updates file indicates which changes are required.
 *  
 *   assetsMissingOsmosisDenom[
 *     {
 *       coingecko_id: "cgid1",
 *       platform: "osmosis",
 *       decimals: 6 (e.g.)
 *       contract: "ibc/1a2b...3c4d" 
 *     }
 *   ];
 * 
 */

function readStateFile(chainName) {
  return zone.readFromFile(chainName, coinGeckoDir, coinGeckoStateFileName);
}

function writeStateFile(chainName, state) {
  zone.writeToFile(chainName, coinGeckoDir, coinGeckoStateFileName, state);
}

function readUpdatesFile(chainName) {
  return zone.readFromFile(chainName, coinGeckoDir, coinGeckoUpdatesFileName);
}

function writeUpdatesFile(chainName, updates) {
  zone.writeToFile(chainName, coinGeckoDir, coinGeckoUpdatesFileName, updates);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryCoinGeckoAssetsForOsmosisDenom(chainName, coinGeckoIdToAssetMap, assetsToQuery, assetsToUpdate, assetsToAddToState) {

  const queryCap = 2;
  let numQueries = 0;

  for (const asset of assetsToQuery) {

    console.log(numQueries);
    const coinGeckoAssetData = await queryCoinGeckoAssetForOsmosisDenom(asset);
    const osmosisPlatform = coinGeckoAssetData?.detail_platforms?.[chainName];

    if (osmosisPlatform) {
      console.log(`${chainName} already included for ${asset}.`);
      if (
        osmosisPlatform.contract_address !== coinGeckoIdToAssetMap.get(asset)?.[chainName]?.contract_address
          ||
        osmosisPlatform.decimal_place !== coinGeckoIdToAssetMap.get(asset)?.[chainName]?.decimal_place
      ) {
        console.log(`Mismatch! ${osmosisPlatform.decimal_place} does not equal ${coinGeckoIdToAssetMap.get(asset)?.[chainName]?.decimal_place}.`);
      } else {
        assetsToAddToState.push(asset);
      }
    } else {
      console.log(`Need to update: ${asset}`);
      assetsToUpdate.push(asset);
    }

    if (numQueries >= queryCap) {
      break;
    } else {
      numQueries++;
      await sleep(2000);
    }

  }

  return assetsToUpdate;

}

function addToState(state, property, status, items) {

  if (!state) {
    state = {};
  }
  if (!state[property]) {
    state[property] = {};
  }
  if (!state[property][status]) {
    state[property][status] = [];
  }
  items?.forEach((obj) => {
    state[property][status].push(obj);
  });
  console.log("Successfully updated State.");

}


function addToUpdates(updates, property, items) {

  if (!updates) {
    updates = {};
  }
  if (!updates[property]) {
    updates[property] = [];
  }
  items?.forEach((obj) => {
    updates[property].push(obj);
  });
  console.log("Successfully updated Updates.");

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


async function findAssetsMissingOsmosisDemon(chainName, state, updates, updated) {

  const property = "osmosisDenom";
  const statusNameComplete = "complete";
  const statusNamePending = "pending";

  //read state file, so we know which cgid's to skip
  const completeAssets = state[property]?.[statusNameComplete] || [];
  const pendingAssets = state[property]?.[statusNamePending] || [];
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
  addToState(state, property, statusNameComplete, confirmedAssets);
  addToState(state, property, statusNamePending, assetsToUpdate);

  //if the coingecko asset doesn't have the osmosis denom, add the osmosis denom to the list of update assets
  //console.log(assetsToUpdate);
  assetsToUpdate = prepareAssetUpdatesForOsmosisDenom(assetsToUpdate, coinGeckoIdToAssetMap);
  addToUpdates(updates, property, assetsToUpdate);

  if (assetsToUpdate.length !== 0 || confirmedAssets.length !== 0) {
    updated.value = 1;
  }

}

async function generateCoinGeckoUpdates(chainName, state) {

  let updated = { value: 0 };
  let updates = readUpdatesFile(chainName);

  await findAssetsMissingOsmosisDemon(chainName, state, updates, updated);

  console.log("Need to update?");
  console.log(updated.value);
  if (updated.value) {
    writeStateFile(chainName, state);
    writeUpdatesFile(chainName, updates);
    console.log("Done");
  }

}

async function main() {
  let chainName = "osmosis";
  let state = readStateFile(chainName);
  await generateCoinGeckoUpdates(chainName, state);
  
}

main();