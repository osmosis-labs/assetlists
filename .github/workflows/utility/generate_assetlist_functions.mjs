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
const find_origin_trace_types = [
  "ibc",
  "ibc-cw20",
  "bridge",
  "wrapped",
  "additional-mintage",
];

//Puposes
export const chain_registry_osmosis_assetlist = "chain_registry_osmosis_assetlist"
export const osmosis_zone_frontend_assetlist = "osmosis_zone_frontend_assetlist";
export const osmosis_zone_frontend_asset_detail = "osmosis_zone_frontend_asset_detail"

//This defines how many days since listing qualifies an asset as a "New Asset"
const daysForNewAssetCategory = 21;

//-- Functions --

export async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

export function addArrayItem(item, array) {
  if (!array.includes(item)) {
    array.push(item);
  }
}

export function getAssetCoinGeckoID(envChainName, zone_asset, purpose) {

  const property = "coingecko_id";
  let trace_types = [];

  let asset = zone_asset;

  if (
    purpose === osmosis_zone_frontend_assetlist ||
    purpose === osmosis_zone_frontend_asset_detail
  ) {

    //for osmosis zone, the coingecko ID, should first be the override value, if provided
    if (zone_asset.override_properties?.coingecko_id) {
      return zone_asset.override_properties?.coingecko_id;
    }

    trace_types = [
      "ibc",
      "ibc-cw20",
      "additional-mintage",
      "test-mintage"
    ];

    //or, use the canonical
    if (zone_asset.canonical) {
      asset = zone_asset.canonical;
    }

  } else if (purpose === chain_registry_osmosis_assetlist) {

    if (asset.chain_name !== envChainName) { return; }

    trace_types = [
      "additional-mintage"
    ];

  } else {
    console.log("Invalid purpose: ${purpose}");
  }

  return chain_reg.getAssetPropertyWithTraceCustom(
    asset.chain_name,
    asset.base_denom,
    property,
    trace_types
  );

}


export function getAssetSymbol(envChainName, zone_asset, purpose) {

  const property = "symbol";
  let trace_types = [];

  let asset = zone_asset;

  if (
    purpose === osmosis_zone_frontend_assetlist ||
    purpose === osmosis_zone_frontend_asset_detail
  ) {

    //for osmosis zone, the symbol should first be the override value, if provided
    if (zone_asset.override_properties?.symbol) {
      return zone_asset.override_properties?.symbol;
    }

    trace_types = [
      "ibc",
      "ibc-cw20",
      "additional-mintage",
      "test-mintage"
    ];

    //or, use the canonical
    if (zone_asset.canonical) {
      asset = zone_asset.canonical;
    }

  } else if (purpose === chain_registry_osmosis_assetlist) {

    if (asset.chain_name !== envChainName) { return; }

    trace_types = [
      "additional-mintage"
    ];

  } else {
    console.log("Invalid purpose: ${purpose}");
  }

  return chain_reg.getAssetPropertyWithTraceCustom(
    asset.chain_name,
    asset.base_denom,
    property,
    trace_types
  );

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

export async function getLocalAsset(zone_asset, envChainName) {

  if (zone_asset.chain_name === envChainName) {
    return {
      chain_name: zone_asset.chain_name,
      base_denom: zone_asset.base_denom
    }
  }

  if (!zone_asset.path) {
    console.log("No path provided.");
    return;
  }

  try {
    let ibcHash = await zone.calculateIbcHash(zone_asset.path);
    return {
      chain_name: envChainName,
      base_denom: ibcHash
    }
  } catch (error) {
    console.error(error);
  }

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

}


export function getCanonicalAsset(zone_asset, source_asset) {

  if (zone_asset.canonical) {
    return {
      chain_name: zone_asset.canonical.chain_name,
      base_denom: zone_asset.canonical.base_denom
    }
  }

  return source_asset;

}

export function setCanonicalAsset(asset_data) {
  
  if (
    !asset_data.zone_asset.canonical?.chain_name ||
    !asset_data.zone_asset.canonical?.base_denom
  ) {
    asset_data.canonical_asset = asset_data.source_asset;
    return;
  }
  
  if (
    asset_data.zone_asset.canonical.chain_name == asset_data.source_asset.chain_name &&
    asset_data.zone_asset.canonical.base_denom == asset_data.source_asset.base_denom
  ) {
    asset_data.canonical_asset = asset_data.source_asset;
  }
  else if (
    asset_data.zone_asset.canonical.chain_name == asset_data.local_asset.chain_name &&
    asset_data.zone_asset.canonical.base_denom == asset_data.local_asset.base_denom
  ) {
    asset_data.canonical_asset = asset_data.local_asset;
  }
  else {
    asset_data.canonical_asset = {
      chain_name: asset_data.zone_asset.canonical.chain_name,
      base_denom: asset_data.zone_asset.canonical.base_denom
    }
  }

}


export function getSourceDenom(asset_pointers) {

  return asset_pointers.source_asset.base_denom;

}

export function setSourceDenom(asset_data) {

  asset_data.frontend.sourceDenom = asset_data.source_asset.base_denom;

}


export function getCoinMinimalDenom(asset_pointers) {

  return asset_pointers.local_asset.base_denom;

}

export function setCoinMinimalDenom(asset_data) {

  asset_data.frontend.coinMinimalDenom = asset_data.local_asset.base_denom;
  asset_data.chain_reg.coinMinimalDenom = asset_data.local_asset.base_denom;

}


export function getSymbol(zone_asset, asset_pointers, zone_config) {

  if (zone_asset.override_properties?.symbol) {
    return zone_asset.override_properties.symbol;
  }

  let symbol = chain_reg.getAssetProperty(
    asset_pointers.canonical_asset.chain_name,
    asset_pointers.canonical_asset.base_denom,
    "symbol"
  );

  const traces = chain_reg.getAssetProperty(
    asset_pointers.canonical_asset.chain_name,
    asset_pointers.canonical_asset.base_denom,
    "traces"
  );

  for (let i = (traces?.length || 0) - 1; i >= 0; i--) {
    if (traces[i].type === "bridge") {
      const bridge_provider = zone_config.providers.find(provider => provider.provider === traces[i].provider && provider.suffix);
      if (!bridge_provider) { break; }
      return symbol + bridge_provider.suffix;
    }
  }

  return symbol;

}

export function getAssetProperty(asset, propertyName) {
  if (!asset[propertyName]) {
    if(propertyName === "traces") {
      asset.traces = getAssetTraces(asset);
    } else {
      asset[propertyName] = chain_reg.getAssetProperty(
        asset.chain_name,
        asset.base_denom,
        propertyName
      );
    }
  }
  return asset[propertyName];
}

export function setSymbol(asset_data) {

  if (asset_data.zone_asset.override_properties?.symbol) {
    asset_data.frontend.symbol = asset_data.zone_asset.override_properties.symbol;
    asset_data.chain_reg.symbol = asset_data.zone_asset.override_properties.symbol;
    return;
  }

  asset_data.canonical_asset.symbol = chain_reg.getAssetProperty(
    asset_data.canonical_asset.chain_name,
    asset_data.canonical_asset.base_denom,
    "symbol"
  );

  let symbol = asset_data.canonical_asset.symbol;

  const traces = getAssetProperty(asset_data.canonical_asset, "traces");

  for (let i = (traces?.length || 0) - 1; i >= 0; i--) {
    if (traces[i].type === "bridge") {
      const bridge_provider = asset_data.zone_config.providers.find(
        provider =>
          provider.provider === traces[i].provider && provider.suffix
      );
      if (bridge_provider) {
        symbol = symbol + bridge_provider.suffix;
        break;
      }
    }
  }

  asset_data.frontend.symbol = symbol;
  asset_data.chain_reg.symbol = symbol;

}

export function getAssetDecimals(asset) {

  if (asset.decimals) {
    return asset.decimals;
  }

  let decimals;

  getAssetProperty(asset, "denom_units")?.forEach((unit) => {
    if (getAssetProperty(asset, "display") === unit.denom) {
      decimals = unit.exponent;
      return;
    }
  });

  if (decimals === undefined) {
    asset.denom_units?.forEach((unit) => {
      if (unit.aliases?.includes(asset.display)) {
        decimals = unit.exponent;
        return;
      }
    });
  }

  return decimals;

}

export function getAssetTraces(asset) {

  let lastTrace = {};
  lastTrace.counterparty = {
    chain_name: asset.chain_name,
    base_denom: asset.base_denom
  };
  let traces;
  let fullTraces = [];

  while (lastTrace) {
    traces = chain_reg.getAssetProperty(lastTrace.counterparty.chain_name, lastTrace.counterparty.base_denom, "traces");
    if (traces) {
      lastTrace = traces?.[traces.length - 1];
      fullTraces.push(lastTrace);
    } else {
      lastTrace = undefined;
    }
  }

  fullTraces.reverse(); 
  return fullTraces;

}

export function setDecimals(asset_data) {

  asset_data.frontend.decimals = getAssetDecimals(asset_data.local_asset) ?? getAssetDecimals(asset_data.source_asset);

}

export function setLogoURIs(asset_data) {
  
  let logo_URIs;

  if (asset_data.zone_asset.override_properties?.logo_URIs) {
    logo_URIs = asset_data.zone_asset.override_properties.logo_URIs;
  } else if (asset_data.zone_asset.canonical) {
    logo_URIs = getAssetProperty(asset_data.canonical_asset, "logo_URIs");
  } else {
    logo_URIs = getAssetProperty(asset_data.local_asset, "logo_URIs") ?? getAssetProperty(asset_data.source_asset, "logo_URIs");
  }

  asset_data.frontend.logoURIs = logo_URIs;
  asset_data.chain_reg.logo_URIs = logo_URIs;

}

export function setCoinGeckoId(asset_data) {

  let trace_types = [];

  if (asset_data.source_asset.chain_name === asset_data.chainName) {

    trace_types = [
      "additional-mintage"
    ];

    asset_data.chain_reg.coingecko_id = chain_reg.getAssetPropertyWithTraceCustom(
      asset_data.source_asset.chain_name,
      asset_data.source_asset.base_denom,
      "coingecko_id",
      trace_types
    );

  }

  if (asset_data.zone_asset.override_properties?.coingecko_id) {
    asset_data.frontend.coingeckoId = asset_data.zone_asset.override_properties?.coingecko_id;
    return;
  }

  trace_types = [
    "ibc",
    "ibc-cw20",
    "additional-mintage",
    "test-mintage"
  ];

  asset_data.frontend.coingeckoId = chain_reg.getAssetPropertyWithTraceCustom(
    asset_data.canonical_asset.chain_name,
    asset_data.canonical_asset.base_denom,
    "coingecko_id",
    trace_types
  );

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

  asset_data.frontend.listingDate = asset_data.zone_asset?.listing_date_time_utc;

}

export function setCategories(asset_data) {

  asset_data.frontend.categories = asset_data.zone_asset?.categories;
  if (!asset_data.frontend.categories) {
    asset_data.frontend.categories = [];
  }
  if (asset_data.frontend.pegMechanism) {
    addArrayItem("stablecoin", asset_data.frontend.categories);
    addArrayItem("defi", asset_data.frontend.categories);
  }
  getAssetProperty(asset_data.canonical_asset, "traces")?.forEach((trace) => {
    if (trace.type == "liquid-stake") {
      addArrayItem("liquid_staking", asset_data.frontend.categories);
      addArrayItem("defi", asset_data.frontend.categories);
      return;
    }
  });
  if (
    chain_reg.getFileProperty(asset_data.canonical_asset.chain_name, "chain", "fees")?.fee_tokens[0]?.denom ==
    asset_data.canonical_asset.base_denom
  ) {
    addArrayItem("defi", asset_data.frontend.categories);
  }
  if (
    chain_reg.getFileProperty(asset_data.canonical_asset.chain_name, "chain", "staking")?.staking_tokens[0]?.denom ==
    asset_data.canonical_asset.base_denom
  ) {
    addArrayItem("defi", asset_data.frontend.categories);
  }
  if (
    asset_data.frontend.categories.length <= 0 &&
    (
      asset_data.canonical_asset.base_denom.substring(0, 7) === "factory" ||
      asset_data.canonical_asset.base_denom.substring(0, 5) === "cw20:"
    )
  ) {
    addArrayItem("meme", asset_data.frontend.categories);
  }

}

export function setPegMechanism(asset_data) {

  asset_data.frontend.pegMechanism = asset_data.zone_asset?.peg_mechanism;

}

export function setChainName(asset_data) {

  asset_data.frontend.chainName = asset_data.source_asset.chain_name;

}

export function setName(asset_data) {

  let name;

  if (asset_data.zone_asset?.override_properties?.name) {
    name = asset_data.zone_asset?.override_properties?.name;
    asset_data.frontend.name = name;
    asset_data.chain_reg.name = name;
    return;
  }

  //  but use chain name instead if it's the staking token...
  if (
    chain_reg.getFileProperty(asset_data.canonical_asset.chain_name, "chain", "staking")?.staking_tokens[0]?.denom ==
    asset_data.canonical_asset.base_denom
  ) {
    name = chain_reg.getFileProperty(asset_data.canonical_asset.chain_name, "chain", "pretty_name");
  } else {
    name = getAssetProperty(asset_data.canonical_asset, "name");
  }

  const traces = getAssetProperty(asset_data.canonical_asset, "traces");
  if (!traces) {
    asset_data.frontend.name = name;
    asset_data.chain_reg.name = name;
    return;
  }

  const trace_types = [
    "ibc",
    "ibc-cw20"
  ];

  let bridge_provider;

  for (let i = traces?.length - 1; i >= 0; i--) {
    if (trace_types.includes(traces[i].type)) { continue; }
    if (traces[i].type === "bridge") {
      bridge_provider = traces[i].provider;
    }
    break;
  }

  if (bridge_provider && !name.includes(bridge_provider)) {
    name = name + " " + "(" + bridge_provider + ")";
  }
  asset_data.frontend.name = name;
  asset_data.chain_reg.name = name;

}

export function setVariantGroupKey(asset_data) {

  

  const trace_types = [
    "ibc",
    "ibc-cw20",
    "bridge",
    "wrapped",
    "additional-mintage",
  ];

  let traces = getAssetProperty(asset_data.source_asset, "traces");

  let lastTrace = {};
  lastTrace.counterparty = {
    chain_name: asset_data.source_asset.chain_name,
    base_denom: asset_data.source_asset.base_denom
  };

  let numBridgeHops = 0;

  for (let i = traces?.length - 1; i >= 0; i--) {

    if (!trace_types.includes(traces[i].type)) { break; }
    if (traces[i].type === "bridge") {
      if(numBridgeHops) { break; }
      numBridgeHops += 1;
    }
    lastTrace = traces[i];

  }

  if (
    asset_data.source_asset.chain_name === asset_data.chainName &&
    traces.length === 0
  ) {
    //asset_data.frontend.variantGroupKey = getAssetProperty(asset_data.source_asset, "symbol");
    return;
  }

  asset_data.frontend.variantGroupKey = getAssetProperty(
    {
      chain_name: lastTrace.counterparty?.chain_name,
      base_denom: lastTrace.counterparty?.base_denom
    },
    "symbol"
  );

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


//chain name
//asset name
//variant group key, hmmm
//price
//counterparty
//transfer methods
//type_asset