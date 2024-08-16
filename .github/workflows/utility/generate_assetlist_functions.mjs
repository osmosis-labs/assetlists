// Purpose:
//   to generate the zone_config json using the zone json and chain registry data

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
import * as zone from "./assetlist_functions.mjs";
import { getAssetsPricing } from "./getPools.mjs";
import { getAllRelatedAssets } from "./getRelatedAssets.mjs";

//-- Global Constants --

//This address corresponds to the native assset on all evm chains (e.g., wei on ethereum)
const zero_address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

//This defines with types of traces are considered essentially the same asset
const originTraceTypes = [
  "ibc",
  "ibc-cw20",
  "bridge",
  "wrapped",
  "additional-mintage",
  "synthetic",
  "legacy-mintage"
];

const nonCryptoPlatforms = [
  "forex",
  "comex"
];

const traceTypesNeedingProvider = [
  "bridge",
  "synthetic"
];

let assetProperty = new Map();


//This defines how many days since listing qualifies an asset as a "New Asset"
const daysForNewAssetCategory = 21;

//-- Functions --

export async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

export function deepEqual(obj1, obj2) {
  if (obj1 === obj2) {
    return true;
  }

  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (let key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }

  return true;
}

function addUniqueArrayItem(item, array) {
  const exists = array.some(existingArrayItem => deepEqual(existingArrayItem, item));
  if (!exists) {
    array.push(item);
  }
  return array;
}

export function addArrayItem(item, array) {
  if (!array.includes(item)) {
    array.push(item);
  }
}

// Helper function to create a key string from an object
export function createKey(obj) {
  return JSON.stringify(obj);
}

export function createCombinedKey(obj, additionalProperty) {
  return `${createKey(obj)}:${additionalProperty}`;
}

export function deepCopy(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj; // Return primitive types directly
  }

  // Create a new object or array based on the type of obj
  const copy = Array.isArray(obj) ? [] : {};

  // Iterate over each property in obj
  for (let key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // Recursively copy nested objects or arrays
      copy[key] = deepCopy(obj[key]);
    }
  }

  return copy;
}


export async function setSourceAsset(asset_data) {

  if (
    !asset_data.zone_asset
  ) { return; }

  asset_data.source_asset = {
    chain_name: asset_data.zone_asset.chain_name,
    base_denom: asset_data.zone_asset.base_denom
  }

  return;

}


export function getAssetTrace(asset_data) {

  const type = (asset_data.source_asset.base_denom.slice(0, 5) === "cw20:") ? "ibc-cw20" : "ibc";

  const segments = asset_data.zone_asset.path.split("/");
  if (segments?.length < 3) {
    console.log("Invalid path provided.");
    console.log(asset_data.zone_asset.path);
    return;
  }

  let counterparty = {
    chain_name: asset_data.source_asset.chain_name,
    base_denom: asset_data.source_asset.base_denom
  };

  let chain = {
    channel_id: segments[1]
  };

  //--Identify chain_1 and chain_2--
  let chain_1, chain_2;
  if (asset_data.source_asset.chain_name < asset_data.chainName) {
    [chain_1, chain_2] = [counterparty, chain];
  } else {
    [chain_1, chain_2] = [chain, counterparty];
  }

  //--Find IBC Connection--
  const channels = chain_reg.getIBCFileProperty(
    asset_data.source_asset.chain_name,
    asset_data.chainName,
    "channels"
  );

  let foundChannel;
  channels.forEach((channel) => {
    if (
      channel.chain_1.channel_id === chain_1.channel_id ||
      channel.chain_2.channel_id === chain_2.channel_id
    ) {
      foundChannel = true;
      delete chain_1.channel_id;
      delete chain_2.channel_id;
      if (type === "ibc-cw20") {
        chain_1.port = channel.chain_1.port_id;
        chain_2.port = channel.chain_2.port_id;
        if (segments[0] !== chain.port) {
          console.log("Port mismatch!");
          console.log(segments[0]);
          console.log(chain.port);
          foundChannel = false;
          return;
        }
      }
      chain_1.channel_id = channel.chain_1.channel_id;
      chain_2.channel_id = channel.chain_2.channel_id;
      return;
    }
  });
  if (!foundChannel) {
    console.log("Channel not registered.");
    console.log(asset_data.zone_asset.path);
    console.log(channels);
    return;
  }

  chain.path = asset_data.zone_asset.path;

  const trace = {
    type: type,
    counterparty: counterparty,
    chain: chain
  }

  return trace;

}

export async function setLocalAsset(asset_data) {

  if (
    !asset_data.chainName ||
    !asset_data.zone_asset ||
    !asset_data.source_asset
  ) { return; }
  if (asset_data.zone_asset.chain_name === asset_data.chainName) {
    asset_data.local_asset = asset_data.source_asset;
    return;
  }
  if (!asset_data.zone_asset.path) {
    console.log("No path provided.");
    console.log(asset_data.zone_asset);
    return;
  }
  try {
    let ibcHash = await zone.calculateIbcHash(asset_data.zone_asset.path);
    asset_data.local_asset = {
      chain_name: asset_data.chainName,
      base_denom: ibcHash
    }
  } catch (error) {
    console.error(error);
  }
  let traces = deepCopy(getAssetProperty(asset_data.source_asset, "traces"));
  if (!traces || traces?.length <= 0) {
    traces = [];
  }
  const trace = getAssetTrace(asset_data);
  traces.push(trace);
  assetProperty.set(createCombinedKey(asset_data.local_asset, "traces"), traces);
}


export function setCanonicalAsset(asset_data) {

  asset_data.canonical_asset = asset_data.zone_asset?.canonical ?? asset_data.source_asset;

}


export function setOriginAsset(asset_data) {

  let variant = {
    asset_data: asset_data,
    hops: [],
    mintageNetwork: null
  }

  let traces = getAssetProperty(asset_data.canonical_asset, "traces");
  let lastTrace = {
    counterparty: asset_data.canonical_asset
  };
  for (let i = traces?.length - 1; i >= 0; i--) {

    if (
      !originTraceTypes.includes(traces[i].type)
        ||
      nonCryptoPlatforms.includes(traces[i].counterparty.chain_name)
    ) { break; }

    let provider = null;
    if ( traceTypesNeedingProvider.includes(traces[i].type) ) {
      provider = asset_data.zone_config?.providers.find(
        provider =>  //where...
          provider.provider === traces[i].provider
      )
      if (!provider) { break; }
    }

    const hop = {
      type: traces[i].type,
      provider: provider,
      network: lastTrace.counterparty.chain_name
    };

    variant.hops.push(hop);

    lastTrace = traces[i];

  }

  asset_data.frontend.variant = variant;

  asset_data.origin_asset = {
    chain_name: lastTrace.counterparty.chain_name,
    base_denom: lastTrace.counterparty.base_denom,
  };
    
  let variantGroup = getAssetProperty(asset_data.origin_asset, "variantGroup");
  
  asset_data.frontend.is_canonical = createKey(asset_data.origin_asset) === createKey(asset_data.canonical_asset);
  if (asset_data.frontend.is_canonical) {
    variantGroup.variantGroupKey = asset_data.local_asset.base_denom;
  }

  variant.hops.reverse();


  //  To know whether there are additional mintages,
  //  need to check for mintages of actual source asset
  //  rather than just what the asset canonically represents
  //  e.g., WBTC minted on Osmosis canonically represents the Ethereum mintage,
  //  and if we were to go by that, the fact of the Osmosis mintage would be ignored.
  traces = getAssetProperty(asset_data.source_asset, "traces");
  lastTrace = {
    counterparty: asset_data.source_asset
  };
  for (let i = traces?.length - 1; i >= 0; i--) {
    if (
      createKey({
        chain_name: traces[i].counterparty.chain_name,
        base_denom: traces[i].counterparty.base_denom
      }) === createKey(asset_data.origin_asset)
    ) {
      if (
        traces[i].type === "additional-mintage"
          ||
        traces[i].type === "legacy-mintage"
      ) {
        variant.mintageNetwork = lastTrace.counterparty.chain_name;
        variantGroup.additionalMintagesExist = true;
      } else {
        variant.mintageNetwork = traces[i].counterparty.chain_name;
      }
      break;
    }
    lastTrace = traces[i];
  }

  variantGroup.variants.push(variant);

}


/*

--Variant Group--

variantGroup: {
  asset: origin asset
  variantGroupKey: base_denom of canonical ?? null
  additionalMintagesExist: t/f
  variants: [ {variant} ]
}

variant: {
  mintageNetwork: chain_name
  hops: [ {hop} ]
}

hop: {
  type: trace type of last trace
  provider: provider
  network: counterparty
}

*/

function getNetworkSymbolSuffix(chain_name, asset_data) {

  let chain_symbol_suffix = asset_data.zone_config?.chains?.find(
    chain => //where
      chain.chain_name === chain_name
        &&
      chain.symbol_suffix
  )?.symbol_suffix;
  if (chain_symbol_suffix) {
    return chain_symbol_suffix;
  }

  let bech32_prefix = chain_reg.getFileProperty(chain_name, "chain", "bech32_prefix");
  if (bech32_prefix) {
    return bech32_prefix;
  }

  return chain_name;

}

function getNetworkName(chain_name, asset_data) {

  let override_chain_pretty_name = asset_data.zone_config?.chains?.find(
    chain => //where
      chain.chain_name === chain_name
        &&
      chain.pretty_name
    )?.pretty_name;
  if (override_chain_pretty_name) {
    return override_chain_pretty_name;
  }

  let chain_pretty_name = chain_reg.getFileProperty(chain_name, "chain", "pretty_name");
  if (chain_pretty_name) {
    return chain_pretty_name;
  }

  return chain_name;

}

export function setSymbol(asset_data) {

  let symbol = getAssetProperty(asset_data.origin_asset, "symbol");

  asset_data.chain_reg.symbol =
    getAssetProperty(asset_data.local_asset, "symbol") ??
    getAssetProperty(asset_data.canonical_asset, "symbol");
    //getAssetProperty(asset_data.source_asset, "symbol"); //change this to source asset, since canonical only applies to osmosis zone

  if (asset_data.zone_asset?.override_properties?.symbol) {
    symbol = asset_data.zone_asset?.override_properties?.symbol;
    asset_data.frontend.symbol = symbol;
    asset_data.asset_detail.symbol = symbol;
    return;
  }
  
  symbol = getAssetProperty(asset_data.origin_asset, "symbol");
  

  //If it's the canonical asset, then don't add suffixes
  if (asset_data.frontend.is_canonical) {
    asset_data.frontend.symbol = symbol;
    asset_data.asset_detail.symbol = symbol;
    return;
  }

  //Need a way to know if last suffix is network
  let last_suffix_is_network = false;

  let variantGroup = getAssetProperty(asset_data.origin_asset, "variantGroup");
  if (variantGroup.additionalMintagesExist) {
    symbol = symbol + "." + getNetworkSymbolSuffix(asset_data.frontend.variant.mintageNetwork, asset_data);
  }
  asset_data.frontend.variant.hops.forEach((hop) => {
    if (
      hop.type === "additional-mintage"
        ||
      hop.type === "legacy-mintage"
        ||
      hop.type === "wrapped"
    ) { return; }
    else if ( traceTypesNeedingProvider.includes(hop.type) ) {
      let suffix = hop.provider.symbol_suffix ?? "";
      if ( suffix?.startsWith(".e.") ) {
        if (
          symbol.slice(symbol.length - 4) === ".eth"
        ) {
          symbol = symbol.slice(0, symbol.length - 4);
        }
        if (
          deepEqual(
            asset_data.origin_asset,
            ({
              chain_name: "ethereum",
              base_denom: "wei"
            })
          )
        ) {
          suffix = suffix.slice(2);
        }
      }
      symbol = symbol + suffix;
      last_suffix_is_network = false;
      
      if (!hop.provider.destination_network) {
        symbol = symbol + "." + getNetworkSymbolSuffix(hop.network, asset_data);
        last_suffix_is_network = true;
      }
    } else {
      symbol = symbol + "." + getNetworkSymbolSuffix(hop.network, asset_data);
      last_suffix_is_network = true;
    }
  });

  //Don't show Osmosis as a final destination network (e.g., native bridges like Router)
  let ending = ".osmo";
  if (
    last_suffix_is_network
      &&
    symbol.endsWith(ending)
  ) {
    symbol = symbol.slice(0, -ending.length);
  }

  asset_data.frontend.symbol = symbol;
  asset_data.asset_detail.symbol = symbol;
  return;


}


export function setName(asset_data) {

  let name;

  asset_data.chain_reg.name =
    getAssetProperty(asset_data.local_asset, "name") ??
    getAssetProperty(asset_data.source_asset, "name");


  if (asset_data.zone_asset?.override_properties?.name) {
    name = asset_data.zone_asset?.override_properties?.name;
    asset_data.frontend.name = name;
    asset_data.asset_detail.name = name;
    return;
  }

  //but use chain name instead if it's the staking token...
  if (getAssetProperty(asset_data.origin_asset, "is_staking")) {
    name = chain_reg.getFileProperty(asset_data.origin_asset.chain_name, "chain", "pretty_name");
    //Check for Chain Name Override--E.G., "Ethereum Mainnet" -> "Ethereum"
    let override_chain_pretty_name = asset_data.zone_config?.chains?.find(
      chain => //where
        chain.chain_name === asset_data.origin_asset.chain_name
        &&
        chain.pretty_name
    )?.pretty_name;
    if (override_chain_pretty_name) {
      name = override_chain_pretty_name;
    }
  } else {
    name = getAssetProperty(asset_data.origin_asset, "name");
  }
  
  //If it's the canonical asset, then don't add suffixes
  if (asset_data.frontend.is_canonical) {
    asset_data.frontend.name = name;
    asset_data.asset_detail.name = name;
    return;
  }

  //Need a way to know if last suffix is network
  let last_suffix_is_network = false;
  let this_suffix_is_network = false;

  //Show Mintage Network, if needed
  let variantGroup = getAssetProperty(asset_data.origin_asset, "variantGroup");
  if (variantGroup.additionalMintagesExist) {
    name =  
      name
      + " (" +
      getNetworkName(asset_data.frontend.variant.mintageNetwork, asset_data)
      + ")";
    last_suffix_is_network = true;
  }

  asset_data.frontend.variant.hops.forEach((hop) => {
    if (
      hop.type === "additional-mintage"
        ||
      hop.type === "legacy-mintage"
        ||
      hop.type === "wrapped"
    ) { return; }
    else if (traceTypesNeedingProvider.includes(hop.type)) {

      //Some trace providers don't need indication
      if ( hop.provider.name_suffix ) {
        this_suffix_is_network = false;
        name = appendNameSuffix(
          name,
          hop.provider.name_suffix,
          this_suffix_is_network,
          last_suffix_is_network
        );
        last_suffix_is_network = false;
      }
      
      if (
        !hop.provider.destination_network
          ||
        !hop.provider.name_suffix
      ) {
        this_suffix_is_network = true;
        name = appendNameSuffix(
          name,
          getNetworkName(hop.network, asset_data),
          this_suffix_is_network,
          last_suffix_is_network
        );
        last_suffix_is_network = true;
      }
    } else { //type: ibc and ibc-cw20

      this_suffix_is_network = true;
      name = appendNameSuffix(
        name,
        getNetworkName(hop.network, asset_data),
        this_suffix_is_network,
        last_suffix_is_network
      );
      last_suffix_is_network = true;
    }
  });

  //Don't show Osmosis as a final destination network (e.g., native bridges like Router)
  let ending = " (Osmosis)";
  if (
    last_suffix_is_network
      &&
    name.endsWith(ending)
  ) {
    name = name.slice(0, -ending.length);
  }

  asset_data.frontend.name = name;
  asset_data.asset_detail.name = name;
  

}

function appendNameSuffix(name, suffix, this_suffix_is_network, last_suffix_is_network) {

  let new_name = name;
  if (!this_suffix_is_network && last_suffix_is_network) {
    new_name = new_name.replace(/(\([^\(\)]*\))$/, (match) => {
      return match.slice(0, -1) + " via " + suffix + ")";
    });
  } else {
    new_name = new_name
      + " (" +
      suffix
      + ")";
  }
  return new_name;

}



export function setSourceDenom(asset_data) {

  asset_data.frontend.sourceDenom = asset_data.source_asset.base_denom;

}


export function setCoinMinimalDenom(asset_data) {

  asset_data.frontend.coinMinimalDenom = asset_data.local_asset.base_denom;
  asset_data.chain_reg.coinMinimalDenom = asset_data.local_asset.base_denom;

}


export function createVariantsObject(asset) {

  return {
    asset: asset,
    variantGroupKey: null,
    additionalMintagesExist: false,
    variants: []
  };

}


export function getAssetProperty(asset, propertyName) {

  const derivedProperties = [
    "decimals",
    "is_staking",
    "traces",
    "origin_to_canonical_hops",
    "variantGroup"
  ];

  let assetPropertyKey = createCombinedKey(asset, propertyName);

  if (!assetProperty.get(assetPropertyKey)) {
    if (derivedProperties.includes(propertyName)) {
      if (propertyName === "traces") {
        assetProperty.set(assetPropertyKey, getAssetTraces(asset));
      } else if (propertyName === "decimals") {
        assetProperty.set(assetPropertyKey, getAssetDecimals(asset));
      } else if (propertyName === "is_staking") {
        assetProperty.set(assetPropertyKey, getAssetIsStaking(asset));
      } else if (propertyName === "variantGroup") {
        assetProperty.set(assetPropertyKey, createVariantsObject(asset));
      }
    } else {
      assetProperty.set(
        assetPropertyKey,
        chain_reg.getAssetProperty(
          asset.chain_name,
          asset.base_denom,
          propertyName
        )
      );
    }
  }
  return assetProperty.get(assetPropertyKey);
}

export function getAssetDecimals(asset) {

  if (asset.decimals) {
    return asset.decimals;
  }

  let decimals;

  const display = chain_reg.getAssetProperty(asset.chain_name, asset.base_denom, "display");
  const denom_units = chain_reg.getAssetProperty(asset.chain_name, asset.base_denom, "denom_units");
  denom_units?.forEach((unit) => {
    if (display === unit.denom) {
      decimals = unit.exponent;
      return;
    }
  });

  if (decimals === undefined) {
    denom_units?.forEach((unit) => {
      if (unit.aliases?.includes(display)) {
        decimals = unit.exponent;
        return;
      }
    });
  }

  return decimals;

}

export function getAssetIsStaking(asset) {

  if (asset.is_staking) {
    return asset.is_staking;
  }

  return chain_reg.getFileProperty(asset.chain_name, "chain", "staking")?.staking_tokens[0]?.denom === asset.base_denom;

}

export function getAssetTraces(asset) {

  let lastTrace = {};
  lastTrace.counterparty = {
    chain_name: asset.chain_name,
    base_denom: asset.base_denom
  };
  let traces;
  let fullTraces = [];
  let counter = 0;
  const limit = 50;

  while (lastTrace && counter !== limit) {
    traces = chain_reg.getAssetProperty(
      lastTrace.counterparty.chain_name,
      lastTrace.counterparty.base_denom,
      "traces"
    );
    if (traces) {
      lastTrace = traces?.[traces.length - 1];
      fullTraces.push(lastTrace);
    } else {
      lastTrace = undefined;
    }
    counter = counter + 1;
    if (counter === limit) {
      console.log("Traces too long!");
      console.log(asset);
    }
  }

  fullTraces.reverse(); 
  return fullTraces;

}

export function setTraces(asset_data) {

  let traces = getAssetProperty(asset_data.local_asset, "traces");
  if(traces?.length === 0) {
    traces = undefined;
  }
  asset_data.chain_reg.traces = traces;

}

export function setDecimals(asset_data) {

  asset_data.frontend.decimals =
    getAssetProperty(asset_data.local_asset, "decimals") ??
    getAssetProperty(asset_data.source_asset, "decimals");

}


export function setImages(asset_data) {

  let images = getAssetProperty(asset_data.local_asset, "images") ?? getAssetProperty(asset_data.canonical_asset, "images");
  asset_data.chain_reg.images = images;

  images = getAssetProperty(asset_data.canonical_asset, "images");

  let primaryImage = asset_data.zone_asset?.override_properties?.logo_URIs ?? images?.[0];

  asset_data.frontend.logoURIs = {...primaryImage};
  delete asset_data.frontend.logoURIs.theme;
  delete asset_data.frontend.logoURIs.image_sync;

  asset_data.chain_reg.logo_URIs = getAssetProperty(asset_data.local_asset, "logo_URIs");

}


export function setCoinGeckoId(asset_data) {

  let coingecko_id;

  if (asset_data.source_asset.chain_name === asset_data.chainName) {
    asset_data.chain_reg.coingecko_id = getAssetProperty(
      asset_data.source_asset,
      "coingecko_id"
    );
  }

  if (asset_data.zone_asset.override_properties?.coingecko_id) {
    coingecko_id = asset_data.zone_asset.override_properties?.coingecko_id;
  } else {
    coingecko_id = getAssetProperty(
      asset_data.canonical_asset,
      "coingecko_id"
    );
  }

  asset_data.frontend.coingeckoId = coingecko_id;
  asset_data.asset_detail.coingeckoId = coingecko_id;

}

export function setKeywords(asset_data) {

  asset_data.chain_reg.keywords =
    getAssetProperty(asset_data.local_asset, "keywords")
    getAssetProperty(asset_data.canonical_asset, "keywords");

}

export function setVerifiedStatus(asset_data) {

  asset_data.frontend.verified = asset_data.zone_asset?.osmosis_verified;

}

export function setUnstableStatus(asset_data) {

  asset_data.frontend.unstable = asset_data.zone_asset?.osmosis_unstable;

}

export function setDisabledStatus(asset_data) {

  asset_data.frontend.disabled = asset_data.zone_asset?.osmosis_disabled;

}

export function setPreviewStatus(asset_data) {

  asset_data.frontend.preview = asset_data.zone_asset?.osmosis_unlisted;

}

export function setListingDate(asset_data) {

  asset_data.frontend.listingDate = new Date(asset_data.zone_asset?.listing_date_time_utc);

}

export function setCategories(asset_data) {

  const defi = "defi";
  const meme = "meme";
  const liquid_staking = "liquid_staking";
  const stablecoin = "stablecoin";
  const approvedCategories = [
    defi,
    meme,
    liquid_staking,
    stablecoin,
    "sail_initiative",
    "bridges",
    "nft_protocol",
    "depin",
    "ai",
    "privacy",
    "social",
    "oracles",
    "dweb",
    "rwa",
    "gaming"
  ];
  
  asset_data.frontend.categories = asset_data.zone_asset?.categories || [];

  //temporarily omit any categories that the frontend isn't able to handle.
  //asset_data.frontend.categories = asset_data.frontend.categories.filter(str => approvedCategories.includes(str));
  
  // if has a "peg_mechanism", add "stablecoin" category
  if (asset_data.zone_asset?.peg_mechanism) {
    addArrayItem(stablecoin, asset_data.frontend.categories);
  }

  // if has a "liquid-stake" trace, add "liquid_staking" category
  getAssetProperty(asset_data.canonical_asset, "traces")?.forEach((trace) => {
    if (trace.type == "liquid-stake") {
      addArrayItem(liquid_staking, asset_data.frontend.categories);
      return;
    }
  });

  // if (
  //   chain_reg.getFileProperty(asset_data.canonical_asset.chain_name, "chain", "fees")?.fee_tokens[0]?.denom ===
  //   asset_data.canonical_asset.base_denom
  // ) {
  //   addArrayItem("defi", asset_data.frontend.categories);
  // }
  // if (getAssetProperty(asset_data.canonical_asset, "is_staking")) {
  // //if (
  // //  chain_reg.getFileProperty(asset_data.canonical_asset.chain_name, "chain", "staking")?.staking_tokens[0]?.denom ===
  // //  asset_data.canonical_asset.base_denom
  // //) {
  //   addArrayItem("defi", asset_data.frontend.categories);
  // }

  // do not do this
  
  // // assume any factory or cw20 token without another category is a memecoin
  // if (
  //   asset_data.frontend.categories.length <= 0 &&
  //   (
  //     asset_data.canonical_asset.base_denom.substring(0, 7) === "factory" ||
  //     asset_data.canonical_asset.base_denom.substring(0, 5) === "cw20:"
  //   )
  // ) {
  //   addArrayItem("meme", asset_data.frontend.categories);
  // }

  if (asset_data.frontend.categories.length === 0) {
    asset_data.frontend.categories = undefined;
  }

}

export function setPegMechanism(asset_data) {

  asset_data.frontend.pegMechanism = asset_data.zone_asset?.peg_mechanism;

}

export function setChainName(asset_data) {

  asset_data.frontend.chainName = asset_data.source_asset.chain_name;

}

export function setVariantGroupKey(asset_data) {

  let variantGroupKey = getAssetProperty(asset_data.origin_asset, "variantGroup").variantGroupKey;

  asset_data.frontend.variantGroupKey =
    variantGroupKey
      ??
    asset_data.local_asset.base_denom;

}

export function setTypeAsset(asset_data) {

  let type_asset;

  if (asset_data.source_asset.chain_name !== asset_data.chainName) {
    type_asset = "ics20";
  } else {
    type_asset = getAssetProperty(asset_data.source_asset, "type_asset") ?? "sdk.coin";
  }

  asset_data.chain_reg.type_asset = type_asset;

}

function getChainType(asset_data, chainName) {

  let chain_type = chain_reg.getFileProperty(
    chainName,
    "chain",
    "chain_type"
  );
  if (chain_type === "cosmos") {
    return "cosmos";
  }

  /*let feeTokenDenom = chain_reg.getFileProperty(
    chainName,
    "chain",
    "fees"
  )?.fee_tokens?.[0];
  if (feeTokenDenom) {
    let feeTokenType = chain_reg.getAssetProperty(
      chainName,
      feeTokenDenom,
      "type_asset"
    );
    if (
      !feeTokenType
        ||
      feeTokenType === "sdk.coin"
        ||
      feeTokenType === "ics20"
    ) { return "cosmos"; }
    else if (
      feeTokenType === "evm-base"
        ||
      feeTokenType === "erc20"
    ) { return "evm"; }
  }*/

  if (chain_type === "eip155") {
    return "evm";
  }

  let evm_chain = asset_data.zone_config.evm_chains?.find((evm_chain) => {
    return evm_chain.chain_name === chainName;
  });
  if (evm_chain) {
    return "evm";
  }

  return "non-cosmos";

}

function getChainId(asset_data, chainName) {

  let chainId = chain_reg.getFileProperty(chainName, "chain", "chain_id");
  if (getChainType(asset_data, chainName) === "evm") {
    chainId = Number(chainId);
  }
  if (!chainId) {
    chainId = asset_data.zone_config.evm_chains?.find((evm_chain) => {
      return evm_chain.chain_name === chainName;
    })?.chain_id;
  }
  
  return chainId;

}

function getCounterpartyAsset(asset_data, asset) {

  let counterpartyAsset = {};

  counterpartyAsset.chainName = asset.chain_name;
  counterpartyAsset.sourceDenom = asset.base_denom;

  counterpartyAsset.chainType = getChainType(asset_data, asset.chain_name);

  counterpartyAsset.chainId = getChainId(asset_data, asset.chain_name);

  if (counterpartyAsset.chainType === "evm") {
    counterpartyAsset.address = getAssetProperty(asset, "address");
    if (!counterpartyAsset.address) {
      counterpartyAsset.address = zero_address;
    }
  }
  
  counterpartyAsset.symbol = getAssetProperty(asset, "symbol");
  counterpartyAsset.decimals = getAssetProperty(asset, "decimals");
  
  let image = getAssetProperty(
    asset,
    "images"
  )?.[0];
  counterpartyAsset.logoURIs = {
    png: image?.png,
    svg: image?.svg
  };
  
  return counterpartyAsset;

}

export function setCounterparty(asset_data) {

  let counterpartyAssets = [];

  //iterate over the asset's traces
  const traces = getAssetProperty(asset_data.local_asset, "traces");
  traces.reverse();
  for (const trace of traces) {
    let traceCounterpartyAsset = {
      chain_name: trace.counterparty.chain_name,
      base_denom: trace.counterparty.base_denom
    };
  
    addUniqueArrayItem(
      traceCounterpartyAsset,
      counterpartyAssets
    );

    if (
      deepEqual(
        traceCounterpartyAsset,
        asset_data.origin_asset
      )
    ) { break; }
  }
  traces.reverse();

  //add any manually specified counterparty assets
  asset_data.zone_asset?.override_properties?.counterparty?.forEach((asset) => {
    addUniqueArrayItem(
      asset,
      counterpartyAssets
    );
  });

  //turn counterparty asset pointers into actual counterparty asset objects
  asset_data.frontend.counterparty = [];
  counterpartyAssets.forEach((asset) => {
    asset_data.frontend.counterparty.push(
      getCounterpartyAsset(
        asset_data,
        asset
      )
    );
  });
  if (asset_data.frontend.counterparty.length === 0) {
    asset_data.frontend.counterparty = undefined;
  }

}

export function setTransferMethods(asset_data) {

  const external = "external_interface";
  const bridge = "integrated_bridge";

  let transfer_methods = asset_data.zone_asset.transfer_methods;
  let transferMethods = transfer_methods ? transfer_methods.map(obj => ({ ...obj })) : [];

  transferMethods.forEach((transferMethod) => {

    if (transferMethod.type === external) {

      //-Replace snake_case with camelCase-
      //temporarily assigning transferMethod.depositUrl
      transferMethod.depositUrl = transferMethod.depositUrl ?? transferMethod.deposit_url;
      delete transferMethod.deposit_url;
      transferMethod.withdrawUrl = transferMethod.withdrawUrl ?? transferMethod.withdraw_url;
      delete transferMethod.withdraw_url;

    }

  });

  if (asset_data.source_asset.chain_name !== asset_data.chainName) {
    const traces = getAssetProperty(asset_data.local_asset, "traces");
    const trace = traces?.[traces.length - 1];
    const ibcTransferMethod = {
      name: "Osmosis IBC Transfer",
      type: "ibc",
      counterparty: {
        chainName: trace.counterparty.chain_name,
        chainId: chain_reg.getFileProperty(
          trace.counterparty.chain_name,
          "chain",
          "chain_id"
        ),
        sourceDenom: trace.counterparty.base_denom,
        port: trace.counterparty.port ?? "transfer",
        channelId: trace.counterparty.channel_id
      },
      chain: {
        port: trace.chain.port ?? "transfer",
        channelId: trace.chain.channel_id,
        path: trace.chain.path
      }
    }
    transferMethods.push(ibcTransferMethod);
  }

  asset_data.frontend.transferMethods = transferMethods;

  if (transferMethods?.length === 0) {
    asset_data.frontend.transferMethods = undefined;
  }

}

export function setTooltipMessage(asset_data) {

  asset_data.frontend.tooltipMessage = asset_data.zone_asset?.tooltip_message;

}

export function setSortWith(asset_data) {

  if (getAssetProperty(asset_data.canonical_asset, "coingecko_id")) { return; } 

  const providers = asset_data.zone_config?.providers;
  if (!providers) {return;}

  const traces = getAssetProperty(asset_data.canonical_asset, "traces");
  traces?.forEach((trace) => {
    if (trace.provider) {
      providers.forEach((provider) => {
        if (provider.provider === trace.provider && provider.token) {
          asset_data.frontend.sortWith = {
            chainName: provider.token.chain_name,
            sourceDenom: provider.token.base_denom,
          };
          return;
        }
      });
    }
  });

}

export function setPrice(asset_data, pool_data) {

  //--Get Best Pricing Reference Pool--
  const denom = asset_data.local_asset.base_denom;
  if (pool_data?.get(denom)) {
    let price = pool_data.get(denom).osmosis_price ?? undefined;
    if (price) {
      let price_parts = price.split(":");
      asset_data.frontend.price = {
        poolId: price_parts[2],
        denom: price_parts[1],
      };
    }
  }

}

export function setBase(asset_data) {

  asset_data.chain_reg.base = asset_data.local_asset.base_denom;

}

export function setDisplay(asset_data) {

  asset_data.chain_reg.display =
    getAssetProperty(asset_data.local_asset, "display") || getAssetProperty(asset_data.source_asset, "display");

}

export function setDenomUnits(asset_data) {

  let denom_units = getAssetProperty(asset_data.local_asset, "denom_units");
  if (denom_units) {
    asset_data.chain_reg.denom_units = denom_units;
    return;
  }

  denom_units = getAssetProperty(asset_data.source_asset, "denom_units");
  let denom_unitsCopy = denom_units.map(unit => ({ ...unit }));
  const zeroExponentUnitIndex = denom_unitsCopy.findIndex(unit => unit.exponent === 0);
  if (zeroExponentUnitIndex === -1) {
    console.log("Denom Units for ${asset_data.source_asset.base_denom}, ${asset_data.source_asset.chain_name} missing 0 exponent");
  }
  denom_unitsCopy[zeroExponentUnitIndex].aliases = denom_unitsCopy[zeroExponentUnitIndex].aliases || [];
  addArrayItem(denom_unitsCopy[zeroExponentUnitIndex].denom, denom_unitsCopy[zeroExponentUnitIndex].aliases);
  denom_unitsCopy[zeroExponentUnitIndex].denom = asset_data.local_asset.base_denom;

  asset_data.chain_reg.denom_units = denom_unitsCopy;

}

export function setAddress(asset_data) {

  asset_data.chain_reg.address = getAssetProperty(asset_data.local_asset, "address");

}

export function setSocials(asset_data) {

  asset_data.chain_reg.socials = getAssetProperty(asset_data.local_asset, "socials");

  let socials = getAssetProperty(asset_data.canonical_asset, "socials");
  asset_data.asset_detail.websiteURL = socials?.website;
  asset_data.asset_detail.twitterURL = socials?.twitter;
  if (socials) { return; }
  
  if (getAssetProperty(asset_data.canonical_asset, "is_staking")) {
    socials = chain_reg.getFileProperty(
      asset_data.canonical_asset.chain_name,
      "chain",
      "socials"
    )
  }
  asset_data.asset_detail.websiteURL = socials?.website;
  asset_data.asset_detail.twitterURL = socials?.twitter;
  if (socials) { return; }

  socials = chain_reg.getAssetPropertyWithTraceCustom(
    asset_data.source_asset.chain_name,
    asset_data.source_asset.base_denom,
    "socials",
    originTraceTypes
  );
  asset_data.asset_detail.websiteURL = socials?.website;
  asset_data.asset_detail.twitterURL = socials?.twitter;

}

export function setIsAlloyed(asset_data) {

  asset_data.frontend.isAlloyed = asset_data.zone_asset.is_alloyed;

}

export function setContract(asset_data) {

  if (asset_data.zone_asset.is_alloyed) {
    
    asset_data.frontend.contract = asset_data.chain_reg.address;

  }

}

export function setQuotesDisabled(asset_data) {

  asset_data.frontend.quotes_disabled = asset_data.zone_asset.quotes_disabled;

}

export function setDescription(asset_data) {
  
  let description, extended_description;

  asset_data.chain_reg.description =
    getAssetProperty(asset_data.local_asset, "description") ??
    getAssetProperty(asset_data.canonical_asset, "description");
  asset_data.chain_reg.extended_description = getAssetProperty(asset_data.local_asset, "extended_description");


  if (asset_data.zone_asset?.override_properties?.description) {
    description = asset_data.zone_asset?.override_properties?.description;
    asset_data.asset_detail.description = description;
    return;
  }
  
  description =
    asset_data.frontend.is_canonical
      ? 
    getAssetProperty(asset_data.canonical_asset, "description")
      :
    asset_data.chain_reg.description;

  extended_description =
    asset_data.frontend.is_canonical
      ? 
    getAssetProperty(asset_data.canonical_asset, "extended_description")
      :
    (
      getAssetProperty(asset_data.local_asset, "extended_description")
        ||
      getAssetProperty(asset_data.canonical_asset, "extended_description")
    );

  if (!extended_description) {
    if (getAssetProperty(asset_data.canonical_asset, "is_staking")) {
      extended_description = chain_reg.getFileProperty(
        asset_data.canonical_asset.chain_name,
        "chain",
        "description"
      );
    }
  }

  description =
    (description ?? "")
      +
    (description && extended_description ? "\n\n" : "")
      +
    (extended_description ?? "");
  asset_data.asset_detail.description = description;

}

export function reformatFrontendAsset(asset_data) {

  //--Setup Frontend Asset--
  let reformattedAsset = {
    chainName: asset_data.frontend.chainName,
    sourceDenom: asset_data.frontend.sourceDenom,
    coinMinimalDenom: asset_data.frontend.coinMinimalDenom,
    symbol: asset_data.frontend.symbol,
    decimals: asset_data.frontend.decimals,
    logoURIs: asset_data.frontend.logoURIs,
    coingeckoId: asset_data.frontend.coingeckoId,
    price: asset_data.frontend.price,
    categories: asset_data.frontend.categories ?? [],
    pegMechanism: asset_data.frontend.pegMechanism,
    transferMethods: asset_data.frontend.transferMethods ?? [],
    counterparty: asset_data.frontend.counterparty ?? [],
    variantGroupKey: asset_data.frontend.variantGroupKey,
    name: asset_data.frontend.name,
    //description: asset_data.frontend.description,
    isAlloyed: asset_data.frontend.isAlloyed ?? false,
    contract: asset_data.frontend.contract,
    verified: asset_data.frontend.verified ?? false,
    unstable: asset_data.frontend.unstable ?? false,
    disabled: asset_data.frontend.disabled ?? false,
    quotesDisabled: asset_data.frontend.quotesDisabled ?? false,
    preview: asset_data.frontend.preview ?? false,
    tooltipMessage: asset_data.frontend.tooltipMessage,
    sortWith: asset_data.frontend.sortWith,
    //twitterURL: asset_data.frontend.twitter_URL,
    listingDate: asset_data.frontend.listingDate,
    //relatedAssets: asset_data.frontend.relatedAssets,
  };

  if (isNaN(asset_data.frontend.listingDate?.getTime())) {
    // Remove listing_date if it's null
    delete reformattedAsset.listingDate;
  }

  asset_data.frontend = reformattedAsset;
  return;

}

export function reformatChainRegAsset(asset_data) {

  //--Setup Chain Registry Asset--
  let reformattedAsset = {
    description: asset_data.chain_reg.description,
    extended_description: asset_data.chain_reg.extended_description,
    denom_units: asset_data.chain_reg.denom_units,
    type_asset: asset_data.chain_reg.type_asset,
    address: asset_data.chain_reg.address,
    base: asset_data.chain_reg.base,
    name: asset_data.chain_reg.name,
    display: asset_data.chain_reg.display,
    symbol: asset_data.chain_reg.symbol,
    traces: asset_data.chain_reg.traces,
    logo_URIs: asset_data.chain_reg.logo_URIs,
    images: asset_data.chain_reg.images,
    coingecko_id: asset_data.chain_reg.coingecko_id,
    keywords: asset_data.chain_reg.keywords,
    socials: asset_data.chain_reg.socials
  };

  asset_data.chain_reg = reformattedAsset;
  return;

}

export function reformatAssetDetailAsset(asset_data) {

  //--Setup Asset Detail Asset--
  let reformattedAsset = {
    name: asset_data.asset_detail.name,
    symbol: asset_data.asset_detail.symbol,
    description: asset_data.asset_detail.description,
    coingeckoID: asset_data.asset_detail.coingeckoId,
    websiteURL: asset_data.asset_detail.websiteURL,
    twitterURL: asset_data.asset_detail.twitterURL
  };

  asset_data.asset_detail = reformattedAsset;
  return;

}
