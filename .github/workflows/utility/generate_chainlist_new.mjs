// Purpose:
//   to generate the chainlist json using the zone_chains json and chain registry data

// -- THE PLAN --
//
// read zone list from osmosis.zone_chains.json
// add chains to zone array
// for each chain in zone array, identify the chain_name (this is primary key)
//   get various chain properties
//     for bech32, is no bech32 config, get bech32 prefix, and then generate the rest of the bech32 config
// write chainlist array to file osmosis-1.chainlist.json

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as zone from "./assetlist_functions.mjs";

//-- Globals --

let zoneAssetlist;

//-- Functions --

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

//getIbcDenom
async function getLocalBaseDenom(chain_name, base_denom, local_chain_name) {
  if (chain_name == local_chain_name) {
    return base_denom;
  }
  for (const asset of zoneAssetlist.assets) {
    if (
      asset.base_denom == base_denom &&
      asset.chain_name == chain_name &&
      asset.path
    ) {
      return await zone.calculateIbcHash(asset.path);
    }
  }
}

async function generateChains(chains, zone_chains, local_chain_name) {
  //zone_chains.forEach(async (zone_chain) => {
  await asyncForEach(zone_chains, async (zone_chain) => {
    // -- Chain Object --
    let chain = {};
    chain.chain_name = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "chain_name"
    );
    chain.status = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "status"
    );
    chain.networkType = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "network_type"
    );
    chain.prettyName = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "pretty_name"
    );
    chain.chain_id = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "chain_id"
    );

    // -- Get bech32_config --
    chain.bech32Prefix = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "bech32_prefix"
    );
    let bech32_config = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "bech32_config"
    );
    if (!bech32_config) {
      bech32_config = {};
    }
    chain_reg.bech32ConfigSuffixMap.forEach((value, key) => {
      if (bech32_config[key]) {
        return;
      }
      bech32_config[key] = chain.bech32Prefix?.concat(value);
    });
    chain.bech32Config = bech32_config;

    // -- Get SLIP44 --
    chain.slip44 = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "slip44"
    );
    chain.alternativeSlip44s = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "alternative_slip44s"
    );

    // -- Define Curreny Object Skeleton --
    let base_denom;
    let symbol;
    let decimals;
    let coingecko_id;
    let currency;
    let logo_URIs;
    let image_URL;
    let local_base_denom;

    // -- Get Staking --
    let chain_reg_staking = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "staking"
    );
    base_denom = chain_reg_staking?.staking_tokens[0]?.denom;
    local_base_denom = await getLocalBaseDenom(
      zone_chain.chain_name,
      base_denom,
      local_chain_name
    );
    symbol = chain_reg.getAssetProperty(
      zone_chain.chain_name,
      base_denom,
      "symbol"
    );
    decimals = chain_reg.getAssetDecimals(zone_chain.chain_name, base_denom);
    coingecko_id = chain_reg.getAssetPropertyWithTraceIBC(
      zone_chain.chain_name,
      base_denom,
      "coingecko_id"
    );
    logo_URIs = chain_reg.getAssetProperty(
      zone_chain.chain_name,
      base_denom,
      "logo_URIs"
    );
    image_URL = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
    currency = {
      coinDenom: symbol,
      chainSuggestionDenom: base_denom,
      coinMinimalDenom: local_base_denom,
      sourceDenom: base_denom,
      coinDecimals: decimals ? decimals : 0,
      coinGeckoId: coingecko_id,
      coinImageUrl: image_URL,
    };
    if (base_denom == local_base_denom) {
      delete currency.sourceDenom;
    }
    chain.stakeCurrency = currency;
    currency = {};

    // -- Get Fees --
    let fee_currencies = [];
    let chain_reg_fees = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "fees"
    );
    //chain_reg_fees?.fee_tokens?.forEach(async (fee) => {
    await asyncForEach(chain_reg_fees?.fee_tokens, async (fee) => {
      //for (const fee in chain_reg_fees?.fee_tokens) {
      base_denom = fee.denom;
      local_base_denom = await getLocalBaseDenom(
        zone_chain.chain_name,
        base_denom,
        local_chain_name
      );
      symbol = chain_reg.getAssetProperty(
        zone_chain.chain_name,
        base_denom,
        "symbol"
      );
      decimals = chain_reg.getAssetDecimals(zone_chain.chain_name, base_denom);
      coingecko_id = chain_reg.getAssetPropertyWithTraceIBC(
        zone_chain.chain_name,
        base_denom,
        "coingecko_id"
      );
      logo_URIs = chain_reg.getAssetProperty(
        zone_chain.chain_name,
        base_denom,
        "logo_URIs"
      );
      image_URL = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
      currency = {
        coinDenom: symbol,
        chainSuggestionDenom: base_denom,
        coinMinimalDenom: local_base_denom,
        sourceDenom: base_denom,
        coinDecimals: decimals ? decimals : 0,
        coinGeckoId: coingecko_id,
        coinImageUrl: image_URL,
      };
      if (base_denom == local_base_denom) {
        delete currency.sourceDenom;
      }
      if (fee.low_gas_price && fee.average_gas_price && fee.high_gas_price) {
        currency.gasPriceStep = {
          low: fee.low_gas_price,
          average: fee.average_gas_price,
          high: fee.high_gas_price,
        };
      }
      fee_currencies.push(currency);
      currency = {};
    });
    chain.feeCurrencies = fee_currencies;

    // -- Get Currencies --
    let currencies = [];
    let chain_reg_assets = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "assetlist",
      "assets"
    );
    //chain_reg_assets?.forEach(async (asset) => {
    await asyncForEach(chain_reg_assets, async (asset) => {
      //for (const asset in chain_reg_assets) {
      base_denom = asset.base;
      local_base_denom = await getLocalBaseDenom(
        zone_chain.chain_name,
        base_denom,
        local_chain_name
      );
      symbol = asset.symbol;
      decimals = chain_reg.getAssetDecimals(zone_chain.chain_name, base_denom);
      coingecko_id = chain_reg.getAssetPropertyWithTraceIBC(
        zone_chain.chain_name,
        base_denom,
        "coingecko_id"
      );
      logo_URIs = asset.logo_URIs;
      image_URL = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
      currency = {
        coinDenom: symbol,
        chainSuggestionDenom: base_denom,
        coinMinimalDenom: local_base_denom,
        sourceDenom: base_denom,
        coinDecimals: decimals ? decimals : 0,
        coinGeckoId: coingecko_id,
        coinImageUrl: image_URL,
      };
      if (base_denom == local_base_denom) {
        delete currency.sourceDenom;
      }
      currencies.push(currency);
      currency = {};
    });
    chain.currencies = currencies;

    // -- Get Description --
    chain.description = chain_reg.getFileProperty(
      zone_chain.chain_name,
      "chain",
      "description"
    );

    // -- Get APIs --
    chain.apis = {};
    chain.apis.rpc = [];
    chain.apis.rpc[0] = {};
    chain.apis.rpc[0].address = zone_chain.rpc;
    chain.apis.rest = [];
    chain.apis.rest[0] = {};
    chain.apis.rest[0].address = zone_chain.rest;

    // -- Get Explorer Tx URL --
    chain.explorers = [];
    chain.explorers[0] = {};
    chain.explorers[0].txPage = zone_chain.explorer_tx_url;

    // -- Get Keplr Suggest Chain Features --
    chain.features = zone_chain.keplr_features;

    // -- Get Outage Alerts --
    chain.outage = zone_chain.outage;

    // -- Push Chain Object --
    chains.push(chain);
  });

  return chains;
}

async function generateChainlist(chainName) {
  zoneAssetlist = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneAssetlistFileName
  );
  let zoneChainlist = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneChainlistFileName
  );
  let chains = [];
  chains = await generateChains(chains, zoneChainlist.chains, chainName);
  let chainlist = {
    zone: chainName,
    chains: chains,
  };
  //console.log(chainlist);
  zone.writeToFile(
    chainName,
    zone.zoneConfigChainlist,
    zone.chainlistFileName,
    chainlist
  );
}

async function generateChainlists() {
  for (const chainName of zone.chainNames) {
    await generateChainlist(chainName);
  }
}

function main() {
  generateChainlists();
}

main();
