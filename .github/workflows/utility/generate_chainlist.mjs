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


const chainNameToChainIdMap = new Map([
  ["osmosis", "osmosis-1"],
  ["osmosistestnet4", "osmo-test-4"],
  ["osmosistestnet", "osmo-test-5"]
]);

const assetlistsRoot = "../../..";
const assetlistFileName = "assetlist.json";
const zoneAssetlistFileName = "osmosis.zone_assets.json";
const zoneChainlistFileName = "osmosis.zone_chains.json";

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

function writeToFile(assetlist, chainName) {
  try {
    fs.writeFile(path.join(
      assetlistsRoot,
      chainNameToChainIdMap.get(chainName),
      chainNameToChainIdMap.get(chainName) +'.chainlist.json'
    ), JSON.stringify(assetlist,null,2), (err) => {
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
    if (!bech32_config) {
      bech32_config = {};
    }
    chain_reg.bech32ConfigSuffixMap.forEach((value, key) => {
      if (bech32_config[key]) { return; }
      bech32_config[key] = chain.bech32_prefix.concat(value);
    });
    chain.bech32_config = bech32_config;


    // -- Get SLIP44 --
    chain.slip44 = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "slip44");
    chain.alternative_slip44s = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "alternative_slip44s");


    // -- Get Fees --
    chain.fees = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "fees");
    
    
    // -- Get Staking --
    chain.staking = chain_reg.getFileProperty(zone_chain.chain_name, "chain", "staking");

    
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
  
  let zoneChainlist = getZoneChainlist(chainName);
  let chains = [];
  generateChains(chains, zoneChainlist.chains);
  let chainlist = {
    zone: chainName,
    chains: chains
  }
  //console.log(chainlist);
  
  writeToFile(chainlist, chainName);

}

function main() {

  generateChainlist("osmosis");
  //generateChainlist("osmosistestnet4");
  generateChainlist("osmosistestnet");
  
}

main();
