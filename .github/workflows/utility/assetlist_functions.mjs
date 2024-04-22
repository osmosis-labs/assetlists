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
export const assetlistFileName = "assetlist.json";
export const chainlistFileName = "chainlist.json";

//- Directory Names -
export const assetlistsRoot = "../../..";
export const noDir = "";
export const generatedDirectoryName = "generated";
export const chainRegAssetlist = path.join(generatedDirectoryName, "chain_registry");
export const zoneConfigAssetlist = path.join(generatedDirectoryName, "frontend");
export const zoneConfigChainlist = path.join(generatedDirectoryName, "frontend");

//- Chain Names --
export const chainNames = [
  "osmosis",
  "osmosistestnet"
];
const chainNames_decommissioned = [
  "osmosistestnet4"
];



//-- Functions --


function getFileLocation(chainName, directoryName, fileName) {
  
  const chainNameToChainIdMap = new Map([
    ["osmosis", "osmosis-1"],
    ["osmosistestnet4", "osmo-test-4"],
    ["osmosistestnet", "osmo-test-5"]
  ]);
  return path.join(
    assetlistsRoot,
    chainNameToChainIdMap.get(chainName) || "",
    directoryName,
    fileName
  );
}



export function readFromFile(chainName, directoryName, fileName) {
  try {
    return JSON.parse(
      fs.readFileSync(
        getFileLocation(chainName, directoryName, fileName)
      )
    );
  } catch (err) {
    console.log(err);
  }
}



export function writeToFile(chainName, directoryName, fileName, value) {
  try {
    fs.writeFile(
      getFileLocation(chainName, directoryName, fileName),
      JSON.stringify(value,null,2),
      (err) => {
        if (err) throw err;
      }
    );
    //console.log("Write successful!");
  } catch (err) {
    console.log(err);
  }
}



export function getFilesInDirectory(directoryPath) {
  try {
    // Read the contents of the directory synchronously
    const files = fs.readdirSync(directoryPath);

    // Filter out only the files from the list of entries
    const filePaths = files.map(file => path.join(directoryPath, file))
      .filter(filePath => fs.statSync(filePath).isFile());

    return filePaths;
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error);
    return [];
  }
}



export async function calculateIbcHash(ibcHashInput) {
  const textAsBuffer = new TextEncoder().encode(ibcHashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const digest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const ibcHashOutput = "ibc/" + digest.toUpperCase();
  return ibcHashOutput;
}

