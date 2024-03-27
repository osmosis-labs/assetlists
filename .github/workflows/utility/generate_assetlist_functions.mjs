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

export function getAssetDecimals(asset) {

  let decimals;

  asset.denom_units.forEach((unit) => {
    if (asset.display === unit.denom) {
      decimals = unit.exponent;
      return;
    }
  });

  if (decimals === undefined) {
    asset.denom_units.forEach((unit) => {
      if (unit.aliases?.includes(asset.display)) {
        decimals = unit.exponent;
        return;
      }
    });
  }

  if (decimals === undefined) {
    console.log("Error: $" + asset.symbol + " missing decimals!");
  }

  return decimals ?? 0;

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


export function getCanonicalAsset(zone_asset, source_asset) {

  if (zone_asset.canonical) {
    return {
      chain_name: zone_asset.canonical.chain_name,
      base_denom: zone_asset.canonical.base_denom
    }
  }

  return source_asset;

}


export function getSourceDenom(asset_pointers) {

  return asset_pointers.source_asset.base_denom;

}



export function getCoinMinimalDenom(asset_pointers) {

  return asset_pointers.local_asset.base_denom;

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