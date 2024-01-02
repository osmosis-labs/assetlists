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
const generatedFolderName = "generated";
const assetlistFileName = "assetlist.json";
const chainlistFileName = "chainlist.json";
const zoneAssetConfigFileName = "zone_asset_config.json";
const zoneAssetlistFileName = "osmosis.zone_assets.json";
const zoneChainlistFileName = "osmosis.zone_chains.json";
const zoneConfigFileName = "osmosis.zone_config.json";


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

function getZoneChainlist(chainName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      zoneChainlistFileName
    )));
  } catch (err) {
    console.log(err);
  }
}

function getZoneConfig(chainName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      zoneConfigFileName
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
      generatedFolderName,
      zoneAssetConfigFileName
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

const generateAssets = async (chainName, assets, zone_assets, zoneConfig) => {
  
  let pool_assets;
  pool_assets = await returnAssets(chainName);
  if (!pool_assets) { return; }
  
  await asyncForEach(zone_assets, async (zone_asset) => {

    let generatedAsset = {};
    
    
    generatedAsset.chain_name = zone_asset.chain_name;
    generatedAsset.base_denom = zone_asset.base_denom;
    generatedAsset.minimal_denom = zone_asset.base_denom;

    //Replace Minimal Denom with IBC Hash Denom (iff appl.)
    if(zone_asset.chain_name != chainName) {
      let ibcHash = calculateIbcHash(zone_asset.path);
      //--Replace Base with IBC Hash--
      generatedAsset.minimal_denom = await ibcHash;
    }

    
    let reference_asset = {};
    if(zone_asset.canonical){
      reference_asset = zone_asset.canonical;
    } else {
      reference_asset = zone_asset;
    }
    generatedAsset.symbol = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "symbol");


    //Get Decimals
    let denom_units = chain_reg.getAssetProperty(zone_asset.chain_name, zone_asset.base_denom, "denom_units");
    let display = chain_reg.getAssetProperty(zone_asset.chain_name, zone_asset.base_denom, "display");
    denom_units.forEach((unit) => {
      if(unit.denom === display) {
        generatedAsset.decimals = unit.exponent;
      }
    });


    generatedAsset.logo_URIs = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "logo_URIs");
    generatedAsset.images = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "images");
    
    
    generatedAsset.coingecko_id = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "coingecko_id");

  
    

    //  OSMOSIS-VERIFIED
    generatedAsset.verified = zone_asset.osmosis_verified;

    //  OSMOSIS-VALIDATED
    generatedAsset.validated = zone_asset.osmosis_validated;


    let denom = generatedAsset.minimal_denom;
    if (pool_assets.get(denom)) {
    
      generatedAsset.api_include = pool_assets.get(denom).osmosis_info;
      
      let price = "";
      price = pool_assets.get(denom).osmosis_price;
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

    generatedAsset.transfer_methods = zone_asset.transfer_methods;
    

    let bridge_provider = "";


    if(zone_asset.chain_name != chainName) {

      //--Set Up Trace for IBC Transfer--
      
      let type = "ibc";
      if (zone_asset.base_denom.slice(0,5) === "cw20:") {
        type = "ibc-cw20";
      }
      
      let counterparty = {
        chain_name: zone_asset.chain_name,
        chain_id: chain_reg.getFileProperty(zone_asset.chain_name, "chain", "chain_id"),
        base_denom: zone_asset.base_denom,
        port: "trans"
      };
      if (type === "ibc-cw20") {
        counterparty.port = "wasm."
      }

      
      let chain = {
        port: "transfer"
      };


      //--Identify chain_1 and chain_2--
      let chain_1 = chain;
      let chain_2 = counterparty;
      let chainOrder = 0;
      if(zone_asset.chain_name < chainName) {
        chain_1 = counterparty;
        chain_2 = chain;
        chainOrder = 1;
      }
      
      
      //--Find IBC Connection--
      let channels = chain_reg.getIBCFileProperty(zone_asset.chain_name, chainName, "channels");
      
      
      //--Find IBC Channel and Port Info--
      
      //--with Path--
      if(zone_asset.path) {
        let parts = zone_asset.path.split("/");
        chain.port = parts[0];
        chain.channel_id = parts[1];
        channels.forEach((channel) => {
          if(!chainOrder) {
            if(channel.chain_1.port_id === chain.port && channel.chain_1.channel_id === chain.channel_id) {
              counterparty.channel_id = channel.chain_2.channel_id;
              counterparty.port = channel.chain_2.port_id;
              return;
            }
          } else {
            if(channel.chain_2.port_id === chain.port && channel.chain_2.channel_id === chain.channel_id) {
              counterparty.channel_id = channel.chain_1.channel_id;
              counterparty.port = channel.chain_1.port_id;
              return;
            }
          }
        });
        
      //--without Path--
      } else {
        channels.forEach((channel) => {
          if(channel.chain_1.port_id.slice(0,5) === chain_1.port.slice(0,5) && channel.chain_2.port_id.slice(0,5) === chain_2.port.slice(0,5)) {
            chain_1.channel_id = channel.chain_1.channel_id;
            chain_2.channel_id = channel.chain_2.channel_id;
            chain_1.port = channel.chain_1.port_id;
            chain_2.port = channel.chain_2.port_id;
            return;
          }
        });
      }
      
      
      //--Add Path--
      chain.path = zone_asset.path;
      
      
      //--Create Trace Object--
      let trace = {
        type: type,
        counterparty: counterparty,
        chain: chain
      }

      if (!generatedAsset.transfer_methods) {
        trace.validated = true;
        generatedAsset.transfer_methods = [];
      }

      generatedAsset.transfer_methods.push(trace);



      //--Get Bridge Provider--
      if(!zone_asset.canonical) {
        traces?.forEach((trace) => {
          if(trace.type == "bridge") {
            bridge_provider = trace.provider;
            let suffixes = zoneConfig?.interoperability?.suffixes;
            if(suffixes) {
              suffixes.forEach((suffix) => {
                if(suffix.provider == bridge_provider) {
                  generatedAsset.symbol = generatedAsset.symbol + suffix.suffix;
                }
              });
            }
            return;
          }
        });
      }



    }


    


    //--Staking token?--
    let is_staking_token = false;
    if(zone_asset.base_denom == chain_reg.getFileProperty(reference_asset.chain_name, "chain", "staking")?.staking_tokens[0]?.denom) {
      is_staking_token = true;
    }


    //--Add Name--

    let name = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "name");

    //use chain name if staking token
    if(is_staking_token) {
      name = chain_reg.getFileProperty(reference_asset.chain_name, "chain", "pretty_name");
    }

    //append bridge provider if not already there
    if(bridge_provider) {
      if(!name.includes(bridge_provider)) {
        name = name + " " + "(" + bridge_provider + ")"
      }
    }

    //submit name
    generatedAsset.name = name;



    //--Add Description--
    let asset_description = chain_reg.getAssetProperty(reference_asset.chain_name, reference_asset.base_denom, "description");
    let description = asset_description ? asset_description : "";
    //need to see if it's first staking token
    if(is_staking_token) {
      //it is a staking token, so we pull the chain_description
      let chain_description = chain_reg.getFileProperty(reference_asset.chain_name, "chain", "description");
      if(chain_description) {
        if(description) {
          description = description + "\n\n";
        }
        description = description + chain_description;
      }
    }
    generatedAsset.description = description;



    //--Sorting--
    //how to sort tokens if they don't have cgid
    if(!generatedAsset.coingecko_id && !zone_asset.canonical){
      traces?.forEach((trace) => {
        if(trace.provider) {
          let providers = zoneConfig?.provider_primary_token;
          if(providers) {
            providers.forEach((provider) => {
              if(provider.provider == trace.provider) {
                generatedAsset.sort_with = {
                  chain_name: provider.token.chain_name,
                  base_denom: provider.token.base_denom
                }
                return;
              }
            });
          }
        }
      });
    }



    //--Overrides Properties when Specified--
    if(zone_asset.override_properties) {
      if(zone_asset.override_properties.coingecko_id) {
        generatedAsset.coingecko_id = zone_asset.override_properties.coingecko_id;
      }
      if(zone_asset.override_properties.symbol) {
        generatedAsset.symbol = zone_asset.override_properties.symbol;
      }
      if(zone_asset.override_properties.name) {
        generatedAsset.name = zone_asset.override_properties.name;
      }
      if(zone_asset.override_properties.logo_URIs) {
        generatedAsset.logo_URIs = zone_asset.override_properties.logo_URIs;
      }
    }


    generatedAsset.unstable = zone_asset.osmosis_unstable;
    
    generatedAsset.unlisted = zone_asset.osmosis_unlisted;

    
    //--Append Asset to Assetlist--
    assets.push(generatedAsset);
    
    //console.log(assets);
  
  });

}

async function generateAssetlist(chainName) {
  
  let zoneConfig = getZoneConfig(chainName)?.config;

  let zoneAssetlist = getZoneAssetlist(chainName);
  //let zoneChainlist = getZoneChainlist(chainName);
  let assets = [];  
  await generateAssets(chainName, assets, zoneAssetlist.assets, zoneConfig);
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
