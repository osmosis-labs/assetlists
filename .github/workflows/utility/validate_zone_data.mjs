// Purpose:
//   to validate the data in the zone file, e.g., see if the asset exists and has enough info the add to Osmosis

// -- THE PLAN --
//
// read zone file to get asset pointers
// get chain registry asset pointers
// for loop to see if each asset pointer from zone file exists in chain reg asset pointers
//

import * as path from 'path';
import * as chain_reg from './chain_registry.mjs';

const root = "../../..";
const networkTypeToDirectoryMap = new Map();
networkTypeToDirectoryMap.set("mainnet","osmosis-1");
networkTypeToDirectoryMap.set("testnet","osmo-test-4");
const zoneFileName = "osmosis.zone.json";
const networkTypeToZoneFileMap = new Map();
Array.from(networkTypeToDirectoryMap.keys()).forEach((networkType) => {
  networkTypeToZoneFileMap.set(networkType, path.join(root, networkTypeToDirectoryMap.get(networkType), zoneFileName));
});

function main() {
  
  const chainRegAssetPointers = chain_reg.getAssetPointers();
  Array.from(networkTypeToZoneFileMap.keys()).forEach((networkType) => {
    let zoneJson = chain_reg.readJsonFile(networkTypeToZoneFileMap.get(networkType));
    zoneJson.assets.forEach((zoneAsset) => {
      let ASSET_EXISTS = false;
      chainRegAssetPointers.forEach((chainRegAsset) => {
        if(chainRegAsset.chain_name == zoneAsset.chain_name && chainRegAsset.base_denom == zoneAsset.base_denom) {
          ASSET_EXISTS = true;
        }
      });
      //console.log(zoneAsset);
      if(!ASSET_EXISTS) {
        throw new Error(`Asset ${zoneAsset.base_denom} does not exist in the chain registry.`);
      }
    }); 
  });
  
}

main();