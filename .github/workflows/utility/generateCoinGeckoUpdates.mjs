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

function readStateFile() {
  const file = path.join(coinGeckoDir, coinGeckoStateFileName);
  return chain_reg.readJsonFile(file);
}

function saveStateFile(state) {
  let file = path.join(coinGeckoDir, coinGeckoStateFileName);
  chain_reg.writeJsonFile(file, state)
}

function getAssetsRequiringOsmosisDenom(chainName) {

  const traces = [
    "ibc",
    "ibc-cw20",
    "additional-mintage"
  ];

  assetsRequiringOsmosisDenom = [];

  //iterate osmosis assets
  const assets = chain_reg.getAssetPointersByChain(chainName);
  //  for each asset, get its coingecko ID, but only by certain traces.
  assets?.forEach((asset) => {
    let coingeckoId = chain_reg.getAssetPropertyWithTraceCustom(chainName, asset.base, "coingecko_id", traces);
    if (coingeckoId) {
      let decimals = chain_reg.getAssetDecimals(chainName, asset.base);
      let asset_object = {
        coingeckoId: coingeckoId,
        platform: chainName,
        decimals: decimals,
        contract: asset.base
      };
      assetsRequiringOsmosisDenom.push(asset_object);
    }
  });

  return assetsRequiringOsmosisDenom;

}

function findAssetsMissingOsmosisDemon(chainName, state) {

  //read state file, so we know which cgid's to skip
  let denomState = state?.assetsWithOsmosisDenom;

  //get a list of assets whose denom should be listed to the coingecko page
  let assetsRequiringOsmosisDenom = getAssetsRequiringOsmosisDenom(chainName);

  //with the assets and their coingecko IDs, get the coingecko assets that already have the osmosis denom
  //getAssetAlreadyConfigured(chainName, denomState);

  //if the coingecko asset already has the osmosis denom, save that in the coingecko assets file.

  //if the coingecko asset doesn't have the osmosis denom, add the osmosis denom to the list of recommended assets

  //with the list of recommended assets, save to file and submit to coingecko

}

function generateCoinGeckoUpdates(chainName, state) {
  
  findAssetsMissingOsmosisDemon(chainName, state);
  saveUpdatesFile(chainName);

}

async function main() {
  let chainName = "osmosis";
  const state = readStateFile();
  generateCoinGeckoUpdates(chainName, state);
}

main();