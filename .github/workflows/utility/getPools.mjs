//Purpose:
// to identify the pools and liquidity of an asset. To price it and determine whether it goes on info site
//
// STATUS: Currently DISABLED (as of Dec 2024)
// - The getPools flag in generate_assetlist.mjs is set to false
// - Pool pricing functionality is not being used in assetlist generation
// - This code is preserved for potential future re-implementation
// - Previously required manual pool data updates via Query Pools workflow (now removed)
//
// NOTE: queryApi.mjs was removed as part of cleanup (Dec 2024)
// - If re-enabling this module, queryApi functionality will need to be restored
// - queryApi provided: queryAPI() for fetching pool data, readQueryResponse() for reading cached responses
// - Consider reimplementing these functions directly in this file or restoring queryApi.mjs



//-- Imports --

import * as fs from 'fs';
import fetch from 'node-fetch';
// import * as queryApi from './queryApi.mjs'; // Removed - restore if re-enabling this module
import * as zone from './assetlist_functions.mjs';






//-- Globals --

const poolsFileName = "all-pools.json";

let pools = new Map();
export let assets = new Map();
let usd, osmo, atom;
let base_pairs = [usd, osmo, atom];
const num_max_hops = 7;
const num_largest_pools = 5;

let ticks = 0;





//-- Functions --

function get_base_url(domain) {
  let baseUrl;
  if (domain == "osmosis") {
    return 'https://lcd.osmosis.zone/osmosis/poolmanager/v1beta1/all-pools';
  } else if (domain == "osmosistestnet4") {
    return 'https://lcd.testnet4.osmosis.zone/osmosis/gamm/v1beta1/pools';
  } else if (domain == "osmosistestnet") {
    return 'https://lcd.testnet.osmosis.zone/osmosis/gamm/v1beta1/pools';
  }else {
    return;
  }
}


export async function queryPool(domain, pool_id) {

  //--QUERY API--

  let baseUrl = get_base_url(domain);
  let url = baseUrl;
  let param = `/${pool_id}`
  if(param) {
    url = baseUrl + param;
  }

  const options = {
    method: 'GET',
    accept: 'application/json'
  }
  let response = await fetch(url,options);
  let result = await response.json();
  if (!result.pool) { return; } else {
    return result.pool;
  }
}


async function queryPools(domain) {

  //--QUERY API--

  console.log(domain);

  let baseUrl = get_base_url(domain);
  let params;
  const fileName = poolsFileName;

  // queryApi.queryAPI(baseUrl, params, domain, fileName); // Removed - restore queryApi.mjs if re-enabling

}

function getPools(domain) {

  // let all_pools = queryApi.readQueryResponse(domain, poolsFileName); // Removed - restore queryApi.mjs if re-enabling
  // if (!all_pools?.pools) { return; }

  // pools.clear();
  // all_pools.pools.forEach((pool) => {
  //   pools.set(pool.id,Pool(pool));
  // });
  return; // Disabled - queryApi.mjs removed

}

const classic_pool = "/osmosis.gamm.v1beta1.Pool";
const stableswap_pool = "/osmosis.gamm.poolmodels.stableswap.v1beta1.Pool";
const concentrated_pool = "/osmosis.concentratedliquidity.v1beta1.Pool";
const half_weight = 0.5;

function Pool(pool) {
  
  let pool_obj = {};
  pool_obj.id = pool.id ? pool.id : pool.pool_id;
  pool_obj.pool_assets = new Map();
  pool_obj.pool_assets.clear();
  let total_weight = 0;
  if (pool['@type'] == classic_pool) {
    total_weight = pool.total_weight;
    pool.pool_assets.forEach((pool_asset) => {
      let asset = {}
      asset.amount = parseInt(pool_asset.token.amount);
      asset.weight = parseInt(pool_asset.weight) / total_weight;
      asset.size = asset.amount / asset.weight;
      pool_obj.pool_assets.set(pool_asset.token.denom, asset);
      if (!assets.get(pool_asset.token.denom)) {
        assets.set(pool_asset.token.denom, Asset(pool_asset.token.denom));
      }
    });
  } else if (pool['@type'] == stableswap_pool) {
    pool.pool_liquidity.forEach((pool_asset) => {
      let asset = {}
      asset.amount = parseInt(pool_asset.amount);
      asset.weight = 1 / pool.pool_liquidity.length;
      asset.size = asset.amount / asset.weight;
      pool_obj.pool_assets.set(pool_asset.denom,asset);
      if (!assets.get(pool_asset.denom)) {
        assets.set(pool_asset.denom, Asset(pool_asset.denom));
      }
    });
  } else if (pool['@type'] == concentrated_pool) {
    let current_tick_liquidity = pool.current_tick_liquidity;
    let current_sqrt_price = pool.current_sqrt_price;
    let token0 = {}
    token0.amount = current_tick_liquidity/current_sqrt_price;
    token0.weight = half_weight;
    token0.size = token0.amount / token0.weight;
    pool_obj.pool_assets.set(pool.token0,token0);
    if (!assets.get(pool.token0)) {
      assets.set(pool.token0, Asset(pool.token0));
    }
    let token1 = {}
    token1.amount = current_tick_liquidity * current_sqrt_price;
    token1.weight = half_weight;
    token1.size = token1.amount / token1.weight;
    pool_obj.pool_assets.set(pool.token1,token1);
    if (!assets.get(pool.token1)) {
      assets.set(pool.token1, Asset(pool.token1));
    }
  } else {
    console.log("Pool type does not exist!");
    console.log(pool_obj.id);
  }
  return pool_obj;
}

function Asset(base){
  let asset = {
    base: base,
    routes: []
  };
  return asset;
}

function getAssets(domain){
  
  assets.clear();
  
  if (domain == "osmosis") {
    usd = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858", // USDC
    osmo = "uosmo",
    atom = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2" // ATOM
  } else if (domain == "osmosistestnet4") {
    usd = "ibc/FF3065989E34457F342D4EFB8692406D49D4E2B5C70F725F127862E22CE6BDCD", // aUSDC
    osmo = "uosmo",
    atom = "ibc/" // ATOM
  } else if (domain == "osmosistestnet") {
    usd = "ibc/DE6792CF9E521F6AD6E9A4BDF6225C9571A3B74ACC0A529F92BC5122A39D2E58", // Noble USDC
    osmo = "uosmo",
    atom = "ibc/A8C2D23A1E6F95DA4E48BA349667E322BD7A6C996D8A4AAE8BA72E190F3D1477" // ATOM
  } else {
    console.log("Unrecognized Domain");
  }
  base_pairs = [
    usd,
    osmo,
    atom
  ];
  
  base_pairs.forEach((asset) => {
    assets.set(asset,Asset(asset));
  });
  
  assets.get(usd).largest_route = [];

}


function getRoute(asset, route, hops, ignore_assets){
  
  ticks = ticks + 1;

  // -- GET ALL POOLS CONTAINING THE ASSET --

  let asset_pools = [];
  pools.forEach((pool) => {
    if (pool.pool_assets.get(asset.base)) {
      asset_pools.push(pool);
    }
  });
  //console.log("Number of Asset Pools:");
  //console.log(asset_pools.length);
  

  // -- GET 5 LARGEST POOLS -- 
  
  if (!asset.largest_pools) {

    let candidate_pools = asset_pools.filter(pool => {
      const size = pool.pool_assets.get(asset.base)?.size;
      return size !== undefined && !isNaN(size) && size > 0;
    });
    candidate_pools.sort((poolA, poolB) => {
      const sizeA = poolA.pool_assets.get(asset.base)?.size || 0;
      const sizeB = poolB.pool_assets.get(asset.base)?.size || 0;
      return sizeB - sizeA;
    });
    asset.largest_pools = candidate_pools.slice(0, num_largest_pools) || [];

  }
  
  // -- FOR EACH POOL --
  
  asset.largest_pools.forEach((pool) => {
    
    pool.pool_assets.forEach((pool_asset, denom) => {
    
      // -- IGNORE PAIR ASSETS IN IGNORE LIST --
      
      if (ignore_assets.includes(denom)) {
        return;
      }
      
      // -- IF PAIR ASSET ALREADY HAS A LARGEST ROUTE --

      if (assets.get(denom).largest_route) {
        if (hops + 1 + assets.get(denom).largest_route.length <= num_max_hops) {
          // make sure it doesn't contain the ignore assets
          if (assets.get(denom).largest_route.some(hop => {
            return ignore_assets.some(ignore => hop.destination === ignore);
          })) {
            return;
          }
          let hop = [{
            source: asset.base,
            pool: pool.id,
            destination: denom
          }];
          assets.get(ignore_assets[0]).routes.push(route.concat(hop,assets.get(denom).largest_route));
          //asset.largest_route[0].routes.push(route.concat(hop,assets.get(denom).largest_route));
        }
        return;
      }
      
      // -- FIND ROUTE RECURSIVELY UP TO n HOPS --
      
      if (hops < num_max_hops) {
        getRoute(
          assets.get(denom),
          route.concat([{
            source: asset.base,
            pool: pool.id,
            destination: denom
          }]),
          hops + 1,
          ignore_assets.concat(denom)
        );
      }
    });
  });
}

function getRoutes(){

  console.log("Getting Routes...");
  
  assets.forEach((asset) => {
  
    //console.log("Asset:");
    //console.log(asset.base);
    
    // -- CANCEL SEARCH IF IT ALREADY HAS LARGEST ROUTE --
    
    if (asset.largest_route) {
      if (asset.base == usd) {
        asset.osmosis_info = true;
      }
      return;
    }
    
    // -- GET ROUTES FOR ASSET --
    
    getRoute(asset,[],0,[asset.base]);
    
    // -- REPORT ON ASSETS W/O ROUTES --
    
    if (asset.routes.length == 0) {
      //console.log(asset.base);
      //console.log("No Routes");
      return;
    }
    
    // -- GET LIQUIDITY FOR EACH ROUTE --
    
    asset.routes.forEach((route) => {
      getRouteLiquidity(route);
    });
    
    // -- GET LARGEST ROUTE --
    
    asset.largest_route = getLargestRoute(asset.routes, 0);
    
    // -- OSMOSIS-PRICE TAG --
    
    asset.osmosis_price = 
      "osmosis-price".concat(
        ":",
        asset.largest_route[0].destination,
        ":",
        asset.largest_route[0].pool
      );
    
    // -- OSMOSIS-INFO TAG --
    
    if (asset.largest_route.liquiditys[0] > 1000
      && asset.largest_route[0].liquidity > 1000
      && (pools.get(asset.largest_route[0].pool).pool_assets.get(asset.base).weight * asset.largest_route[0].liquidity) >= 500
    ) {
      asset.osmosis_info = true;
    }
  });

}

function getRouteLiquidity(route){
  
  let liquiditys = [];
  let value = 0.000001;
  for (let i = route.length - 1; i >= 0; i--) {
    route[i].liquidity =
      pools.get(route[i].pool).pool_assets.get(route[i].destination).size * value;
    liquiditys.push(route[i].liquidity);
    value = route[i].liquidity /
      pools.get(route[i].pool).pool_assets.get(route[i].source).size;
  }
  liquiditys.sort(function(a, b){return a - b});
  route.liquiditys = liquiditys;
  
}

function getLargestRoute(routes, i){

  if (routes.length == 0) {
    return;
  }
  let largest_minimum = 0;
  let largest_routes = [];
  routes.forEach((route) => {
    if (route.liquiditys[i] > largest_minimum) {
      largest_minimum = route.liquiditys[i];
      largest_routes = [route];
    } else if (route.liquiditys[i] == largest_minimum) {
      largest_routes.push(route);
    }
  });
  if (largest_routes.length == 1) {
    return largest_routes[0];
  }
  for (let j = 0; j < largest_routes.length; j++) {
    if (largest_routes[j].length <= i + 1) {
      return largest_routes[j];
    }
  }
  return getLargestRoute(largest_routes, i + 1);

}




export async function getAssetsPricing(chain) {
  getAssets(chain);
  //await queryPools(chain);
  getPools(chain);
  if (pools.size == 0) { return; }
  getRoutes();
  console.log(ticks);
  return assets;
}

export async function queryAllPools() {
  zone.chainNames.forEach(async (chainName) => {
    await queryPools(chainName);
  });
}

async function main() {
  let domain = "osmosis";
  //let domain = "osmosistestnet4";
  //let domain = "osmosistestnet";
  getAssetsPricing(domain);
}

//main(); //TURN THIS BACK OFF
