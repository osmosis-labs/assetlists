
/*  Purpose:
 *    to manage the state for Osmosis Zone assets
 *    which includes data like: listingDate, ...
 * 
 * 
 *  State:
 *    "assets": []
 *      for each asset object{}:
 *        "base_denom": "uosmo",
 *        "listingDate": "{UTC date time format}",
 *        "legacyAsset": true,
 *        ...
 * 
 * 
 *  Plan:
 *    For each asset, see if it's verified, if so, we should have a listing date for it
 *    see if we have a listing date in the state
 *    if so, proceed to next
 *    if not, we should add a listing date for that asset to the state
 *    unless they are a legacy asset, which wew can determine from the state
 *  
 *  Note about Legacy Assets:
 *    however, many verified assets don't have a listing date, in which case, we should identify them as a legacy asset
 *    the state will keep a property 'legacyAsset: true' where the asset is verified but doesn't have a listing date
 *    legacyAssets will have to be populated manually, but they are easier to identify in an initial setup
 *    becase they are just all the verified assets without any listingDate
 * 
 * 
 * */


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as path from 'path';

const stateFileName = "state.json";
const stateDirName = "state";
const stateDir = path.join(zone.generatedDirectoryName, stateDirName);

const stateLocations = [
  "assets"
];
const stateAssetProperties = [
  "listingDate",
  "legacyAsset"
];

const currentDateUTC = new Date().toISOString();


// Problem: the listing date is stored both in the generate assetlist and in the state file. which do we generate first?

function setAssetListingDate(stateAsset, assetlistAsset) {

  //legacy assets don't need a listing date
  if (stateAsset.legacyAsset) { return; }

  //use the recorded listing date
  if (!stateAsset.listingDate) {
    //or else it's current datetime
    stateAsset.listingDate = currentDateUTC;
  }

  //save to assetlist
  assetlistAsset.listingDate = stateAsset.listingDate;

}

//get the state asset
function getStateAsset(base_denom, state) {
  let stateAsset = state.assets?.find(stateAsset => stateAsset.base_denom === base_denom);
  if (!stateAsset) {
    stateAsset = {
      base_denom: base_denom
    };
    state.assets.push(stateAsset);
  }
  return stateAsset;
}

// Main function to convert one JSON file to another
const generateState = (chainName, assetlist) => {

  // Read the existing State file
  let state = {};
  try {
    state = zone.readFromFile(chainName, stateDir, stateFileName);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`File not found: ${error.message}`);
      state = {}; // Assign empty object if file doesn't exist
    } else {
      throw error; // Re-throw for unexpected errors
    }
  }


  // Iterate each asset
  if (!state.assets) { state.assets = [] }
  for (let assetlistAsset of assetlist?.assets) {

    let stateAsset;

    //see if it's verified, and skip if not
    if (assetlistAsset.verified) { 

      //get the state asset
      stateAsset = getStateAsset(assetlistAsset.coinMinimalDenom, state);
    
      // Property 1: Get the listing Date
      setAssetListingDate(stateAsset, assetlistAsset);


      // Property 2: anything else...


    }

  }


  // Write the state to the state file
  zone.writeToFile(chainName, stateDir, stateFileName, state);
  console.log(`Update state completed. Data saved.`);

};


function getAssetlistFromFile(chainName) {

  // Read the generate assetlist
  const assetlist = zone.readFromFile(chainName, zone.zoneConfigAssetlist, zone.assetlistFileName);
  //console.log(`Generated Assetlist is: ${assetlist}`);
  return assetlist;

}

function saveAssetlistToFile(chainName, assetlist) {

  // Write the state to the state file
  zone.writeToFile(chainName, zone.zoneConfigAssetlist, zone.assetlistFileName, assetlist);
  console.log(`Update assetlist completed. Data saved.`);

}


export function updateState(chainName, assetlist) {
  let assetlistFromFile = false;
  if (!assetlist) {
    assetlist = getAssetlistFromFile(chainName);
    assetlistFromFile = true;
  }
  generateState(chainName, assetlist);
  if (assetlistFromFile) {
    saveAssetlistToFile(chainName, assetlist);
  }
}


function main() {
  zone.chainNames.forEach(chainName => generateState(chainName));
}