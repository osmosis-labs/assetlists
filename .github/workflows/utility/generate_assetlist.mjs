// Purpose:
//   to generate the assetlist json using the zone json and chain registry data


// -- THE PLAN --
//
// read zone list from osmosis.zone.json
// add assets to zone array
// for each asset in zone array, identify the chain and base (this is primary key)
//   with chain, find matching chain folder in chain registry
//   within the chain folder,
//     pull asset details from the chain's assetlist,
//   get ibc connection details,
//     figure out which chain name comes first alphabetically
//   generate asset object differently if ibc:
//     with an extra trace for the ibc transfer, and
//     the base becomes the ibc hash, and
//     the first denom becomes the ibc hash, and the original base becomes an alias
// write assetlist array to file osmosis-1.assetlist.json


import * as fs from 'fs';
import * as path from 'path';
import * as chain_reg from './chain_registry.mjs';
import { returnAssets } from './getPools.mjs';


const chainNameToChainIdMap = new Map([
  ["osmosis", "osmosis-1"],
  ["osmosistestnet", "osmo-test-4"],
  ["osmosistestnet5", "osmo-test-5"]
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
      chainNameToChainIdMap.get(chainName) +'.assetlist.json'
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
    Object.keys(chain_reg.assetSchema).forEach((assetProperty) => {
      let assetPropertyValue;
      if (assetProperty == "description" ||
        assetProperty == "name" ||
        assetProperty == "symbol" ||
        assetProperty == "logo_URIs" ||
        assetProperty == "images"
      ) {
        assetPropertyValue = chain_reg.getAssetPropertyWithTrace(zone_asset.chain_name, zone_asset.base_denom, assetProperty);
      } else if (assetProperty == "traces") {
        assetPropertyValue = chain_reg.getAssetTraces(zone_asset.chain_name, zone_asset.base_denom);
      } else if (assetProperty == "type_asset") {
        if(zone_asset.chain_name != chainName) {
          assetPropertyValue = "ics20";
        }
      } else {
        assetPropertyValue = chain_reg.getAssetProperty(zone_asset.chain_name, zone_asset.base_denom, assetProperty);
      }
      if (assetPropertyValue) {
        if (assetProperty == "logo_URIs") {
          generatedAsset[assetProperty] = {};
          if (assetPropertyValue.png) {
            generatedAsset[assetProperty].png = assetPropertyValue.png;
          }
          if (assetPropertyValue.svg) {
            generatedAsset[assetProperty].svg = assetPropertyValue.svg;
          }
        } else {
          generatedAsset[assetProperty] = assetPropertyValue;
        }
      } else {
        if (assetProperty == "traces") {
          generatedAsset.traces = [];
        }        
      }
    });

    if(zone_asset.chain_name != chainName) {

      //--Set Up Trace for IBC Transfer--
      
      let type = "ibc";
      if (zone_asset.base_denom.slice(0,5) === "cw20:") {
        type = "ibc-cw20";
      }
      
      let counterparty = {
        chain_name: zone_asset.chain_name,
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
      let traces = [];
      if(generatedAsset.traces.length > 0) {
        traces = generatedAsset.traces;
        if(traces[traces.length - 1].type === "ibc" || traces[traces.length - 1].type === "ibc-cw20") {
          if(traces[traces.length - 1].chain.path) {
            chain.path = chain.port + "/" + chain.channel_id + "/" + traces[traces.length - 1].chain.path;
          } else {
            console.log(zone_asset.base_denom + "Missing Path");
          }
        }
      }
      if (!chain.path) {
        if (zone_asset.base_denom.slice(0,7) === "factory") {
          let baseReplacement = zone_asset.base_denom.replace(/\//g,":");
          chain.path = chain.port + "/" + chain.channel_id + "/" + baseReplacement;
        } else {
          chain.path = chain.port + "/" + chain.channel_id + "/" + zone_asset.base_denom;
        }
      }
      
      
      //--Create Trace Object--
      let trace = {
        type: type,
        counterparty: counterparty,
        chain: chain
      };
      
      
      //--Cleanup Trace--
      if(type === "ibc") {
        delete trace.chain.port;
        delete trace.counterparty.port;
      }
      
      //--Append Latest Trace to Traces--
      traces.push(trace);
      generatedAsset.traces = traces;
      
      
      //--Get IBC Hash--
      let ibcHash = calculateIbcHash(traces[traces.length -1].chain.path);
      
      
      //--Replace Base with IBC Hash--
      generatedAsset.base = await ibcHash;
      generatedAsset.denom_units.forEach(async function(unit) {
        if(unit.denom === zone_asset.base_denom) {
          if(!unit.aliases) {
            unit.aliases = [];
          }
          unit.aliases.push(zone_asset.base_denom);
          unit.denom = generatedAsset.base;
        }
      });
      

    }
    
    
  
    //--Overrides Properties when Specified--
    if(zone_asset.override_properties) {
      if(zone_asset.override_properties.symbol) {
        generatedAsset.symbol = zone_asset.override_properties.symbol;
      }
      if(zone_asset.override_properties.logo_URIs) {
        generatedAsset.logo_URIs = zone_asset.override_properties.logo_URIs;
      }
      if(zone_asset.override_properties.coingecko_id) {
        generatedAsset.coingecko_id = zone_asset.override_properties.coingecko_id;
      }
    }
    
    //--Add Keywords--
    let keywords = [];
    if(generatedAsset.keywords) {
      keywords = generatedAsset.keywords;
    }
    if(zone_asset.osmosis_main) {
      keywords.push("osmosis-main");
    }
    if(zone_asset.osmosis_frontier) {
      keywords.push("osmosis-frontier");
    }
    if (pool_assets.get(generatedAsset.base)) {
      if(pool_assets.get(generatedAsset.base).osmosis_info) {
        keywords.push("osmosis-info");
      }
      if(pool_assets.get(generatedAsset.base).osmosis_price) {
        keywords.push(pool_assets.get(generatedAsset.base).osmosis_price);
      }
    }
    
    if(keywords.length > 0) {
      generatedAsset.keywords = keywords;
    }
    
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
  //await generateAssetlist("osmosistestnet");
  await generateAssetlist("osmosistestnet5");
  
}

main();
