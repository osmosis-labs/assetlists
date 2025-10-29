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
  //["osmosistestnet", "osmo-test-4"],
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
    console.log(`Warning: No IBC connection found for ${zoneAsset.chain_name} (${zoneAsset.base_denom}). Skipping IBC validation.`);
    return;
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

export async function validate_add_asset() {

  
  const osmosis_zone = process.env.osmosis_zone;
  //const osmosis_zone = "osmosis (osmosis-1)";
  const chain_name = process.env.chain_name;
  //const chain_name = "cosmoshub";
  const base_denom = process.env.base_denom;
  //const base_denom = "uatom";
  const path = process.env.path;
  //const path = "transfer/channel-0/uatom";
  const osmosis_main = process.env.osmosis_main;
  const osmosis_pool = process.env.osmosis_pool;
  //const osmosis_pool = 1;
  const request_staging_frontend = process.env.request_staging_frontend;


  // -- VALIDATE CHAIN NAME ---

  //get osmosis chain name
  let osmosis_zone_chain_name = "";
  Array.from(chainNameToChainIdMap.keys()).forEach((zone_chain_name) => {
    if (osmosis_zone.includes(chainNameToChainIdMap.get(zone_chain_name))) {
      osmosis_zone_chain_name = zone_chain_name;
    }
  });
  //check chain_name
  let zoneChainsJson = chain_reg.readJsonFile(chainNameToZoneChainsFileMap.get(osmosis_zone_chain_name));
  if (!zoneChainsJson.chains.find(obj => obj.chain_name === chain_name)) {
    throw new Error(`Chain ${chain_name} does not exist in zone_chains.json. Register the chain first.`);
  }


  // --- VALIDATE BASE DENOM ---

  if (!chain_reg.getAssetProperty(chain_name, base_denom, "base")){
    throw new Error(`Asset ${base_denom} does not exist in the Chain Registry. Register the asset first.`);
  }
  let zoneAssetsJson = chain_reg.readJsonFile(chainNameToZoneAssetsFileMap.get(osmosis_zone_chain_name));
  if (zoneChainsJson.chains.find(obj => obj.base_denom === base_denom && obj.chain_name === chain_name)) {
    throw new Error(`Asset ${base_denom} already exists in zone_assets.json.`);
  }


  // --- VALIDATE PATH ---

  let VALID_PATH = false;
  if (!path) {
    throw new Error(`Path missing. Please enter a Path.`);
  }
  let chain1 = false;
  if (chain_reg.getIBCFileProperty(osmosis_zone_chain_name, chain_name, "chain_1").chain_name == osmosis_zone_chain_name) {
    chain1 = true;
  }
  let ibcChannels = chain_reg.getIBCFileProperty(osmosis_zone_chain_name, chain_name, "channels");
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
    if (path.startsWith(thisPort + '/' + thisChannel)) {
      return true;
    }
  });
  if (!VALID_PATH) {
    throw new Error(`IBC Channel for Path: ${path} does not exist in the chain registry.`);
  }


  // --- VALIDATE POOL ---

  if (osmosis_pool) {
    let pool = await queryPool(osmosis_zone_chain_name, osmosis_pool);
    let ibcDenom = await chain_reg.calculateIbcHash(path);
    console.log(ibcDenom);
    console.log(pool);
    console.log(pool.pool_assets[0].token);
    console.log(pool.pool_assets?.some(obj => obj.token.denom === ibcDenom));
    if (!(pool.pool_assets?.find(obj => obj.token.denom === ibcDenom) || pool.pool_liquidity?.find(obj => obj.denom === ibcDenom))) {
      throw new Error(`Pool: ${osmosis_pool} does not contain Base Denom: ${base_denom}.`);
    }
  }
  

  // --- CREATE ASSET OBJECT ---

  let asset = {
    chain_name: chain_name,
    base_denom: base_denom,
    path: path
  }
  if (osmosis_main) { asset.osmosis_main = true; } else { asset.osmosis_main = false; }
  asset.osmosis_frontier = true;


  // --- ADD ASSET TO ZONE ASSETS ---
  zoneAssetsJson.assets.push(asset);
  chain_reg.writeJsonFile(chainNameToZoneAssetsFileMap.get(osmosis_zone_chain_name),zoneAssetsJson);


}

//validate_zone_files();
//validate_add_asset();
