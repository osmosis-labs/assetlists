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


import * as fs from 'fs';
import * as path from 'path';
import * as chain_reg from './chain_registry.mjs';
import * as assetlist_funcs from './assetlist_functions.mjs';

const chainNameToChainIdMap = new Map([
  ["osmosis", "osmosis-1"],
  ["osmosistestnet4", "osmo-test-4"],
  ["osmosistestnet", "osmo-test-5"]
]);

const assetlistsRoot = "../../..";
const generatedFolderName = "generated";
const assetlistFileName = "assetlist.json";
const chainlistFileName = "chainlist.json";
const zoneAssetConfigFileName = "zone_asset_config.json";
const zoneAssetlistFileName = "osmosis.zone_assets.json";
const zoneChainlistFileName = "osmosis.zone_chains.json";
const zoneConfigFileName = "osmosis.zone_config.json";

function getZoneAssetlist(chainName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      zoneAssetlistFileName
    )));
  } catch (err) {
    console.log(err);
  }
}

function getZoneChainlist(chainName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      zoneChainlistFileName
    )));
  } catch (err) {
    console.log(err);
  }
}

function writeToFile(list, localChainName, fileName) {
  try {
    fs.writeFile(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(localChainName),
      generatedFolderName,
      chainlistFileName
    ), JSON.stringify(list,null,2), (err) => {
      if (err) throw err;
    });
  } catch (err) {
    console.log(err);
  }
}

function generateChains(chains, zone_chains) {
  
  zone_chains.forEach((zone_chain) => {
  
    // -- Chain Object --
    let chain = {};
    chain.chain_name = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "chain_name");
    chain.status = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "status");
    chain.network_type = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "network_type");
    chain.pretty_name = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "pretty_name");
    chain.chain_id = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "chain_id");
    
    
    // -- Get bech32_config --
    chain.bech32_prefix = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "bech32_prefix");
    let bech32_config = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "bech32_config");
    if (!bech32_config) { bech32_config = {}; }
    chain_reg.bech32ConfigSuffixMap.forEach((value, key) => {
      if (bech32_config[key]) { return; }
      bech32_config[key] = chain.bech32_prefix.concat(value);
    });
    chain.bech32Config = bech32_config;


    // -- Get SLIP44 --
    chain.slip44 = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "slip44");
    chain.alternative_slip44s = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "alternative_slip44s");


    // -- Define Curreny Object Skeleton --
    let base_denom;
    let symbol;
    let display;
    let decimals;
    let denom_units;
    let coingecko_id;
    let currency;
    let logo_URIs;
    let image_URL;

    
    // -- Get Staking --
    let chain_reg_staking = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "staking");
    base_denom = chain_reg_staking?.staking_tokens[0]?.denom;
    symbol = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "symbol");
    display = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "display");
    decimals = 0;
    denom_units = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "denom_units");
    denom_units?.forEach((denom_unit) => {
      if(denom_unit.denom == display) {
        decimals = denom_unit.exponent;
      }
    });
    coingecko_id = chain_reg.getAssetPropertyWithTraceIBC(zone_chain.chain_name, base_denom, "coingecko_id");
    logo_URIs = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "logo_URIs");
    image_URL = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
    currency = {
      coinDenom: symbol,
      coinMinimalDenom: base_denom,
      coinDecimals: decimals,
      coinGeckoId: coingecko_id,
      coinImageUrl: image_URL
    };
    chain.stakeCurrency = currency;
    currency = {};


    // -- Get Fees --
    let fee_currencies = [];
    let chain_reg_fees = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "fees");
    chain_reg_fees?.fee_tokens?.forEach((fee) => {
      base_denom = fee.denom;
      symbol = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "symbol");
      display = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "display");
      decimals = 0;
      denom_units = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "denom_units");
      denom_units?.forEach((denom_unit) => {
        if(denom_unit.denom == display) {
          decimals = denom_unit.exponent;
        }
      });
      coingecko_id = chain_reg.getAssetPropertyWithTraceIBC(zone_chain.chain_name, base_denom, "coingecko_id");
      logo_URIs = chain_reg.getAssetProperty(zone_chain.chain_name, base_denom, "logo_URIs");
      image_URL = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
      currency = {
        coinDenom: symbol,
        coinMinimalDenom: base_denom,
        coinDecimals: decimals,
        coinGeckoId: coingecko_id,
        coinImageUrl: image_URL
      };
      if(fee.low_gas_price && fee.average_gas_price && fee.high_gas_price) { 
        currency.gasPriceStep = {
          low: fee.low_gas_price,
          average: fee.average_gas_price,
          high: fee.high_gas_price
        }
      }
      fee_currencies.push(currency);
      currency = {};
    });
    chain.feeCurrencies = fee_currencies;

    
    // -- Get Currencies --
    let currencies = [];
    let chain_reg_assets = chain_reg.getFileProperty(zone_chain.chain_name, "assetlist", "assets");
    chain_reg_assets?.forEach((asset) => {
      base_denom = asset.base;
      symbol = asset.symbol;
      display = asset.display;
      decimals = 0;
      denom_units = asset.denom_units;
      denom_units?.forEach((denom_unit) => {
        if(denom_unit.denom == display) {
          decimals = denom_unit.exponent;
        }
      });
      coingecko_id = chain_reg.getAssetPropertyWithTraceIBC(zone_chain.chain_name, base_denom, "coingecko_id");;
      logo_URIs = asset.logo_URIs;
      image_URL = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
      currency = {
        coinDenom: symbol,
        coinMinimalDenom: base_denom,
        coinDecimals: decimals,
        coinGeckoId: coingecko_id,
        coinImageUrl: image_URL
      };
      currencies.push(currency);
      currency = {};
    });
    chain.currencies = currencies;


    // -- Get Description --
    chain.description = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "description");
    
    
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
    chain.explorers[0].tx_page = zone_chain.explorer_tx_url;
    
    
    // -- Get Keplr Suggest Chain Features --
    chain.features = zone_chain.keplr_features;
    
    
    // -- Get Outage Alerts --
    chain.outage = zone_chain.outage;
    
    
    // -- Push Chain Object --
    chains.push(chain);
  
  });
  
}

function generateChainlist(chainName) {
  
  //let zoneChainlist = getZoneChainlist(chainName);
  let zoneChainlist = assetlist_funcs.readFromFile(chainName, zoneChainlistFileName);

  let chains = [];
  generateChains(chains, zoneChainlist.chains);
  let chainlist = {
    zone: chainName,
    chains: chains
  }
  //console.log(chainlist);
  
  writeToFile(chainlist, chainName, chainlistFileName);

}

function main() {

  generateChainlist("osmosis");
  //generateChainlist("osmosistestnet4");
  generateChainlist("osmosistestnet");
  
}

main();
