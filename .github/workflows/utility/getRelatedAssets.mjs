//Purpose:
// to identify the related Assets of each asset in an assetlist



//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();





//-- Global Constants --

//create related assets map {asset} -> [{{asset},#distance}]
let relatedAssets = new Map();

let zoneConfig;





//-- Functions --

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


export function getAllRelatedAssets(assets, zone_config) {

  let filterTop_n_Relatives = 10;
  zoneConfig = zone_config;

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
    
    asset.relatedAssets = relatedAssets.get(assetKey);
    asset.relatedAssets?.forEach((relatedAsset) => {
      relatedAsset.chainName    = relatedAsset.chain_name || undefined;
      delete                      relatedAsset.chain_name;
      relatedAsset.sourceDenom  = relatedAsset.base_denom || undefined;
      delete                      relatedAsset.base_denom;
    });

  });

  return assets;

}