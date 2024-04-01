// Purpose:
//   to generate the zone_config json using the zone json and chain registry data

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
import * as zone from "./assetlist_functions.mjs";
import { getAssetsPricing } from "./getPools.mjs";
import { getAllRelatedAssets } from "./getRelatedAssets.mjs";
import * as assetlist from "./generate_assetlist_functions.mjs";

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

//This defines how many days since listing qualifies an asset as a "New Asset"
const daysForNewAssetCategory = 21;

//-- Functions --

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

function addArrayItem(item, array) {
  if (!array.includes(item)) {
    array.push(item);
  }
}

function getAssetDecimals(asset) {

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


const generateAssets = async (
  chainName,
  zoneConfig,
  zone_assets,
  zone_config_assets,
  chain_reg_assets
) => {
  let pool_assets;
  pool_assets = await getAssetsPricing(chainName);
  if (!pool_assets) {
    return;
  }

  await asyncForEach(zone_assets, async (zone_asset) => {

    //--Create the Generated Asset Objects--
    let generated_asset = {};


    //--Establish Key Asset Pointers--
    let asset_pointers = {};

    //--Establish Asset Data--
    let asset_data = {
      chainName: chainName,
      zone_config: zoneConfig,
      zone_asset: zone_asset
    }

    //source_asset (e.g., uosmo, uatom, uusdc on noble, pstake on persistence)
    asset_pointers.source_asset = {
      chain_name: zone_asset.chain_name,
      base_denom: zone_asset.base_denom
    }

    assetlist.setSourceAsset(asset_data);

    if (
      asset_pointers.source_asset.chain_name != asset_data.source_asset.chain_name ||
      asset_pointers.source_asset.base_denom != asset_data.source_asset.base_denom 
    ) {
      console.log("Source Asset Mismatch: ");
      console.log(asset_pointers.source_asset);
      console.log(asset_data.source_asset);
    }

    //local_asset (e.g., uosmo, ibc/27..., factory/.../milkTIA, ...)
    asset_pointers.local_asset = await assetlist.getLocalAsset(zone_asset, chainName);

    await assetlist.setLocalAsset(asset_data);

    if (
      asset_pointers.local_asset.chain_name != asset_data.local_asset.chain_name ||
      asset_pointers.local_asset.base_denom != asset_data.local_asset.base_denom
    ) {
      console.log("Local Asset Mismatch: ");
      console.log(asset_pointers.local_asset);
      console.log(asset_data.local_asset);
    }

    //canonical_asset (e.g., pstake on Ethereum, usdc on ethereum)
    asset_pointers.canonical_asset = assetlist.getCanonicalAsset(zone_asset, asset_pointers.source_asset);

    assetlist.setCanonicalAsset(asset_data);

    if (
      asset_pointers.canonical_asset.chain_name != asset_data.canonical_asset.chain_name ||
      asset_pointers.canonical_asset.base_denom != asset_data.canonical_asset.base_denom
    ) {
      console.log("Canonical Asset Mismatch: ");
      console.log(asset_pointers.canonical_asset);
      console.log(asset_data.canonical_asset);
    }

    //--Establish Key Asset Objects--
    let frontend_asset = {};
    let chain_reg_asset = {};

    asset_data.frontend = {};
    asset_data.chain_reg = {};

    //  this will go into [chain_reg] assetlist
    let generated_chainRegAsset = {};

    //--Identity (Chain Registry Pointer)--
    generated_asset.chain_name = zone_asset.chain_name;
    generated_asset.base_denom = zone_asset.base_denom;

    //--sourceDenom--
    generated_asset.sourceDenom = zone_asset.base_denom;

    assetlist.setSourceDenom(asset_data);

    if (
      generated_asset.sourceDenom != asset_data.frontend.sourceDenom
    ) {
      console.log("Source Denom Mismatch: ");
      console.log(generated_asset.sourceDenom);
      console.log(asset_data.frontend.sourceDenom);
    }

    frontend_asset.sourceDenom = assetlist.getSourceDenom(asset_pointers);
    frontend_asset.coinMinimalDenom = assetlist.getCoinMinimalDenom(asset_pointers);

    assetlist.setCoinMinimalDenom(asset_data);

    if (
      frontend_asset.coinMinimalDenom != asset_data.frontend.coinMinimalDenom
    ) {
      console.log("Coin Minimal Mismatch: ");
      console.log(frontend_asset.coinMinimalDenom);
      console.log(asset_data.frontend.coinMinimalDenom);
    }

    //--Get Origin Asset Object from Chain Registry--
    let origin_asset = chain_reg.getAssetObject(
      zone_asset.chain_name,
      zone_asset.base_denom
    );

    //--Get Local Asset Object from Chain Registry--
    //--coinMinimalDenom (Denomination of the Asset when on the local chain)
    //---e.g., OSMO on Osmosis -> uosmo
    //---e.g., ATOM os Osmosis -> ibc/...
    let local_asset;
    if (zone_asset.chain_name != chainName) {
      let ibcHash = zone.calculateIbcHash(zone_asset.path); //Calc IBC Hash Denom
      generated_asset.coinMinimalDenom = await ibcHash; //Set IBC Hash Denom
      local_asset = chain_reg.getAssetObject(
        chainName,
        generated_asset.coinMinimalDenom
      );
    } else {
      generated_asset.coinMinimalDenom = zone_asset.base_denom;
    }
    let asset = local_asset || origin_asset;

    //--Get Canonical Asset from Chain Registry--
    //  used to override certain properties if this local variant is
    //  the canonical representation of a foreign asset
    let canonical_origin_asset = origin_asset;
    let canonical_origin_chain_name = zone_asset.chain_name;
    if (zone_asset.canonical) {
      canonical_origin_chain_name = zone_asset.canonical.chain_name;
      canonical_origin_asset = chain_reg.getAssetObject(
        zone_asset.canonical.chain_name,
        zone_asset.canonical.base_denom
      );
    }

    //--Set Reference Asset--
    //  used to refer to what the asset represents, and allows for
    //  potential overrides defined in the local chain's assetlist
    let reference_asset = asset;
    if (!local_asset && canonical_origin_asset) {
      reference_asset = canonical_origin_asset;
    }

    //--Get Symbol
    generated_asset.symbol = reference_asset.symbol;
    
    frontend_asset.symbol = assetlist.getSymbol(zone_asset, asset_pointers, zoneConfig);

    assetlist.setSymbol(asset_data);
    

    //--Get Decimals--
    generated_asset.decimals = assetlist.getAssetDecimals(asset);

    assetlist.setDecimals(asset_data);

    if (
      generated_asset.decimals != asset_data.frontend.decimals
    ) {
      console.log("Decimals Mismatch: ");
      console.log(generated_asset.decimals);
      console.log(asset_data.frontend.decimals);
    }


    //--Get Logos--
    generated_asset.logo_URIs = reference_asset.logo_URIs;
    let images = reference_asset.images;


    assetlist.setLogoURIs(asset_data);

    


    //--Get CGID--
    generated_asset.coingecko_id = assetlist.getAssetCoinGeckoID(chainName, zone_asset, assetlist.osmosis_zone_frontend_assetlist);

    assetlist.setCoinGeckoId(asset_data);


    //--Get Verified Status--
    generated_asset.verified = zone_asset.osmosis_verified;

    assetlist.setVerifiedStatus(asset_data);
    assetlist.setUnstableStatus(asset_data);
    assetlist.setDisabledStatus(asset_data);
    assetlist.setPreviewStatus(asset_data);

    //--Get Best Pricing Reference Pool--
    let denom = generated_asset.coinMinimalDenom;
    if (pool_assets?.get(denom)) {
      generated_asset.api_include = pool_assets.get(denom).osmosis_info;
      let price = "";
      price = pool_assets.get(denom).osmosis_price;
      if (price) {
        let price_parts = price.split(":");
        generated_asset.price = {
          poolId: price_parts[2],
          denom: price_parts[1],
        };
      }
    }

    //--Staking token?--
    //  used to get name and description
    generated_asset.is_staking_token = false;
    if (
      zone_asset.base_denom ==
      chain_reg.getFileProperty(canonical_origin_chain_name, "chain", "staking")
        ?.staking_tokens[0]?.denom
    ) {
      generated_asset.is_staking_token = true;
    }

    //--Fee token?--
    generated_asset.is_native_fee_token = false;
    if (
      zone_asset.base_denom ==
      chain_reg.getFileProperty(canonical_origin_chain_name, "chain", "fees")
        ?.fee_tokens[0]?.denom
    ) {
      generated_asset.is_native_fee_token = true;
    }

    //--Get Listing Date--
    generated_asset.listing_date = new Date(zone_asset.listing_date_time_utc);

    //--Get Categories--
    let categories = [];
    if (zone_asset.categories) {
      categories = zone_asset.categories;
    }

    //-Stablecoin?-
    if (zone_asset.peg_mechanism) {
      addArrayItem("stablecoin", categories);
      addArrayItem("defi", categories);
    }

    //-LST/LSD-
    let traces = chain_reg.getAssetTraces(
      zone_asset.chain_name,
      zone_asset.base_denom
    );
    traces?.forEach((trace) => {
      if (trace.type == "liquid-stake") {
        addArrayItem("liquid_staking", categories);
        addArrayItem("defi", categories);
        return;
      }
    });

    //-New Asset?-
    const currentDate = new Date();
    // Calculate the difference in milliseconds between the current date and the listing date
    let differenceInMilliseconds = currentDate - generated_asset.listing_date;
    // Calculate the difference in weeks
    let differenceInDays = differenceInMilliseconds / (1000 * 60 * 60 * 24);
    if (differenceInDays <= daysForNewAssetCategory) {
      //addArrayItem("new_asset", categories);
    }

    //-DeFi-
    //-staking-
    if (
      (generated_asset.is_staking_token ||
        generated_asset.is_native_fee_token) &&
      categories.length == 0
    ) {
      addArrayItem("defi", categories);
    }

    //-Meme-
    generated_asset.is_native_at_canonical_origin = true;
    let first_5_chars = canonical_origin_asset.base.substring(0, 5);
    if (first_5_chars == "facto" || first_5_chars == "cw20:") {
      generated_asset.is_native_at_canonical_origin = false;
    }
    let has_no_categories = categories.length <= 0 ? true : false;
    if (
      categories.length <= 0 &&
      !generated_asset.is_native_at_canonical_origin
    ) {
      addArrayItem("meme", categories);
    }

    if (generated_asset.categories != asset_data.frontend.categories) {
      console.log("Category Mismatch: ");
      console.log(generated_asset.categories);
      console.log(asset_data.frontend.categories);
    }

    //-Save Asset's Categories-
    generated_asset.categories = categories.length > 0 ? categories : undefined;

    //--Get Peg Mechanism--
    generated_asset.peg_mechanism = zone_asset.peg_mechanism;

    //--Process Transfer Methods--
    //generated_asset.transfer_methods = zone_asset.transfer_methods;
    generated_asset.transfer_methods = zone_asset.transfer_methods ? zone_asset.transfer_methods.map(obj => ({ ...obj })) : undefined;
    //console.log(generated_asset.transfer_methods);

    generated_asset.transfer_methods?.forEach((transfer_method) => {
      if (transfer_method.type == "integrated_bridge") {
        transfer_method.counterparty.forEach((counterparty) => {
          zoneConfig.evm_chains.some((evm_chain) => {
            if (evm_chain.chain_name == counterparty.chain_name) {
              counterparty.evmChainId = evm_chain.chain_id;
            }
          });
          zoneConfig.providers.some((provider) => {
            if (provider.integration == transfer_method.name) {
              provider.api_keys?.sourceChainIds?.some((sourceChainId) => {
                if (sourceChainId.chain_name == counterparty.chain_name) {
                  counterparty.sourceChainId = sourceChainId.sourceChainId;
                }
              });
            }
          });
          delete counterparty.chain_name;
        });
      }

      //-Replace snake_case with camelCase-
      transfer_method.depositUrl = transfer_method.deposit_url || undefined;
      delete transfer_method.deposit_url;
      transfer_method.withdrawUrl = transfer_method.withdraw_url || undefined;
      delete transfer_method.withdraw_url;
    });

    let bridge_provider = "";

    //--Get Traces--
    if (zone_asset.chain_name != chainName) {
      if (!traces) {
        traces = [];
      }

      //--Set Up Trace for IBC Transfer--

      let type = "ibc";
      if (zone_asset.base_denom.slice(0, 5) === "cw20:") {
        type = "ibc-cw20";
      }

      let counterparty = {
        chain_name: zone_asset.chain_name,
        base_denom: zone_asset.base_denom,
        port: "trans",
      };
      if (type === "ibc-cw20") {
        counterparty.port = "wasm.";
      }

      let chain = {
        port: "transfer",
      };

      //--Identify chain_1 and chain_2--
      let chain_1 = chain;
      let chain_2 = counterparty;
      let chainOrder = 0;
      if (zone_asset.chain_name < chainName) {
        chain_1 = counterparty;
        chain_2 = chain;
        chainOrder = 1;
      }

      //--Find IBC Connection--
      let channels = chain_reg.getIBCFileProperty(
        zone_asset.chain_name,
        chainName,
        "channels"
      );

      //--Find IBC Channel and Port Info--

      //--with Path--
      if (zone_asset.path) {
        let parts = zone_asset.path.split("/");
        chain.port = parts[0];
        chain.channel_id = parts[1];
        channels.forEach((channel) => {
          if (!chainOrder) {
            if (
              channel.chain_1.port_id === chain.port &&
              channel.chain_1.channel_id === chain.channel_id
            ) {
              counterparty.channel_id = channel.chain_2.channel_id;
              counterparty.port = channel.chain_2.port_id;
              return;
            }
          } else {
            if (
              channel.chain_2.port_id === chain.port &&
              channel.chain_2.channel_id === chain.channel_id
            ) {
              counterparty.channel_id = channel.chain_1.channel_id;
              counterparty.port = channel.chain_1.port_id;
              return;
            }
          }
        });

        //--without Path--
      } else {
        channels.forEach((channel) => {
          if (
            channel.chain_1.port_id.slice(0, 5) === chain_1.port.slice(0, 5) &&
            channel.chain_2.port_id.slice(0, 5) === chain_2.port.slice(0, 5)
          ) {
            chain_1.channel_id = channel.chain_1.channel_id;
            chain_2.channel_id = channel.chain_2.channel_id;
            chain_1.port = channel.chain_1.port_id;
            chain_2.port = channel.chain_2.port_id;
            return;
          }
        });
      }

      //--Add Path--
      if (traces.length > 0) {
        if (
          traces[traces.length - 1].type === "ibc" ||
          traces[traces.length - 1].type === "ibc-cw20"
        ) {
          if (traces[traces.length - 1].chain.path) {
            chain.path =
              chain.port +
              "/" +
              chain.channel_id +
              "/" +
              traces[traces.length - 1].chain.path;
          } else {
            console.log(zone_asset.base_denom + "Missing Path");
          }
        }
      }
      if (!chain.path) {
        if (
          zone_asset.base_denom.slice(0, 7) === "factory" &&
          zone_asset.chain_name === "kujira"
        ) {
          let baseReplacement = zone_asset.base_denom.replace(/\//g, ":");
          chain.path =
            chain.port + "/" + chain.channel_id + "/" + baseReplacement;
        } else {
          chain.path =
            chain.port + "/" + chain.channel_id + "/" + zone_asset.base_denom;
        }
      }

      //--Double Check Path--
      if (chain.path != zone_asset.path) {
        console.log(
          "Warning! Provided trace path does not match generated path."
        );
        console.log(zone_asset);
      }

      //--Create Trace Object--
      let trace = {
        type: type,
        counterparty: counterparty,
        chain: chain,
      };

      generated_asset.transfer_methods = generated_asset.transfer_methods || [];

      let comsos_chain_id = chain_reg.getFileProperty(
        zone_asset.chain_name,
        "chain",
        "chain_id"
      );

      let ibc_transfer_method = {
        name: "Osmosis IBC Transfer",
        type: "ibc",
        counterparty: {
          chainName: zone_asset.chain_name,
          chainId: comsos_chain_id,
          sourceDenom: zone_asset.base_denom,
          port: trace.counterparty.port,
          channelId: trace.counterparty.channel_id,
        },
        chain: {
          port: trace.chain.port,
          channelId: trace.chain.channel_id,
          path: trace.chain.path,
        },
      };
      generated_asset.transfer_methods.push(ibc_transfer_method);
      //generated_asset.transfer_methods.push(trace);



      //--Cleanup Trace--
      if (type === "ibc") {
        delete trace.chain.port;
        delete trace.counterparty.port;
      }

      traces.push(trace);

      //--Get Bridge Provider--
      if (!zone_asset.canonical) {
        traces?.forEach((trace) => {
          if (trace.type == "bridge") {
            bridge_provider = trace.provider;
            let providers = zoneConfig?.providers;
            if (providers) {
              providers.forEach((provider) => {
                if (provider.provider == bridge_provider && provider.suffix) {
                  if (!generated_asset.symbol.endsWith(provider.suffix)) {
                    generated_asset.symbol = generated_asset.symbol + provider.suffix;
                  }
                }
              });
            }
            return;
          }
        });
      }
    }

    assetlist.setTransferMethods(asset_data);

    if (
      generated_asset.transfer_methods?.length != asset_data.frontend.transferMethods?.length ||
      generated_asset.transfer_methods?.[0].name != asset_data.frontend.transferMethods?.[0].name ||
      generated_asset.transfer_methods?.[0].type != asset_data.frontend.transferMethods?.[0].type ||
      generated_asset.transfer_methods?.[0].counterparty?.chainName != asset_data.frontend.transferMethods?.[0].counterparty?.chainName ||
      generated_asset.transfer_methods?.[0].counterparty?.chainId != asset_data.frontend.transferMethods?.[0].counterparty?.chainId ||
      generated_asset.transfer_methods?.[0].counterparty?.sourceDenom != asset_data.frontend.transferMethods?.[0].counterparty?.sourceDenom ||
      generated_asset.transfer_methods?.[0].counterparty?.port != asset_data.frontend.transferMethods?.[0].counterparty?.port ||
      generated_asset.transfer_methods?.[0].counterparty?.channelId != asset_data.frontend.transferMethods?.[0].counterparty?.channelId ||
      generated_asset.transfer_methods?.[0].chain?.port != asset_data.frontend.transferMethods?.[0].chain?.port ||
      generated_asset.transfer_methods?.[0].chain?.channelId != asset_data.frontend.transferMethods?.[0].chain?.channelId ||
      generated_asset.transfer_methods?.[0].chain?.path != asset_data.frontend.transferMethods?.[0].chain?.path ||
      generated_asset.transfer_methods?.[0].depositUrl != asset_data.frontend.transferMethods?.[0].depositUrl ||
      generated_asset.transfer_methods?.[0].withdrawUrl != asset_data.frontend.transferMethods?.[0].withdrawUrl
    ) {
      console.log("Transfer Methods Mismatch: ");
      console.log(generated_asset.transfer_methods?.length != asset_data.frontend.transferMethods?.length);
      console.log(generated_asset.transfer_methods?.[0].name != asset_data.frontend.transferMethods?.[0].name);
      console.log(generated_asset.transfer_methods?.[0].type != asset_data.frontend.transferMethods?.[0].type);
      console.log(generated_asset.transfer_methods?.[0].counterparty?.chainName != asset_data.frontend.transferMethods?.[0].counterparty?.chainName);
      console.log(generated_asset.transfer_methods?.[0].counterparty?.chainId != asset_data.frontend.transferMethods?.[0].counterparty?.chainId);
      console.log(generated_asset.transfer_methods?.[0].counterparty?.sourceDenom != asset_data.frontend.transferMethods?.[0].counterparty?.sourceDenom);
      console.log(generated_asset.transfer_methods?.[0].counterparty?.port != asset_data.frontend.transferMethods?.[0].counterparty?.port);
      console.log(generated_asset.transfer_methods?.[0].counterparty?.channelId != asset_data.frontend.transferMethods?.[0].counterparty?.channelId);
      console.log(generated_asset.transfer_methods?.[0].chain?.port != asset_data.frontend.transferMethods?.[0].chain?.port);
      console.log(generated_asset.transfer_methods?.[0].chain?.channelId != asset_data.frontend.transferMethods?.[0].chain?.channelId);
      console.log(generated_asset.transfer_methods?.[0].chain?.path != asset_data.frontend.transferMethods?.[0].chain?.path);
      console.log(generated_asset.transfer_methods?.[0].depositUrl != asset_data.frontend.transferMethods?.[0].depositUrl);
      console.log(generated_asset.transfer_methods?.[0].withdrawUrl != asset_data.frontend.transferMethods?.[0].withdrawUrl);
      console.log(generated_asset.transfer_methods);
      console.log(asset_data.frontend.transferMethods);
    }

    //--Identify What the Token Represents--
    if (traces) {
      let last_trace = "";
      let bridge_uses = 0;
      //iterate each trace, starting from the bottom
      for (let i = traces.length - 1; i >= 0; i--) {
        if (!find_origin_trace_types.includes(traces[i].type)) {
          break;
        } else if (traces[i].type == "bridge" && bridge_uses) {
          break;
        } else {
          if (!generated_asset.counterparty) {
            generated_asset.counterparty = [];
          }
          last_trace = traces[i];
          let counterparty = {
            chainName: last_trace.counterparty.chain_name,
            sourceDenom: last_trace.counterparty.base_denom,
          };
          if (last_trace.type == "bridge") {
            bridge_uses += 1;
          }
          let comsos_chain_id = chain_reg.getFileProperty(
            last_trace.counterparty.chain_name,
            "chain",
            "chain_id"
          );
          if (comsos_chain_id) {
            counterparty.chainType = "cosmos";
            counterparty.chainId = comsos_chain_id;
          } else {
            zoneConfig?.evm_chains?.forEach((evm_chain) => {
              if (evm_chain.chain_name == last_trace.counterparty.chain_name) {
                counterparty.chainType = "evm";
                counterparty.chainId = evm_chain.chain_id;
                counterparty.address = chain_reg.getAssetProperty(
                  last_trace.counterparty.chain_name,
                  last_trace.counterparty.base_denom,
                  "address"
                );
                if (!counterparty.address) {
                  counterparty.address = zero_address;
                }
                return;
              }
            });
            if (!counterparty.chainType) {
              counterparty.chainType = "non-cosmos";
            }
          }
          counterparty.symbol = chain_reg.getAssetProperty(
            last_trace.counterparty.chain_name,
            last_trace.counterparty.base_denom,
            "symbol"
          );
          let display = chain_reg.getAssetProperty(
            last_trace.counterparty.chain_name,
            last_trace.counterparty.base_denom,
            "display"
          );
          let denom_units = chain_reg.getAssetProperty(
            last_trace.counterparty.chain_name,
            last_trace.counterparty.base_denom,
            "denom_units"
          );
          counterparty.decimals = assetlist.getAssetDecimals({display: display, denom_units: denom_units});
          counterparty.logoURIs = chain_reg.getAssetProperty(
            last_trace.counterparty.chain_name,
            last_trace.counterparty.base_denom,
            "logo_URIs"
          );
          generated_asset.counterparty.push(counterparty);
        }
      }
      if (last_trace) {
        generated_asset.common_key = chain_reg.getAssetProperty(
          last_trace.counterparty.chain_name,
          last_trace.counterparty.base_denom,
          "symbol"
        );
      }
    }

    assetlist.setCounterparty(asset_data);

    if (
      generated_asset.counterparty?.length != asset_data.frontend.counterparty?.length ||
      generated_asset.counterparty?.[0].chainName != asset_data.frontend.counterparty?.[0].chainName ||
      generated_asset.counterparty?.[0].sourceDenom != asset_data.frontend.counterparty?.[0].sourceDenom ||
      generated_asset.counterparty?.[0].chainType != asset_data.frontend.counterparty?.[0].chainType ||
      generated_asset.counterparty?.[0].chainId != asset_data.frontend.counterparty?.[0].chainId ||
      generated_asset.counterparty?.[0].address != asset_data.frontend.counterparty?.[0].address ||
      generated_asset.counterparty?.[0].symbol != asset_data.frontend.counterparty?.[0].symbol ||
      generated_asset.counterparty?.[0].decimals != asset_data.frontend.counterparty?.[0].decimals ||
      generated_asset.counterparty?.[0].logoURIs.png != asset_data.frontend.counterparty?.[0].logoURIs.png ||
      generated_asset.counterparty?.[0].logoURIs.svg != asset_data.frontend.counterparty?.[0].logoURIs.svg

    ) {
      console.log("Counterparty Mismatch: ");
      console.log(generated_asset.symbol);
      console.log(generated_asset.counterparty);
      console.log(asset_data.frontend.counterparty);
    }

    assetlist.setVariantGroupKey(asset_data);

    if (
      generated_asset.common_key != asset_data.frontend.variantGroupKey
    ) {
      console.log("Variant Group Key Mismatch: ");
      console.log(generated_asset.common_key);
      console.log(asset_data.frontend.variantGroupKey);
    }

    let denom_units = chain_reg.getAssetProperty(
      zone_asset.chain_name,
      zone_asset.base_denom,
      "denom_units"
    );
    if (zone_asset.chain_name != chainName) {
      denom_units.forEach(async function (unit) {
        if (unit.denom === zone_asset.base_denom) {
          if (!unit.aliases) {
            unit.aliases = [];
          }
          addArrayItem(unit.denom, unit.aliases);
          if (asset.display == unit.denom) {
            asset.display = generated_asset.coinMinimalDenom;
          }
          unit.denom = generated_asset.coinMinimalDenom;
          return;
        }
      });
    }

    //--Add Name--
    //  default to reference asset's name...
    //  default to reference asset's name...
    let name = reference_asset.name;

    //  but use chain name instead if it's the staking token...
    if (generated_asset.is_staking_token) {
      name = chain_reg.getFileProperty(
        canonical_origin_chain_name,
        "chain",
        "pretty_name"
      );
    }

    // and append bridge provider if it's not already there
    if (bridge_provider) {
      if (!name.includes(bridge_provider)) {
        name = name + " " + "(" + bridge_provider + ")";
      }
    }

    //  submit
    generated_asset.name = name;

    assetlist.setName(asset_data);

    //--Add Description--
    let asset_description = reference_asset.description;
    let description = asset_description ? asset_description : "";
    //need to see if it's first staking token
    if (generated_asset.is_staking_token) {
      //it is a staking token, so we pull the chain_description
      let chain_description = chain_reg.getFileProperty(
        canonical_origin_chain_name,
        "chain",
        "description"
      );
      if (chain_description) {
        if (description) {
          description = description + "\n\n";
        }
        description = description + chain_description;
      }
    }
    generated_asset.description = description;

    //--Get Twitter URL--
    generated_asset.twitter_URL = zone_asset.twitter_URL;

    //--Sorting--
    //how to sort tokens if they don't have cgid
    if (!generated_asset.coingecko_id && !zone_asset.canonical) {
      traces?.forEach((trace) => {
        if (trace.provider) {
          let providers = zoneConfig?.providers;
          if (providers) {
            providers.forEach((provider) => {
              if (provider.provider == trace.provider && provider.token) {
                generated_asset.sort_with = {
                  chainName: provider.token.chain_name,
                  sourceDenom: provider.token.base_denom,
                };
                return;
              }
            });
          }
        }
      });
    }

    //--Overrides Properties when Specified--
    if (zone_asset.override_properties) {
      //if (zone_asset.override_properties.coingecko_id) {
        //generated_asset.coingecko_id =
          //zone_asset.override_properties.coingecko_id;
      //}
      if (zone_asset.override_properties.symbol) {
        generated_asset.symbol = zone_asset.override_properties.symbol;
      }
      if (zone_asset.override_properties.name) {
        generated_asset.name = zone_asset.override_properties.name;
      }
      if (zone_asset.override_properties.logo_URIs) {
        generated_asset.logo_URIs = zone_asset.override_properties.logo_URIs;
      }
    }

    

    if (
      generated_asset.symbol != asset_data.frontend.symbol
    ) {
      console.log("Symbol Mismatch: ");
      console.log(generated_asset.symbol);
      console.log(asset_data.frontend.symbol);
    }

    if (
      generated_asset.logo_URIs.png != asset_data.frontend.logoURIs.png ||
      generated_asset.logo_URIs.svg != asset_data.frontend.logoURIs.svg
    ) {
      console.log("Logo Mismatch: ");
      console.log(generated_asset.logo_URIs);
      console.log(asset_data.frontend.logoURIs);
    }

    if (
      generated_asset.coingecko_id != asset_data.frontend.coingeckoId
    ) {
      console.log("CGID Mismatch: ");
      console.log(generated_asset.coingecko_id);
      console.log(asset_data.frontend.coingeckoId);
    }

    if (
      generated_asset.name != asset_data.frontend.name
    ) {
      console.log("Name Mismatch: ");
      console.log(generated_asset.name);
      console.log(asset_data.frontend.name);
    }

    assetlist.setChainName(asset_data);

    if (
      generated_asset.chain_name != asset_data.frontend.chainName
    ) {
      console.log("Chain Name Mismatch: ");
      console.log(generated_asset.chain_name);
      console.log(asset_data.frontend.chainName);
    }


    //--Finalize Images--
    let match = 0;
    images.forEach((image) => {
      if (
        (!generated_asset.logo_URIs.png ||
          generated_asset.logo_URIs.png == image.png) &&
        (!generated_asset.logo_URIs.svg ||
          generated_asset.logo_URIs.svg == image.svg)
      ) {
        match = 1;
        return;
      }
    });
    if (!match) {
      let new_image = {
        png: generated_asset.logo_URIs.png,
        svg: generated_asset.logo_URIs.svg,
      };
      images.push(new_image);
    }

    //--Add Flags--
    generated_asset.unstable = zone_asset.osmosis_unstable;
    generated_asset.disabled =
      zone_asset.osmosis_disabled || zone_asset.osmosis_unstable;
    generated_asset.unlisted = zone_asset.osmosis_unlisted;

    generated_asset.tooltip_message = zone_asset.tooltip_message;

    //--Get Keywords--
    let keywords = asset.keywords ? asset.keywords : [];
    //--Update Keywords--
    if (zone_asset.osmosis_unstable) {
      addArrayItem("osmosis-unstable", keywords);
    }
    if (zone_asset.osmosis_unlisted) {
      addArrayItem("osmosis-unlisted", keywords);
    }
    if (zone_asset.verified) {
      addArrayItem("osmosis-verified", keywords);
    }
    if (!keywords.length) {
      keywords = undefined;
    }

    //--Get type_asset--
    let type_asset = "ics20";
    if (zone_asset.chain_name == chainName) {
      type_asset = chain_reg.getAssetProperty(
        zone_asset.chain_name,
        zone_asset.base_denom,
        "type_asset"
      );
      if (!type_asset) {
        type_asset = "sdk.coin";
      }
    }

    assetlist.setTypeAsset(asset_data);

    if (
      type_asset != asset_data.chain_reg.type_asset
    ) {
      console.log("Type Asset Mismatch: ");
      console.log(type_asset);
      console.log(asset_data.chain_reg.type_asset);
    }

    //--Get Address--
    let chain_reg_address =
      zone_asset.chain_name == chainName ? asset.address : undefined;

    //--Append Asset to Assetlist--
    zone_config_assets.push(generated_asset);

    //--Setup Chain_Reg Asset--
    generated_chainRegAsset = {
      description: asset_description,
      denom_units: denom_units,
      type_asset: type_asset,
      address: chain_reg_address,
      base: generated_asset.coinMinimalDenom,
      name: generated_asset.name,
      display: asset.display,
      symbol: generated_asset.symbol,
      traces: traces,
      logo_URIs: generated_asset.logo_URIs,
      images: images,
      coingecko_id: assetlist.getAssetCoinGeckoID(chainName, zone_asset, assetlist.chain_registry_osmosis_assetlist),
      keywords: keywords,
    };
    //--Append to Chain_Reg Assetlist--
    chain_reg_assets.push(generated_chainRegAsset);
  });
};

function reformatZoneConfigAssets(assets) {
  let reformattedAssets = [];

  assets.forEach((asset) => {
    //--Setup Zone_Config Asset--
    let reformattedAsset = {
      chainName: asset.chain_name,
      sourceDenom: asset.sourceDenom,
      coinMinimalDenom: asset.coinMinimalDenom,
      symbol: asset.symbol,
      decimals: asset.decimals,
      logoURIs: asset.logo_URIs,
      coingeckoId: asset.coingecko_id,
      price: asset.price,
      categories: asset.categories ?? [],
      pegMechanism: asset.peg_mechanism,
      transferMethods: asset.transfer_methods ?? [],
      counterparty: asset.counterparty ?? [],
      variantGroupKey: asset.common_key,
      name: asset.name,
      //description: asset.description,
      verified: asset.verified ?? false,
      unstable: asset.unstable ?? false,
      disabled: asset.disabled ?? false,
      preview: asset.unlisted ?? false,
      tooltipMessage: asset.tooltip_message,
      sortWith: asset.sort_with,
      //twitterURL: asset.twitter_URL,
      listingDate: asset.listing_date,
      //relatedAssets: asset.relatedAssets,
    };

    if (isNaN(asset.listing_date.getTime())) {
      // Remove listing_date if it's null
      delete reformattedAsset.listingDate;
    }

    //--Append to Chain_Reg Assetlist--
    reformattedAssets.push(reformattedAsset);
  });

  return reformattedAssets;
}

//--Get Remaining Assets only in Chain Registry--
function getChainRegAssets(chainName, chain_reg_assets) {
  let registered_assets = chain_reg_assets;
  let assetPointers = chain_reg.getAssetPointersByChain(chainName);
  assetPointers.forEach((assetPointer) => {
    if (
      !chain_reg_assets.some(
        (chain_reg_asset) => chain_reg_asset.base == assetPointer.base_denom
      )
    ) {
      registered_assets.push(
        chain_reg.getAssetObject(
          assetPointer.chain_name,
          assetPointer.base_denom
        )
      );
    }
  });
  return registered_assets;
}

async function generateAssetlist(chainName) {
  let zoneConfig = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneConfigFileName
  )?.config;
  let zoneAssetlist = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneAssetlistFileName
  )?.assets;
  let zone_config_assets = [];
  let chain_reg_assets = [];
  await generateAssets(
    chainName,
    zoneConfig,
    zoneAssetlist,
    zone_config_assets,
    chain_reg_assets
  );
  if (!zone_config_assets) {
    return;
  }
  zone_config_assets = await getAllRelatedAssets(
    zone_config_assets,
    zoneConfig
  );
  chain_reg_assets = getChainRegAssets(chainName, chain_reg_assets);
  let chain_reg_assetlist = {
    $schema: "../assetlist.schema.json",
    chain_name: chainName,
    assets: chain_reg_assets,
  };
  zone_config_assets = reformatZoneConfigAssets(zone_config_assets);
  let zone_config_assetlist = {
    chainName: chainName,
    assets: zone_config_assets,
  };
  zone.writeToFile(
    chainName,
    zone.zoneConfigAssetlist,
    zone.assetlistFileName,
    zone_config_assetlist
  );
  zone.writeToFile(
    chainName,
    zone.chainRegAssetlist,
    zone.assetlistFileName,
    chain_reg_assetlist
  );
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
