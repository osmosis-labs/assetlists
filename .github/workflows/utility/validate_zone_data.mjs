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
const chainNameToZoneAssetsFileMap = new Map();
const chainNameToZoneChainsFileMap = new Map();
Array.from(chainNameToChainIdMap.keys()).forEach((chainName) => {
  chainNameToZoneAssetsFileMap.set(chainName, path.join(root, chainNameToChainIdMap.get(chainName), zoneAssetsFileName));
  chainNameToZoneChainsFileMap.set(chainName, path.join(root, chainNameToChainIdMap.get(chainName), zoneChainsFileName));
});

function main() {
  
  const chainRegAssetPointers = chain_reg.getAssetPointers();
  Array.from(chainNameToChainIdMap.keys()).forEach((chainName) => {
    let zoneAssetsJson = chain_reg.readJsonFile(chainNameToZoneAssetsFileMap.get(chainName));
    let zoneChainsJson = chain_reg.readJsonFile(chainNameToZoneChainsFileMap.get(chainName));

    let zoneChains = [];

    //see if zone_chain is valid
    zoneChainsJson.chains.forEach((zoneChain) => {

      let CHAIN_EXISTS = false;
      let chain_name = chain_reg.getFileProperty(zoneChain.chain_name, "chain", "chain_name");
      if (chain_name == zoneChain.chain_name) {
        zoneChains.push(chain_name);
        CHAIN_EXISTS = true;
      }
      if (!CHAIN_EXISTS) {
        throw new Error(`Chain ${zoneChain.chain_name} does not exist in the chain registry.`);
      }

    });

    zoneAssetsJson.assets.forEach((zoneAsset) => {

      let ASSET_EXISTS = false;
      ASSET_EXISTS = chainRegAssetPointers.some((chainRegAsset) => {
        if(chainRegAsset.chain_name == zoneAsset.chain_name && chainRegAsset.base_denom == zoneAsset.base_denom) {
          return true;
        }
      });
      //console.log(zoneAsset);
      if(!ASSET_EXISTS) {
        throw new Error(`Asset ${zoneAsset.base_denom} does not exist in the chain registry.`);
      }

      //see if chain_name is in zone chains
      if (!zoneChains.includes(zoneAsset.chain_name)) {
        console.log(zoneChains);
        throw new Error(`Asset: ${zoneAsset.base_denom}'s Chain: ${zoneAsset.chain_name} does not exist in zone_chains.json.`);
      }

      //see if ibc channel is registered
      let VALID_PATH = false;
      if (zoneAsset.chain_name != chainName) {
        if (!zoneAsset.path) {
          throw new Error(`Path missing for ${zoneAsset.base_denom}. Please enter a Path.`);
        }
          
        let chain1 = false;
        if (chain_reg.getIBCFileProperty(chainName, zoneAsset.chain_name, "chain_1").chain_name == chainName) {
          chain1 = true;
        }
        let ibcChannels = chain_reg.getIBCFileProperty(chainName, zoneAsset.chain_name, "channels");
        let thisChannel = "";
        let thisPort = "";

        VALID_PATH = ibcChannels.some((channel) => {
          if (chain1) {
            thisChannel = channel.chain_1.channel_id;
            thisPort = channel.chain_1.port_id;
          } else {
            thisChannel = channel.chain_2.channel_id;
            thisPort = channel.chain_2.port_id;
          }
          if (zoneAsset.path.startsWith(thisPort + '/' + thisChannel)) {
            return true;
          }
        });
        if (!VALID_PATH) {
          throw new Error(`IBC Channel for Path: ${zoneAsset.path} does not exist in the chain registry.`);
        }
      }

    }); 
  });
  
}

main();