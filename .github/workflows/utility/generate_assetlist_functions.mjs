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

  let traces = getAssetProperty(asset_data.source_asset, "traces");
  if (!traces || traces?.length <= 0) {
    traces = [];
  }
  const trace = getAssetTrace(asset_data);
  traces.push(trace);
  asset_data.local_asset.traces = traces;

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


export function setSourceDenom(asset_data) {

  asset_data.frontend.sourceDenom = asset_data.source_asset.base_denom;

}


export function setCoinMinimalDenom(asset_data) {

  asset_data.frontend.coinMinimalDenom = asset_data.local_asset.base_denom;
  asset_data.chain_reg.coinMinimalDenom = asset_data.local_asset.base_denom;

}


export function getAssetProperty(asset, propertyName) {
  if (!asset[propertyName]) {
    if (propertyName === "traces") {
      asset.traces = getAssetTraces(asset);
    } else if (propertyName === "decimals") {
      asset.decimals = getAssetDecimals(asset);
    } else if (propertyName === "is_staking") {
      asset.is_staking = getAssetIsStaking(asset);
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

  while (lastTrace) {
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

  let primaryImage = asset_data.zone_asset?.override_properties?.logo_URIs ?? images?.[0];

  asset_data.frontend.logoURIs = {...primaryImage};
  delete asset_data.frontend.logoURIs.theme;
  delete asset_data.frontend.logoURIs.image_sync;

  asset_data.chain_reg.logo_URIs = getAssetProperty(asset_data.local_asset, "logo_URIs");

  asset_data.chain_reg.images = images;

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

export function setKeywords(asset_data) {

  let keywords = getAssetProperty(asset_data.canonical_asset, "keywords") || [];

  //--Update Keywords--
  if (asset_data.zone_asset?.osmosis_unstable) {
    addArrayItem("osmosis_unstable", keywords);
  }
  if (asset_data.zone_asset?.osmosis_unlisted) {
    addArrayItem("osmosis_unlisted", keywords);
  }
  if (asset_data.zone_asset?.verified) {
    addArrayItem("osmosis_verified", keywords);
  }
  if (!keywords.length) {
    keywords = undefined;
  }

  asset_data.chain_reg.keywords = keywords;

}

export function setVerifiedStatus(asset_data) {

  asset_data.frontend.verified = asset_data.zone_asset?.osmosis_verified;

}

export function setUnstableStatus(asset_data) {

  asset_data.frontend.unstable = asset_data.zone_asset?.osmosis_unstable;

}

export function setDisabledStatus(asset_data) {

  asset_data.frontend.disabled = asset_data.zone_asset?.osmosis_disabled || asset_data.zone_asset?.osmosis_unstable;

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

export function setCounterparty(asset_data) {

  const traces = getAssetProperty(asset_data.local_asset, "traces");

  const trace_types = [
    "ibc",
    "ibc-cw20",
    "bridge",
    "wrapped",
    //remove additnioal mintage later
    "additional-mintage"
  ];

  let numBridgeHops = 0;

  asset_data.frontend.counterparty = [];
  let counterpartyAsset;
  let evm_chain;

  for (let i = traces?.length - 1; i >= 0; i--) {

    if (!trace_types.includes(traces[i].type)) { break; }
    if (traces[i].type === "bridge") {
      if(numBridgeHops) { break; }
      numBridgeHops += 1;
    }

    counterpartyAsset = {
      chainName: traces[i].counterparty.chain_name,
      sourceDenom: traces[i].counterparty.base_denom
    }

    const cosmosChainId = chain_reg.getFileProperty(
        traces[i].counterparty.chain_name,
        "chain",
        "chain_id"
      );
    if (cosmosChainId) {
      counterpartyAsset.chainType = "cosmos";
      counterpartyAsset.chainId = cosmosChainId;
    } else {
      evm_chain = asset_data.zone_config.evm_chains?.find((evm_chain) => {
        return evm_chain.chain_name === traces[i].counterparty.chain_name;
      });
      if (evm_chain) {
        counterpartyAsset.chainType = "evm";
        counterpartyAsset.chainId = evm_chain.chain_id;
        counterpartyAsset.address = chain_reg.getAssetProperty(
          traces[i].counterparty.chain_name,
          traces[i].counterparty.base_denom,
          "address");
        if (!counterpartyAsset.address) {
          counterpartyAsset.address = zero_address;
        }
      } else {
        counterpartyAsset.chainType = "non-cosmos";
      }
    }
    counterpartyAsset.symbol = chain_reg.getAssetProperty(
      traces[i].counterparty.chain_name,
      traces[i].counterparty.base_denom,
      "symbol"
    );
    counterpartyAsset.decimals = getAssetDecimals(traces[i].counterparty);
    counterpartyAsset.logoURIs = chain_reg.getAssetProperty(
      traces[i].counterparty.chain_name,
      traces[i].counterparty.base_denom,
      "logo_URIs"
    );

    asset_data.frontend.counterparty.push(counterpartyAsset);

  }

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

    } else if (transferMethod.type === bridge) {

      transferMethod.counterparty.forEach((counterparty) => {
        asset_data.zone_config.evm_chains.some((evm_chain) => {
          if (evm_chain.chain_name === counterparty.chain_name) {
            counterparty.evmChainId = evm_chain.chain_id;
          }
        });
        asset_data.zone_config.providers.some((provider) => {
          if (provider.integration === transferMethod.name) {
            provider.api_keys?.sourceChainIds?.some((sourceChainId) => {
              if (sourceChainId.chain_name === counterparty.chain_name) {
                counterparty.sourceChainId = sourceChainId.sourceChainId;
              }
            });
          }
        });
        delete counterparty.chain_name;
      });

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
  asset_data.asset_detail.socials = getAssetProperty(asset_data.canonical_asset, "socials");

}

export function setDescription(asset_data) {

  //asset_data.chain_reg.description = getAssetProperty(asset_data.local_asset, "description");
  asset_data.chain_reg.extended_description = getAssetProperty(asset_data.local_asset, "extended_description");

  let description;
  description = getAssetProperty(asset_data.local_asset, "description") || getAssetProperty(asset_data.canonical_asset, "description");
  if (description) {
    asset_data.chain_reg.description = description;
  }

  //description = getAssetProperty(asset_data.canonical_asset, "description");

  if (getAssetProperty(asset_data.canonical_asset, "is_staking")) {
    const chain_description = chain_reg.getFileProperty(
      asset_data.canonical_asset.chain_name,
      "chain",
      "description"
    );
    //console.log(chain_description);
    description = (description ?? "") + (description && chain_description ? "\n\n" : "") + (chain_description ?? "");
  }

  //asset_data.chain_reg.description = description;
  asset_data.asset_detail.description = description;

  //console.log(description);

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
    verified: asset_data.frontend.verified ?? false,
    unstable: asset_data.frontend.unstable ?? false,
    disabled: asset_data.frontend.disabled ?? false,
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
