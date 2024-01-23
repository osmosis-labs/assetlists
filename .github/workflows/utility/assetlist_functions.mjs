// Purpose:
//   to generalize functions used within the assetlists repo




//-- Imports --

import * as fs from 'fs';
import * as path from 'path';
import * as chain_reg from './chain_registry.mjs';





//-- Gloabl Constants --

//- Input Files -
export const zoneConfigFileName    = "osmosis.zone_config.json";
export const zoneAssetlistFileName = "osmosis.zone_assets.json";
export const zoneChainlistFileName = "osmosis.zone_chains.json";

//- Generated Files -
export const zoneAssetConfigFileName = "zone_asset_config.json";
export const assetlistFileName = "assetlist.json";
export const chainlistFileName = "chainlist.json";

//- Chain Names --
export const chainNames = [
  "osmosis",
  "osmosistestnet"
];
const chainNames_decommissioned = [
  "osmosistestnet4"
];



//-- Functions --


function getFileLocation(chainName, fileName) {
  
  const assetlistsRoot = "../../..";
  const generatedDirectoryName = "generated";
  const chainNameToChainIdMap = new Map([
    ["osmosis", "osmosis-1"],
    ["osmosistestnet4", "osmo-test-4"],
    ["osmosistestnet", "osmo-test-5"]
  ]);

  let envDir = "";
  if (                                   // is a generated file
    fileName == zoneAssetConfigFileName  || 
    fileName == assetlistFileName        ||
    fileName == chainlistFileName
  ) {
    envDir = generatedDirectoryName;
  }
  return path.join(
    assetlistsRoot,
    chainNameToChainIdMap.get(chainName),
    envDir,
    fileName
  );
}


export function readFromFile(chainName, fileName) {
  try {
    return JSON.parse(
      fs.readFileSync(
        getFileLocation(chainName, fileName)
      )
    );
  } catch (err) {
    console.log(err);
  }
}


export function writeToFile(chainName, fileName, value) {
  try {
    fs.writeFile(
      getFileLocation(chainName, fileName),
      JSON.stringify(value,null,2),
      (err) => {
        if (err) throw err;
      }
    );
  } catch (err) {
    console.log(err);
  }
}
