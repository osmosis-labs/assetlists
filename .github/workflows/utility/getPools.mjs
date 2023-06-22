//Purpose:
// to identify the pools and liquidity of an asset. To price it and determine whether it goes on info site


import * as fs from 'fs';
import fetch from 'node-fetch';

let pools = new Map();
export let assets = new Map();
let usd, osmo, atom;
let base_pairs = [usd, osmo, atom];
const num_max_hops = 3;
const num_largest_pools = 5;

let ticks = 0;

function get_base_url(domain) {
  let baseUrl;
  if (domain == "osmosis") {
    return 'https://lcd.osmosis.zone/osmosis/gamm/v1beta1/pools';
  } else if (domain == "osmosistestnet") {
    return 'https://lcd.testnet4.osmosis.zone/osmosis/gamm/v1beta1/pools';
  } else if (domain == "osmosistestnet5") {
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

  let baseUrl = get_base_url(domain);
  console.log(domain);
  console.log(baseUrl);
  const options = {
    method: 'GET',
    accept: 'application/json'
  }

  let url = baseUrl;
  let response;
  let result;
  let param = null;
  let paginationKey = "";
  const paginationLimit = 2000;
  
  param = `?pagination.limit=${paginationLimit}`
  if(param) {
    url = baseUrl + param;
  }
  response = await fetch(url,options);
  result = await response.json();
  if (!result.pools) { return; }
  getPools(result.pools);
  
  
  // -- For testing locally --
  //fs.writeFile('pools.json', JSON.stringify(pools,null,2), (err) => {
    //if (err) throw err;
  //});
  //getPools(JSON.parse(fs.readFileSync('pools.json')));
  

  console.log("Pools: ");
  console.log(pools.size);
  //console.log(pools);

}

function getPools(all_pools) {
  
  pools.clear();
  all_pools.forEach((pool) => {
    pools.set(pool.id,Pool(pool));
  });
  
}

function Pool(pool) {
  
  let pool_obj = {};
  pool_obj.id = pool.id;
  pool_obj.pool_assets = new Map();
  pool_obj.pool_assets.clear();
  let total_weight = 0;
  if (pool.pool_assets) {
    pool.pool_assets.forEach((pool_asset) => {
      total_weight = total_weight + parseInt(pool_asset.weight);
    });
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
  } else if (pool.pool_liquidity) {
    let i = 0;
    pool.pool_liquidity.forEach((pool_asset) => {
      let asset = {}
      asset.amount = parseInt(pool_asset.amount);
      asset.weight = 1 / pool.pool_liquidity.length;
      asset.size = asset.amount / asset.weight;
      pool_obj.pool_assets.set(pool_asset.denom,asset);
      i = i + 1;
      if (!assets.get(pool_asset.denom)) {
        assets.set(pool_asset.denom, Asset(pool_asset.denom));
      }
    });
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
  } else if (domain == "osmosistestnet") {
    usd = "ibc/FF3065989E34457F342D4EFB8692406D49D4E2B5C70F725F127862E22CE6BDCD", // aUSDC
    osmo = "uosmo",
    atom = "ibc/" // ATOM
  } else if (domain == "osmosistestnet5") {
    usd = "ibc/6F34E1BD664C36CE49ACC28E60D62559A5F96C4F9A6CCE4FC5A67B2852E24CFE", // aUSDC
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
    let sizes = [];
    asset_pools.forEach((pool) => {
      sizes.push(pool.pool_assets.get(asset.base).size);
    });
    sizes.sort(function(a, b){return b - a});
    let size_threshold;
    if (asset.base == osmo) {
      size_threshold = 500;
    } else {
      size_threshold = num_largest_pools;
    }
    if (sizes.length < size_threshold) {
      size_threshold = sizes.length;
    }
    asset.largest_pools = [];
    asset_pools.forEach((pool) => {
      if(pool.pool_assets.get(asset.base).size >= sizes[size_threshold - 1]) {
        asset.largest_pools.push(pool);
      }
    });
  }
  
  // -- FOR EACH POOL --
  
  asset.largest_pools.forEach((pool) => {
  
    // -- CHECK FOR BASE PAIRS --
  
    for (let i = 0; i < base_pairs.length; i++) {
      if (pool.pool_assets.get(base_pairs[i]) && base_pairs[i] != asset.base && assets.get(base_pairs[i]).largest_route) {
        let hop = [{
          source: asset.base,
          pool: pool.id,
          destination: base_pairs[i]
        }];
        assets.get(ignore_assets[0]).routes.push(route.concat(hop,assets.get(base_pairs[i]).largest_route));
        return;
      }
    }
    
    pool.pool_assets.forEach((pool_asset, denom) => {
    
      // -- IGNORE PAIR ASSETS IN IGNORE LIST --
      
      if (ignore_assets.includes(denom)) {
        return;
      }
      
      // -- IF PAIR ASSET ALREADY HAS A LARGEST ROUTE --
    
      if (assets.get(denom).largest_route) {
        if (assets.get(denom).largest_route.length + hops <= 6) {
          let hop = [{
            source: asset.base,
            pool: pool.id,
            destination: denom
          }];
          assets.get(ignore_assets[0]).routes.push(route.concat(hop,assets.get(denom).largest_route));
        }
        return;
      }
      
      // -- FIND ROUTE RECURSIVELY UP TO 3 HOPS --
      
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
      console.log(asset.base);
      console.log("No Routes");
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




export async function returnAssets(chain){
  getAssets(chain);
  await queryPools(chain);
  if (pools.size == 0) { return; }
  getRoutes();
  console.log(ticks);
  return assets;
}

async function main() {
  let domain = "osmosis";
  //let domain = "osmosistestnet";
  //let domain = "osmosistestnet5";
  returnAssets(domain);
}

//main();
