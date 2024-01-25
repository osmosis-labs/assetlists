// Purpose:
//   to generate the zone_config json using the zone json and chain registry data


//-- Imports --

import * as chain_reg from './chain_registry.mjs';
import * as zone from './assetlist_functions.mjs';
import { returnAssets } from './getPools.mjs';




//-- Global Constants --

let zoneConfig;

//This address corresponds to the native assset on all evm chains (e.g., wei on ethereum)
const zero_address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

//This defines with types of traces are considered essentially the same asset
const find_origin_trace_types = [
  "ibc",
  "ibc-cw20",
  "bridge",
  "wrapped",
  "additional-mintage"
];

//create related assets map {asset} -> [{{asset},#distance}]
let relatedAssets = new Map();






//-- Functions --


async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}



function getMostRecentNonIBCTrace(asset) {

  let traces = chain_reg.getAssetTraces(asset.chain_name, asset.base_denom);
  
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
  
  if(!asset1 || !asset2) {
    return;
  }

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
    if(relative.asset?.chain_name == asset2.chain_name && relative.asset?.base_denom == asset2.base_denom) {
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
    if(relative.asset?.chain_name == asset1.chain_name && relative.asset?.base_denom == asset1.base_denom) {
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
distanceMap.set('provider', 11);
distanceMap.set('wrapped', 1);
distanceMap.set('bridge', 2);
distanceMap.set('liquid-stake', 4);
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
        asset.chain_name === relative.asset?.chain_name && asset.base_denom === relative.asset?.base_denom
      )
    );

    //filter the relatives to top 10 or so
    let filteredRelativesTopN = filteredRelativesAmongZoneAssets.slice(0, filterTop_n_Relatives);
    relatedAssets.set(key, filteredRelativesTopN);

    // Display with distance
    //console.log("Relatives for", key);
    //console.log(filteredRelativesTopN);

    //remove distance
    let relativesArray = [];
    filteredRelativesTopN.forEach((relative) => {
      let relativePointer = {
        chain_name: relative.asset.chain_name,
        base_denom: relative.asset.base_denom
      }
      relativesArray.push(relativePointer);
    });
    relatedAssets.set(key, relativesArray);

    // Display
    //console.log("Relatives for", key);
    //console.log(relativesArray);

  });

  assets.forEach((asset) => {

    //define asset object
    let assetKey = asset.chain_name + "." + asset.base_denom;
    
    asset.related_assets = relatedAssets.get(assetKey);

  });

  return assets;

}


const generateAssets = async (chainName, zone_assets, zone_config_assets, chain_reg_assets) => {

  let pool_assets;
  pool_assets = await returnAssets(chainName);
  if (!pool_assets) { return; }
  
  await asyncForEach(zone_assets, async (zone_asset) => {


    //--Create the Generated Asset Objects--
    //  this will go into zone_asset_config
    let generated_zoneConfigAsset = {};
    //  this will go into [chain_reg] assetlist
    let generated_chainRegAsset = {};
    

    
    //--Identity (Chain Registry Pointer)--
    generated_zoneConfigAsset.chain_name = zone_asset.chain_name;
    generated_zoneConfigAsset.base_denom = zone_asset.base_denom;
    //--sourceDenom--
    generated_zoneConfigAsset.sourceDenom = zone_asset.base_denom;


    //--Get Origin Asset Object from Chain Registry--
    let origin_asset = chain_reg.getAssetObject(zone_asset.chain_name, zone_asset.base_denom);



    //--Get Local Asset Object from Chain Registry--
    //--coinMinimalDenom (Denomination of the Asset when on the local chain)
    //---e.g., OSMO on Osmosis -> uosmo
    //---e.g., ATOM os Osmosis -> ibc/...
    let local_asset;
    if(zone_asset.chain_name != chainName) {
      let ibcHash = zone.calculateIbcHash(zone_asset.path);    //Calc IBC Hash Denom
      generated_zoneConfigAsset.coinMinimalDenom = await ibcHash;    //Set IBC Hash Denom
      local_asset = chain_reg.getAssetObject(chainName, ibcHash);
    } else {
      generated_zoneConfigAsset.coinMinimalDenom = zone_asset.base_denom;
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
    generated_zoneConfigAsset.symbol = reference_asset.symbol;



    //--Get Decimals--
    asset.denom_units.forEach((unit) => {
      if(unit.denom === asset.display) {
        generated_zoneConfigAsset.decimals = unit.exponent;
      }
    });



    //--Get Logos--
    generated_zoneConfigAsset.logo_URIs = reference_asset.logo_URIs;
    let images = reference_asset.images;
    


    //--Get CGID--
    generated_zoneConfigAsset.coingecko_id = canonical_origin_asset.coingecko_id;
  
    

    //--Get Verified Status--
    generated_zoneConfigAsset.verified = zone_asset.osmosis_verified;



    //--Get Best Pricing Reference Pool--
    let denom = generated_zoneConfigAsset.coinMinimalDenom;
    if (pool_assets?.get(denom)) {
      generated_zoneConfigAsset.api_include = pool_assets.get(denom).osmosis_info;
      let price = "";
      price = pool_assets.get(denom).osmosis_price;
      if(price) {
        let price_parts = price.split(':');
        generated_zoneConfigAsset.price = {
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
    generated_zoneConfigAsset.categories = categories.length > 0 ? categories : undefined;
    


    //--Get Peg Mechanism--
    generated_zoneConfigAsset.peg_mechanism = zone_asset.peg_mechanism;




    //--Process Transfer Methods--
    generated_zoneConfigAsset.transfer_methods = zone_asset.transfer_methods;



    let bridge_provider = "";



    if(zone_asset.chain_name != chainName) {

      if (!traces) {
        traces = [];
      }

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
      if(traces.length > 0) {
        if(traces[traces.length - 1].type === "ibc" || traces[traces.length - 1].type === "ibc-cw20") {
          if(traces[traces.length - 1].chain.path) {
            chain.path = chain.port + "/" + chain.channel_id + "/" + traces[traces.length - 1].chain.path;
          } else {
            console.log(zone_asset.base_denom + "Missing Path");
          }
        }
      }
      if (!chain.path) {
        if (zone_asset.base_denom.slice(0,7) === "factory" && zone_asset.chain_name === "kujira") {
          let baseReplacement = zone_asset.base_denom.replace(/\//g,":");
          chain.path = chain.port + "/" + chain.channel_id + "/" + baseReplacement;
        } else {
          chain.path = chain.port + "/" + chain.channel_id + "/" + zone_asset.base_denom;
        }
      }

      //--Double Check Path--
      if (chain.path != zone_asset.path) {
        console.log("Warning! Provided trace path does not match generated path.");
        console.log(zone_asset);
      }
      
      
      //--Create Trace Object--
      let trace = {
        type: type,
        counterparty: counterparty,
        chain: chain
      }


      if (!generated_zoneConfigAsset.transfer_methods) {
        //trace.validated = true;
        generated_zoneConfigAsset.transfer_methods = [];
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
      generated_zoneConfigAsset.transfer_methods.push(ibc_transfer_method);
      //generated_zoneConfigAsset.transfer_methods.push(trace);



      //--Cleanup Trace--
      if(type === "ibc") {
        delete trace.chain.port;
        delete trace.counterparty.port;
      }

      traces.push(trace);



      //--Get Bridge Provider--
      if(!zone_asset.canonical) {
        traces?.forEach((trace) => {
          if(trace.type == "bridge") {
            bridge_provider = trace.provider;
            let providers = zoneConfig?.providers;
            if(providers) {
              providers.forEach((provider) => {
                if(provider.provider == bridge_provider && provider.suffix) {
                  generated_zoneConfigAsset.symbol = generated_zoneConfigAsset.symbol + provider.suffix;
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
          if(!generated_zoneConfigAsset.counterparty) {
            generated_zoneConfigAsset.counterparty = [];
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
          generated_zoneConfigAsset.counterparty.push(counterparty);
        }
      }
      if(last_trace) {
        generated_zoneConfigAsset.common_key = chain_reg.getAssetProperty(
          last_trace.counterparty.chain_name,
          last_trace.counterparty.base_denom,
          "symbol"
        );
      }
    }


    let denom_units = chain_reg.getAssetProperty(zone_asset.chain_name, zone_asset.base_denom, "denom_units");
    if (zone_asset.chain_name != chainName) {
      denom_units.forEach(async function(unit) {
        if(unit.denom === zone_asset.base_denom) {
          if(!unit.aliases) {
            unit.aliases = [];
          }
          unit.aliases.push(unit.denom);
          unit.denom = generated_zoneConfigAsset.coinMinimalDenom;
          return;
        }
      });
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
    generated_zoneConfigAsset.name = name;



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
    generated_zoneConfigAsset.description = description;



    //--Get Twitter URL--
    generated_zoneConfigAsset.twitter_URL = zone_asset.twitter_URL;



    //--Sorting--
    //how to sort tokens if they don't have cgid
    if(!generated_zoneConfigAsset.coingecko_id && !zone_asset.canonical){
      traces?.forEach((trace) => {
        if(trace.provider) {
          let providers = zoneConfig?.providers;
          if(providers) {
            providers.forEach((provider) => {
              if(provider.provider == trace.provider && provider.token) {
                generated_zoneConfigAsset.sort_with = {
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
        generated_zoneConfigAsset.coingecko_id = zone_asset.override_properties.coingecko_id;
      }
      if(zone_asset.override_properties.symbol) {
        generated_zoneConfigAsset.symbol = zone_asset.override_properties.symbol;
      }
      if(zone_asset.override_properties.name) {
        generated_zoneConfigAsset.name = zone_asset.override_properties.name;
      }
      if(zone_asset.override_properties.logo_URIs) {
        generated_zoneConfigAsset.logo_URIs = zone_asset.override_properties.logo_URIs;
      }
    }


    //--Finalize Images--
    let match = 0;
    images.forEach((image) => {
      if (
        (
          !generated_zoneConfigAsset.logo_URIs.png ||
          generated_zoneConfigAsset.logo_URIs.png == image.png
        ) &&
        (
          !generated_zoneConfigAsset.logo_URIs.svg ||
          generated_zoneConfigAsset.logo_URIs.svg == image.svg
        )
      ) {
        match = 1;
        return;
      }
    });
    if (!match) {
      let new_image = {
        png: generated_zoneConfigAsset.logo_URIs.png,
        svg: generated_zoneConfigAsset.logo_URIs.svg
      }
      images.push(new_image);
    }




    //--Add Flags--
    generated_zoneConfigAsset.unstable = zone_asset.osmosis_unstable;
    generated_zoneConfigAsset.unlisted = zone_asset.osmosis_unlisted;

    
    
    //--Get Keywords--
    let keywords = asset.keywords ? asset.keywords : [];
    //--Update Keywords--
    if(zone_asset.osmosis_unstable) {
      keywords.push("osmosis_unstable");
    }
    if(zone_asset.osmosis_unlisted) {
      keywords.push("osmosis_unlisted");
    }
    if(zone_asset.verified) {
      keywords.push("osmosis_verified");
    }
    if(!keywords.length) {
      keywords = undefined;
    }



    //--Get type_asset--
    let type_asset = "ics20";
    if (zone_asset.chain_name == chainName) {
      type_asset = chain_reg.getAssetProperty(zone_asset.chain_name, zone_asset.base_denom, "type_asset");
      if (!type_asset) {
        type_asset = "sdk.coin";
      }
    }


    
    //--Append Asset to Assetlist--
    zone_config_assets.push(generated_zoneConfigAsset);


    //--Setup Chain_Reg Asset--
    generated_chainRegAsset = {
      description: asset_description,
      denom_units: denom_units,
      type_asset: type_asset,
      base: generated_zoneConfigAsset.coinMinimalDenom,
      name: generated_zoneConfigAsset.name,
      display: asset.display,
      symbol: generated_zoneConfigAsset.symbol,
      traces: traces,
      logo_URIs: generated_zoneConfigAsset.logo_URIs,
      images: images,
      coingecko_id: generated_zoneConfigAsset.coingecko_id,
      keywords: keywords
    }
    //--Append to Chain_Reg Assetlist--
    chain_reg_assets.push(generated_chainRegAsset);
    
  
  });

}

async function generateAssetlist(chainName) {
  zoneConfig = zone.readFromFile(chainName, zone.noDir, zone.zoneConfigFileName)?.config;
  let zoneAssetlist = zone.readFromFile(chainName, zone.noDir, zone.zoneAssetlistFileName)?.assets;
  let zone_config_assets = [];
  let chain_reg_assets = [];
  await generateAssets(chainName, zoneAssetlist, zone_config_assets, chain_reg_assets);
  if (!zone_config_assets) { return; }
  zone_config_assets = await getAllRelatedAssets(zone_config_assets);
  let zone_config_assetlist = {
    chain_name: chainName,
    assets: zone_config_assets
  }
  let chain_reg_assetlist = {
    chain_name: chainName,
    assets: chain_reg_assets
  }
  zone.writeToFile(chainName, zone.chainRegAssetlist, zone.assetlistFileName, zone_config_assetlist);
  zone.writeToFile(chainName, zone.zoneConfigAssetlist, zone.assetlistFileName, chain_reg_assetlist);
}


async function generateAssetlists() {
  for (const chainName of zone.chainNames) {
    await generateAssetlist(chainName);
  }
}


function main() {
  generateAssetlists();
}


main();
