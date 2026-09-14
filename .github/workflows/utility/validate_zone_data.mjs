// Purpose:
//   to validate the data in the zone file, e.g., see if the asset exists and has enough info the add to Osmosis

// -- THE PLAN --
//
// read zone file to get asset pointers
// get chain registry asset pointers
// for loop to see if each asset pointer from zone file exists in chain reg asset pointers
//

import * as path from 'path';
import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import { queryPool } from './getPools.mjs';

const root = "../../..";

const chainNameToChainIdMap = new Map([
  ["osmosis", "osmosis-1"],
  ["osmosistestnet", "osmo-test-5"]
]);

const zoneAssetsFileName = "osmosis.zone_assets.json";
const zoneChainsFileName = "osmosis.zone_chains.json";
const chainNameToZoneAssetsFileMap = new Map();
const chainNameToZoneChainsFileMap = new Map();
Array.from(chainNameToChainIdMap.keys()).forEach((chainName) => {
  chainNameToZoneAssetsFileMap.set(chainName, path.join(root, chainNameToChainIdMap.get(chainName), zoneAssetsFileName));
  chainNameToZoneChainsFileMap.set(chainName, path.join(root, chainNameToChainIdMap.get(chainName), zoneChainsFileName));
});

export function validate_zone_files() {

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
        throw new Error(`Chain ${zoneChain.chain_name} does not exist in the Chain Registry.`);
      }

      /*
      let CHAIN_STAKING = false;
      let staking_token = chain_reg.getFileProperty(zoneChain.chain_name, "chain", "staking")?.staking_tokens[0]?.denom;
      if (staking_token) {
        CHAIN_STAKING = true;
      }
      if (!CHAIN_STAKING) {
        throw new Error(`Chain ${zoneChain.chain_name} does not have staking defined in the Chain Registry.`);
      }
      */

      let CHAIN_FEES = false;
      let fee_token = chain_reg.getFileProperty(zoneChain.chain_name, "chain", "fees")?.fee_tokens[0];
      if(
        fee_token?.low_gas_price !== undefined &&
        fee_token?.average_gas_price !== undefined &&
        fee_token?.high_gas_price !== undefined &&
        fee_token?.low_gas_price <= fee_token?.average_gas_price &&
        fee_token?.average_gas_price <= fee_token?.high_gas_price )
      {
        if(fee_token?.fixed_min_gas_price) {
          if(fee_token?.fixed_min_gas_price <= fee_token?.low_gas_price) {
            CHAIN_FEES = true;
          }
        } else {
          CHAIN_FEES = true;
        }
      }
      if (!CHAIN_FEES) {
        throw new Error(`Chain ${zoneChain.chain_name} does not have fees properly defined in the Chain Registry.`);
      }

    });

    let IS_MAINNET = chain_reg.getFileProperty(chainName, "chain", "network_type") === "mainnet";

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
      if (zoneAsset.chain_name != chainName) {
        checkAssetIBCData(zoneAsset, chainName, IS_MAINNET);
      }

      //see if canonical asset is valid
      if (zoneAsset.canonical) {
        let VALID_CANONICAL_ASSET = false;
        if (!zoneAsset.canonical.chain_name || !zoneAsset.canonical.base_denom) {
          throw new Error(`Canonical asset pointer incomplete for ${zoneAsset}. Please complete the asset pointer.`);
        }
        VALID_CANONICAL_ASSET = chain_reg.getAssetProperty(
          zoneAsset.canonical.chain_name,
          zoneAsset.canonical.base_denom,
          "base"
        );
        if (!VALID_CANONICAL_ASSET) {
          throw new Error(`Canonical asset reference: ${zoneAsset.canonical.chain_name},${zoneAsset.canonical.base_denom} does not exist in the Chain Registry.`);
        }
      }

    }); 
  });
  
}

function checkAssetIBCData(zoneAsset, chainName, IS_MAINNET) {

  if (
    (
      !IS_MAINNET && !zoneAsset.path
    )
      ||
    zoneAsset.override_properties?.ibc
  ) { return; }

  if ( !zoneAsset.path ) {
    throw new Error(`Path missing for ${zoneAsset.base_denom}. Please enter a Path.`);
  }

  // Check if IBC connection exists
  const chain1Data = chain_reg.getIBCFileProperty(chainName, zoneAsset.chain_name, "chain_1");
  const ibcChannels = chain_reg.getIBCFileProperty(chainName, zoneAsset.chain_name, "channels");

  if (!chain1Data || !ibcChannels) {
    // Check if the source chain is killed in the chain registry.
    const chainStatus = chain_reg.getFileProperty(zoneAsset.chain_name, "chain", "status");
    const isKilledChain = chainStatus === "killed";

    // A killed source chain has no live IBC connection, so skip IBC validation.
    // (The old `zoneAsset.archived` / `zoneAsset.legacy` arms were unreachable:
    // the asset schema sets additionalProperties:false and defines neither key,
    // so any asset carrying them already fails schema validation.)
    if (isKilledChain) {
      console.log(`Info: killed chain ${zoneAsset.chain_name}:${zoneAsset.base_denom} has no IBC connection (expected).`);
      return;
    }
    // For a live chain, the missing IBC connection is an error.
    throw new Error(`No IBC connection found for ${zoneAsset.chain_name} (${zoneAsset.base_denom}). Chain status: ${chainStatus || 'unknown'}`);
  }

  let chain1 = false;
  if (chain1Data.chain_name == chainName) {
    chain1 = true;
  }
  let thisChannel = "";
  let thisPort = "";

  let VALID_PATH = ibcChannels.some((channel) => {
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


//validate_zone_files();
