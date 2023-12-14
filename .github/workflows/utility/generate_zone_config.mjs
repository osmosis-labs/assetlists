// Purpose:
//   to generate the zone_config json using the zone json and chain registry data


import * as fs from 'fs';
import * as path from 'path';
import * as chain_reg from './chain_registry.mjs';
import { returnAssets } from './getPools.mjs';


const chainNameToChainIdMap = new Map([
  ["osmosis", "osmosis-1"],
  ["osmosistestnet4", "osmo-test-4"],
  ["osmosistestnet", "osmo-test-5"]
]);

const assetlistsRoot = "../../..";
const assetlistFileName = "assetlist.json";
const zoneAssetlistFileName = "osmosis.zone_assets.json";
const zoneChainlistFileName = "osmosis.zone_chains.json";


function getZoneAssetlist(chainName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      zoneAssetlistFileName
    )));
  } catch (err) {
    console.log(err);
  }
}

function writeToFile(assetlist, chainName) {
  try {
    fs.writeFile(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      chainNameToChainIdMap.get(chainName) +'.zone_config.json'
    ), JSON.stringify(assetlist,null,2), (err) => {
      if (err) throw err;
    });
  } catch (err) {
    console.log(err);
  }
}

async function calculateIbcHash(ibcHashInput) {
  const textAsBuffer = new TextEncoder().encode(ibcHashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const digest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const ibcHashOutput = "ibc/" + digest.toUpperCase();
  return ibcHashOutput;
}

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const generateAssets = async (chainName, assets, zone_assets) => {
  
  let pool_assets;
  pool_assets = await returnAssets(chainName);
  if (!pool_assets) { return; }
  
  await asyncForEach(zone_assets, async (zone_asset) => {

    let generatedAsset = {};
    
    
    
    generatedAsset.base_denom = zone_asset.base_denom;
    generatedAsset.chain_name = zone_asset.chain_name;

    
    let reference_asset = {};
    if(zone_asset.canonical){
      reference_asset = zone_asset.canonical;
    } else {
      reference_asset = zone_asset;
    }
    generatedAsset.coingecko_id = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "coingecko_id");
    

  
    //--Overrides Properties when Specified--
    if(zone_asset.override_properties) {
      if(zone_asset.override_properties.coingecko_id) {
        generatedAsset.coingecko_id = zone_asset.override_properties.coingecko_id;
      }
    }
    
    
    if(zone_asset.chain_name != chainName) {
      let ibcHash = calculateIbcHash(zone_asset.path);
      //--Replace Base with IBC Hash--
      generatedAsset.ibc_denom = await ibcHash;
    }

    generatedAsset.verified = zone_asset.osmosis_verified;

    if (pool_assets.get(generatedAsset.ibc_denom)) {
    
      generatedAsset.api_include = pool_assets.get(generatedAsset.ibc_denom).osmosis_info;
      
      let price = "";
      price = pool_assets.get(generatedAsset.ibc_denom).osmosis_price;
      if(price) {
        let price_parts = price.split(':');
        generatedAsset.price = {
          pool: price_parts[2],
          denom: price_parts[1]
        }
      }
      
    }
    
    let categories = [];
    if(zone_asset.categories) {
      categories = zone_asset.categories;
    }
    if(zone_asset.peg_mechanism) {
      categories.push("stablecoin");
    }
    let traces = chain_reg.getAssetProperty(zone_asset.chain_name, zone_asset.base_denom, "traces");
    traces?.forEach((trace) => {
      if(trace.type == "liquid-stake") {
        categories.push("liquid_staking");
      }
    });

    generatedAsset.categories = categories.length > 0 ? categories : undefined;
    
    generatedAsset.peg_mechanism = zone_asset.peg_mechanism;
    
    generatedAsset.additional_transfer = zone_asset.additional_transfer;

    generatedAsset.unstable = zone_asset.osmosis_unstable;
    
    generatedAsset.unlisted = zone_asset.osmosis_unlisted;
    
    
    
    //--Append Asset to Assetlist--
    assets.push(generatedAsset);
    
    //console.log(assets);
  
  });

}

async function generateAssetlist(chainName) {
  
  let zoneAssetlist = getZoneAssetlist(chainName);
  let assets = [];  
  await generateAssets(chainName, assets, zoneAssetlist.assets);
  if (!assets) { return; }
  let assetlist = {
    chain_name: chainName,
    assets: assets
  }
  //console.log(assetlist);
  
  writeToFile(assetlist, chainName);

}

async function main() {
  
  await generateAssetlist("osmosis");
  //await generateAssetlist("osmosistestnet4");
  await generateAssetlist("osmosistestnet");
  
}

main();
