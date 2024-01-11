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

let zoneConfig;

//This defines with types of traces are considered essentially the same asset
const find_origin_trace_types = [
  "ibc",
  "ibc-cw20",
  "bridge",
  "wrapped",
  "additional-mintage"
];

//This address corresponds to the native assset on all evm chains (e.g., wei on ethereum)
const zero_address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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

//create related assets map {asset} -> [{{asset},#distance}]
let relatedAssets = new Map();


function getMostRecentNonIBCTrace(asset) {
  //console.log(asset);
  let traces = chain_reg.getAssetTraces(asset.chain_name, asset.base_denom);
  //console.log(traces);
  
  if(!traces) {
    return;
  }

  for (let i = traces.length - 1; i >= 0; i--) {
    if(traces[i].type != "ibc") {
      return traces[i];
    }
  }

  return;
}


function addRelative(asset1, asset2, d) {
  
  //cancel if they are the same
  if(asset1.chain_name == asset2.chain_name && asset1.base_denom == asset2.base_denom) {
    return;
  }

  let assetKey1 = asset1.chain_name + "." + asset1.base_denom;
  let assetKey2 = asset2.chain_name + "." + asset2.base_denom;

  //add relative to asset1, or at least lower the distance
  let included = 0;
  let relatives = relatedAssets.get(assetKey1);
  relatives.forEach((relative) => {
    if(relative.asset.chain_name == asset2.chain_name && relative.asset.base_denom == asset2.base_denom) {
      included = 1;
      if(d < relative.d) {
        relative.d = d;
      } 
      return;
    }
  });
  if(!included) {
    let newRelative = {
      asset: {
        chain_name: asset2.chain_name,
        base_denom: asset2.base_denom
      },
      d: d
    };
    relatedAssets.get(assetKey1).push(newRelative);
  }
  

  //add relative to asset2, or at least lower the distance
  included = 0;
  relatives = relatedAssets.get(assetKey2);
  relatives.forEach((relative) => {
    if(relative.asset.chain_name == asset1.chain_name && relative.asset.base_denom == asset1.base_denom) {
      included = 1;
      if(d < relative.d) {
        relative.d = d;
      } 
      return;
    }
  });
  if(!included) {
    let newRelative = {
      asset: {
        chain_name: asset1.chain_name,
        base_denom: asset1.base_denom
      },
      d: d
    };
    relatedAssets.get(assetKey2).push(newRelative);
  }


}


function addRelativeDeep(asset1, asset2, d) {

  //cancel if they are the same
  if(asset1.chain_name == asset2.chain_name && asset1.base_denom == asset2.base_denom) {
    return;
  }

  let assetKey1 = asset1.chain_name + "." + asset1.base_denom;
  let assetKey2 = asset2.chain_name + "." + asset2.base_denom;

  
  //first investigate the assets if they haven't been added yet
  if(!relatedAssets.has(assetKey1)) {
    getRelatedAssets(asset1);
  }
  if(!relatedAssets.has(assetKey2)) {
    getRelatedAssets(asset2);
  }
  
  //nested for loop to make sure each relative gets added to each other relative
  relatedAssets.get(assetKey1).forEach((rel1) => {
    relatedAssets.get(assetKey2).forEach((rel2) => {
      addRelative(rel1.asset, rel2.asset, rel1.d + rel2.d + d)
    });
    addRelative(rel1.asset, asset2, rel1.d + d)
  });
  relatedAssets.get(assetKey2).forEach((rel2) => {
    addRelative(rel2.asset, asset1, rel2.d + d)
  });
    
  addRelative(asset1, asset2, d);

}


//define related asset distances
let distanceMap = new Map();

// Add entries to the map
distanceMap.set('chainStaking', 4);
distanceMap.set('provider', 7);
distanceMap.set('wrapped', 1);
distanceMap.set('bridge', 2);
distanceMap.set('liquid-stake', 5);
distanceMap.set('additional-mintage', 1);

// Function to get distance with a default value
function getDistance(relationship) {
  // Use the Map.get() method with a default value (e.g., 0)
  return distanceMap.get(relationship) || 2;
}


function getRelatedAssets(asset) {

  //define related asset distances
  const traceDistance = 1;
  const traceProviderDistance = 15;
  const chainStakingDistance = 10;


  let assetKey = asset.chain_name + "." + asset.base_denom;

  //skip if already in map
  if(relatedAssets.has(assetKey)) {
    return;
  }

  //add to map with zero relationships
  relatedAssets.set(assetKey, []);
  
  //get origin chain staking asset
  let chainStaking = chain_reg.getFileProperty(asset.chain_name, "chain", "staking");
  if(chainStaking && chainStaking.staking_tokens?.[0]?.denom) {
    let chainStakingAsset = {
      chain_name: asset.chain_name,
      base_denom: chainStaking.staking_tokens?.[0]?.denom
    }
    //add each asset and their relatives to eachother
    addRelativeDeep(asset, chainStakingAsset, getDistance("chainStaking"));
  }

  //iterate back through traces to find the next valid trace
  let trace = getMostRecentNonIBCTrace(asset);

  //skip if no traces
  if(!trace) {
    return;
  }

  //identify trace asset
  let traceAsset = {
    chain_name: trace.counterparty.chain_name,
    base_denom: trace.counterparty.base_denom
  };

  //add each asset and their relatives to eachother
  addRelativeDeep(asset, traceAsset, getDistance(trace.type));

  //get relationships for provider token
  let traceProviderAsset;
  if(trace.provider && zoneConfig?.providers) {
    zoneConfig.providers.forEach((provider) => {
      if(provider.provider == trace.provider && provider.token) {

        //identify trace provider asset
        traceProviderAsset = {
          chain_name: provider.token.chain_name,
          base_denom: provider.token.base_denom
        };

        //add each asset and their relatives to eachother
        addRelativeDeep(asset, traceProviderAsset, getDistance("provider"));
        return;
      }
    });
  }

}


function getAllRelatedAssets(assets) {

  let filterTop_n_Relatives = 10;

  //iterate assets
  assets.forEach((asset) => {

    //define asset object
    let assetPointer = {
      chain_name: asset.chain_name,
      base_denom: asset.base_denom
    }

    //get related assets for the current asset
    getRelatedAssets(assetPointer);

  });

  //sort and filter the relatives
  relatedAssets.forEach((value, key) => {

    //sort the relatives
    let sortedRelatives = [...value].sort((a, b) => a.d - b.d);

    //filter the relatives by whether they are among zone assets
    let filteredRelativesAmongZoneAssets = sortedRelatives.filter(relative =>
      assets.some(asset =>
        asset.chain_name === relative.asset.chain_name && asset.base_denom === relative.asset.base_denom
      )
    );

    //filter the relatives to top 10 or so
    let filteredRelativesTopN = filteredRelativesAmongZoneAssets.slice(0, filterTop_n_Relatives);
    relatedAssets.set(key, filteredRelativesTopN);

    // Display
    console.log("Relatives for", key);
    console.log(filteredRelativesTopN);

  });

}


const generateAssets = async (chainName, assets, zone_assets, zoneConfig) => {

  //getRelatedAssets(zone_assets);

  let pool_assets;
  //pool_assets = await returnAssets(chainName);
  //if (!pool_assets) { return; }
  
  await asyncForEach(zone_assets, async (zone_asset) => {


    //--Create the Generated Asset Object--
    //  this will go into zone_asset_config
    let generatedAsset = {};
    

    
    //--Identity (Chain Registry Pointer)--
    generatedAsset.chain_name = zone_asset.chain_name;
    generatedAsset.base_denom = zone_asset.base_denom;



    //--Get Origin Asset Object from Chain Registry--
    let origin_asset = chain_reg.getAssetObject(zone_asset.chain_name, zone_asset.base_denom);



    //--Get Local Asset Object from Chain Registry--
    //--Local Base Denom (Denomination of the Asset when on the local chain)
    //---e.g., OSMO on Osmosis -> uosmo
    //---e.g., ATOM os Osmosis -> ibc/...
    let local_asset;
    if(zone_asset.chain_name != chainName) {
      let ibcHash = calculateIbcHash(zone_asset.path);    //Calc IBC Hash Denom
      generatedAsset.local_base_denom = await ibcHash;    //Set IBC Hash Denom
      local_asset = chain_reg.getAssetObject(chainName, ibcHash);
    } else {
      generatedAsset.local_base_denom = zone_asset.base_denom;
    }
    let asset = local_asset ? local_asset : origin_asset;


    
    //--Get Canonical Asset from Chain Registry--
    //  used to override certain properties if this local variant is
    //  the canonical representation of a foreign asset
    let canonical_origin_asset = origin_asset;
    let canonical_origin_chain_name = zone_asset.chain_name;
    if(zone_asset.canonical) {
      canonical_origin_chain_name = zone_asset.canonical.chain_name;
      canonical_origin_asset = chain_reg.getAssetObject(zone_asset.canonical.chain_name, zone_asset.canonical.base_denom);
    }



    //--Set Reference Asset--
    //  used to refer to what the asset represents, and allows for
    //  potential overrides defined in the local chain's assetlist
    let reference_asset = asset;
    if(!local_asset && canonical_origin_asset) {
      reference_asset = canonical_origin_asset;
    }



    //--Get Symbol
    generatedAsset.symbol = reference_asset.symbol;



    //--Get Decimals--
    asset.denom_units.forEach((unit) => {
      if(unit.denom === asset.display) {
        generatedAsset.decimals = unit.exponent;
      }
    });



    //--Get Logos--
    generatedAsset.logo_URIs = reference_asset.logo_URIs;
    generatedAsset.images = reference_asset.images;
    


    //--Get CGID--
    generatedAsset.coingecko_id = canonical_origin_asset.coingecko_id;
  
    

    //--Get Verified Status--
    generatedAsset.verified = zone_asset.osmosis_verified;



    //--Get Best Pricing Reference Pool--
    let denom = generatedAsset.local_base_denom;
    if (pool_assets?.get(denom)) {
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
    


    //--Get Categories--
    let categories = [];
    if(zone_asset.categories) {
      categories = zone_asset.categories;
    }
    if(zone_asset.peg_mechanism && !categories.includes("stablecoin")) {
      categories.push("stablecoin");
    }
    let traces = chain_reg.getAssetTraces(zone_asset.chain_name, zone_asset.base_denom);
    traces?.forEach((trace) => {
      if(trace.type == "liquid-stake") {
        categories.push("liquid_staking");
      }
    });
    generatedAsset.categories = categories.length > 0 ? categories : undefined;
    


    //--Get Peg Mechanism--
    generatedAsset.peg_mechanism = zone_asset.peg_mechanism;







    //--Process Transfer Methods--
    generatedAsset.transfer_methods = zone_asset.transfer_methods;



    let bridge_provider = "";



    if(zone_asset.chain_name != chainName) {

      if(!traces) {
        traces = [];
      }

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

      traces.push(trace);

      if (!generatedAsset.transfer_methods) {
        //trace.validated = true;
        generatedAsset.transfer_methods = [];
      }

      let ibc_transfer_method = {
        name: "Osmosis IBC Transfer",
        type: "ibc",
        counterparty: {
          chain_name: zone_asset.chain_name,
          base_denom: zone_asset.base_denom,
          port: trace.counterparty.port,
          channel_id: trace.counterparty.channel_id
        },
        chain: {
          port: trace.chain.port,
          channel_id: trace.chain.channel_id,
          path: zone_asset.path
        }
      }
      generatedAsset.transfer_methods.push(ibc_transfer_method);
      //generatedAsset.transfer_methods.push(trace);



      //--Get Bridge Provider--
      if(!zone_asset.canonical) {
        traces?.forEach((trace) => {
          if(trace.type == "bridge") {
            bridge_provider = trace.provider;
            let providers = zoneConfig?.providers;
            if(providers) {
              providers.forEach((provider) => {
                if(provider.provider == bridge_provider && provider.suffix) {
                  generatedAsset.symbol = generatedAsset.symbol + provider.suffix;
                }
              });
            }
            return;
          }
        });
      }


    }


    //--Identify What the Token Represents--
    if(traces) {

      let last_trace = "";
      let bridge_uses = 0;
      //iterate each trace, starting from the bottom
      for (let i = traces.length - 1; i >= 0; i--) {
        if(!find_origin_trace_types.includes(traces[i].type)) {
          break;
        } else if (traces[i].type == "bridge" && bridge_uses) {
          break;
        } else {
          if(!generatedAsset.counterparty) {
            generatedAsset.counterparty = [];
          }
          last_trace = traces[i];
          let counterparty = {
            chain_name: last_trace.counterparty.chain_name,
            base_denom: last_trace.counterparty.base_denom
          };
          if(last_trace.type == "bridge") {
            bridge_uses += 1;
          }
          let comsos_chain_id = chain_reg.getFileProperty(last_trace.counterparty.chain_name, "chain", "chain_id")
          if(comsos_chain_id) {
            counterparty.chain_type = "cosmos";
            counterparty.chain_id = comsos_chain_id;
          } else {
            zoneConfig?.evm_chains?.forEach((evm_chain) => {
              if(evm_chain.chain_name == last_trace.counterparty.chain_name) {
                counterparty.chain_type = "evm";
                counterparty.chain_id = evm_chain.chain_id;
                counterparty.address = chain_reg.getAssetProperty(
                  last_trace.counterparty.chain_name,
                  last_trace.counterparty.base_denom,
                  "address"
                );
                if(!counterparty.address) {
                  counterparty.address = zero_address;
                }
                return;
              }
            });
            if(!last_trace.counterparty.chain_type) {
              counterparty.chain_type = "non-cosmos"
            }
          }
          counterparty.symbol = chain_reg.getAssetProperty(
            last_trace.counterparty.chain_name,
            last_trace.counterparty.base_denom,
            "symbol"
          );
          let display = chain_reg.getAssetProperty(last_trace.counterparty.chain_name, last_trace.counterparty.base_denom, "display");
          let denom_units = chain_reg.getAssetProperty(last_trace.counterparty.chain_name, last_trace.counterparty.base_denom, "denom_units");
          denom_units.forEach((unit) => {
            if(unit.denom == display) {
              counterparty.decimals = unit.exponent;
              return;
            }
          });
          counterparty.logo_URIs = chain_reg.getAssetProperty(
            last_trace.counterparty.chain_name,
            last_trace.counterparty.base_denom,
            "logo_URIs"
          );
          generatedAsset.counterparty.push(counterparty);
        }
      }
      if(last_trace) {
        generatedAsset.common_key = chain_reg.getAssetProperty(
          last_trace.counterparty.chain_name,
          last_trace.counterparty.base_denom,
          "symbol"
        );
      }
    }

    


    //--Staking token?--
    //  used to get name and description
    let is_staking_token = false;
    if(zone_asset.base_denom == chain_reg.getFileProperty(canonical_origin_chain_name, "chain", "staking")?.staking_tokens[0]?.denom) {
      is_staking_token = true;
    }



    //--Add Name--
    //  default to reference asset's name...
    //  default to reference asset's name...
    let name = reference_asset.name;

    //  but use chain name instead if it's the staking token...
    if(is_staking_token) {
      name = chain_reg.getFileProperty(canonical_origin_chain_name, "chain", "pretty_name");
    }

    // and append bridge provider if it's not already there
    if(bridge_provider) {
      if(!name.includes(bridge_provider)) {
        name = name + " " + "(" + bridge_provider + ")"
      }
    }

    //  submit
    generatedAsset.name = name;



    //--Add Description--
    let asset_description = reference_asset.description;
    let description = asset_description ? asset_description : "";
    //need to see if it's first staking token
    if(is_staking_token) {
      //it is a staking token, so we pull the chain_description
      let chain_description = chain_reg.getFileProperty(canonical_origin_chain_name, "chain", "description");
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
          let providers = zoneConfig?.providers;
          if(providers) {
            providers.forEach((provider) => {
              if(provider.provider == trace.provider && provider.token) {
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



    //--Add Flags--
    generatedAsset.unstable = zone_asset.osmosis_unstable;
    generatedAsset.unlisted = zone_asset.osmosis_unlisted;


    
    //--Append Asset to Assetlist--
    assets.push(generatedAsset);
    
  
  });

}

async function generateAssetlist(chainName) {
  
  zoneConfig = getZoneConfig(chainName)?.config;

  let zoneAssetlist = getZoneAssetlist(chainName);
  let assets = [];  
  await generateAssets(chainName, assets, zoneAssetlist.assets);
  if (!assets) { return; }
  
  await getAllRelatedAssets(assets);

  let assetlist = {
    chain_name: chainName,
    assets: assets
  }
  
  writeToFile(assetlist, chainName);

}

async function main() {
  
  await generateAssetlist("osmosis");
  //await generateAssetlist("osmosistestnet4");
  //await generateAssetlist("osmosistestnet");
  
}

main();
