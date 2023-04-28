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

const chainNameToChainIdMap = new Map([
  ["osmosis", "osmosis-1"],
  ["osmosistestnet", "osmo-test-4"],
  ["osmosistestnet5", "osmo-test-5"]
]);

const zoneAssetsFileName = "osmosis.zone_assets.json";
const zoneChainsFileName = "osmosis.zone_chains.json";
const chainNameToZoneFileMap = new Map();
Array.from(chainNameToChainIdMap.keys()).forEach((chainName) => {
  chainNameToZoneFileMap.set(chainName, path.join(root, chainNameToChainIdMap.get(chainName), zoneAssetsFileName));
});

function main() {
  
  const chainRegAssetPointers = chain_reg.getAssetPointers();
  Array.from(chainNameToZoneFileMap.keys()).forEach((chainName) => {
    let zoneJson = chain_reg.readJsonFile(chainNameToZoneFileMap.get(chainName));
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