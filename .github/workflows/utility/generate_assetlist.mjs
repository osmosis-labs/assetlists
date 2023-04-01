// Purpose:
//   to generate the assetlist json using the zone json and chain registry data


// -- THE PLAN --
//
// read zone list from osmosis.zone.json
// add assets to zone array
// for each asset in zone array, identify the chain and base (this is primary key)
//   with chain, find matching chain folder in chain registry
//   within the chain folder,
//     pull asset details from the chain's assetlist,
//   get ibc connection details,
//     figure out which chain name comes first alphabetically
//   generate asset object differently if ibc:
//     with an extra trace for the ibc transfer, and
//     the base becomes the ibc hash, and
//     the first denom becomes the ibc hash, and the original base becomes an alias
// write assetlist array to file osmosis-1.assetlist.json


import * as fs from 'fs';
import * as path from 'path';

const chainRegistryRoot = "../../../chain-registry";
const chainRegistryMainnetsSubdirectory = "";
const chainRegistryTestnetsSubdirectory = "/testnets";
let chainRegistrySubdirectory = "";
const assetlistsRoot = "../../..";
const assetlistsMainnetsSubdirectory = "/osmosis-1";
const assetlistsTestnetsSubdirectory = "/osmo-test-4";
let assetlistsSubdirectory = "";
const assetlistFileName = "assetlist.json";
const zoneAssetlistFileName = "osmosis.zone.json"
const ibcFolderName = "_IBC";
const mainnetChainName = "osmosis";
const testnetChainName = "osmosistestnet";
let localChainName = "";
let localChainAssetBases = [];
const mainnetChainId = "osmosis-1";
const testnetChainId = "osmo-test-4";
let localChainId = "";
const assetlistSchema = {
  description: "string",
  denom_units: [],
  type_asset: "string",
  address: "string",
  base: "string",
  name: "string",
  display: "string",
  symbol: "string",
  traces: [],
  logo_URIs: {
    png: "string",
    svg: "string"
  },
  coingecko_id: "string",
  keywords: []
}

function getZoneAssetlist() {
  try {
    return JSON.parse(fs.readFileSync(path.join(assetlistsRoot, assetlistsSubdirectory, zoneAssetlistFileName)));
  } catch (err) {
    console.log(err);
  }
}

function copyRegisteredAsset(chain_name, base_denom) {
  try {
    const chainRegistryChainAssetlist = JSON.parse(fs.readFileSync(path.join(chainRegistryRoot, chainRegistrySubdirectory, chain_name, assetlistFileName)));
    return chainRegistryChainAssetlist.assets.find((registeredAsset) => {
      return registeredAsset.base === base_denom;
    });
  } catch (err) {
    console.log(err);
  }
}

function getIbcConnections(ibcFileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(chainRegistryRoot, chainRegistrySubdirectory, ibcFolderName, ibcFileName)));
  } catch (err) {
    console.log(err);
  }
}

function writeToFile(assetlist) {
  try {
    fs.writeFile(path.join(assetlistsRoot, assetlistsSubdirectory, localChainId +'.assetlist.json'), JSON.stringify(assetlist,null,2), (err) => {
      if (err) throw err;
    });
  } catch (err) {
    console.log(err);
  }
}

async function calculateIbcHash(ibcHashInput) {
  const textAsBuffer = new TextEncoder().encode(ibcHashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const digest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const ibcHashOutput = "ibc/" + digest.toUpperCase();
  return ibcHashOutput;
}

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

function reorderProperties(object, referenceObject) {
  let newObject = object;
  if (typeof(object) === "object") {
    if(object.constructor !== Array) {
      newObject = {};
      Object.keys(referenceObject).forEach((key) => {
        if(object[key] && referenceObject[key]){
          newObject[key] = reorderProperties(object[key], referenceObject[key]);
        }
      });
    }
  }
  return newObject;
}

function getLocalChainAssetBases() {
  try {
    const chainRegistryChainAssetlist = JSON.parse(fs.readFileSync(path.join(chainRegistryRoot, chainRegistrySubdirectory, localChainName, assetlistFileName)));
    chainRegistryChainAssetlist.assets.forEach((asset) => {
      localChainAssetBases.push(asset.base);
    });
  } catch (err) {
    console.log(err);
  }
}

const generateAssets = async (generatedAssetlist, zoneAssetlist) => {
  
  await asyncForEach(zoneAssetlist.assets, async (zoneAsset) => {

    let generatedAsset = copyRegisteredAsset(zoneAsset.chain_name, zoneAsset.base_denom);

    if(zoneAsset.chain_name != localChainName) {

      let type = "ibc";
      let counterparty = {
        chain_name: zoneAsset.chain_name,
        base_denom: zoneAsset.base_denom,
        port: "transfer"
      };
      let chain = {
        chain_name: localChainName,
        port: "transfer"
      };
      let chain_1 = chain;
      let chain_2 = counterparty;
      
      
      //--Identify CW20 Transfer--
      if(counterparty.base_denom.slice(0,5) === "cw20:") {
        counterparty.port = "wasm.";
        type = "ibc-cw20";
      }
      
      //--Identify Chain_1 and Chain_2--
      if(counterparty.chain_name < chain.chain_name) {
        chain_1 = counterparty;
        chain_2 = chain;
      }
      
      //--Find IBC File Name--
      let ibcFileName = chain_1 .chain_name + "-" + chain_2.chain_name + ".json";
      
      //--Find IBC Connection--
      const ibcConnections = getIbcConnections(ibcFileName);
      
      //--Find IBC Channel and Port Info--
      ibcConnections.channels.forEach(function(channel) {
        if(channel.chain_1.port_id.slice(0,5) === chain_1.port.slice(0,5) && channel.chain_2.port_id.slice(0,5) === chain_2.port.slice(0,5)) {
          chain_1.channel_id = channel.chain_1.channel_id;
          chain_2.channel_id = channel.chain_2.channel_id;
          chain_1.port = channel.chain_1.port_id;
          chain_2.port = channel.chain_2.port_id;
          return;
        }
      });
      
      //--Create Trace--
      let trace = {
        type: type,
        counterparty: counterparty,
        chain: chain
      };
      
      //--Add Trace Path--
      trace.chain.path = chain.port + "/" + trace.chain.channel_id + "/" + zoneAsset.base_denom;
      let traces = [];
      if(generatedAsset.traces) {
        traces = generatedAsset.traces;
        if(traces[traces.length - 1].type === "ibc" || traces[traces.length - 1].type === "ibc-cw20") {
          if(traces[traces.length - 1].chain.path) {
            trace.chain.path = chain.port + "/" + trace.chain.channel_id + "/" + traces[traces.length - 1].chain.path;
          } else {
            console.log(generatedAsset.base + "Missing Path");
          }
        }
      } else if (zoneAsset.base_denom.slice(0,7) === "factory") {
        let baseReplacement = zoneAsset.base_denom.replace(/\//g,":");
        trace.chain.path = chain.port + "/" + trace.chain.channel_id + "/" + baseReplacement;
      }
      
      //--Cleanup Trace--
      delete trace.chain.chain_name;
      if(type === "ibc") {
        delete trace.chain.port;
        delete trace.counterparty.port;
      }
      
      //--Append Latest Trace to Traces--
      traces.push(trace);
      generatedAsset.traces = traces;
      
      //--Get IBC Hash--
      let ibcHash = calculateIbcHash(traces[traces.length -1].chain.path);
      
      //--Replace Base with IBC Hash--
      generatedAsset.base = await ibcHash;
      generatedAsset.denom_units.forEach(async function(unit) {
        if(unit.denom === zoneAsset.base_denom) {
          if(!unit.aliases) {
            unit.aliases = [];
          }
          unit.aliases.push(zoneAsset.base_denom);
          unit.denom = await ibcHash;
        }
        return;
      });
      
      //--Use local version if IBC Hash for asset exists in Chain Assetlist--
      localChainAssetBases.forEach((asset) => {
        if(asset == generatedAsset.base) {
          generatedAsset = copyRegisteredAsset(localChainName, generatedAsset.base);
        }
      });

    }
  
    //--Overrides Properties when Specified--
    if(zoneAsset.override_properties) {
      if(zoneAsset.override_properties.symbol) {
        generatedAsset.symbol = zoneAsset.override_properties.symbol;
      }
      if(zoneAsset.override_properties.logo_URIs) {
        generatedAsset.logo_URIs = zoneAsset.override_properties.logo_URIs;
      }
      if(zoneAsset.override_properties.coingecko_id) {
        generatedAsset.coingecko_id = zoneAsset.override_properties.coingecko_id;
      }
    }
    
    //--Add Keywords--
    let keywords = [];
    if(generatedAsset.keywords) {
      keywords = generatedAsset.keywords;
    }
    if(zoneAsset.osmosis_main) {
      keywords.push("osmosis-main");
    }
    if(zoneAsset.osmosis_frontier) {
      keywords.push("osmosis-frontier");
    }
    if(zoneAsset.osmosis_info) {
      keywords.push("osmosis-info");
    }
    if(keywords.length > 0) {
      generatedAsset.keywords = keywords;
    }
    if(zoneAsset.pools) {
      Object.keys(zoneAsset.pools).forEach((key) => {
        keywords.push(key + ":" + zoneAsset.pools[key]);
      });
    }
    
    //--Re-order Properties--
    generatedAsset = reorderProperties(generatedAsset, assetlistSchema);
    //console.log(generatedAsset);
    
    //--Append Asset to Assetlist--
    generatedAssetlist.push(generatedAsset);
    
    //console.log(generatedAssetlist);
  
  });

}


async function generateAssetlist() {
  
  let zoneAssetlist = getZoneAssetlist();
  
  let generatedAssetlist = [];  
  await generateAssets(generatedAssetlist, zoneAssetlist);
  let chainAssetlist = {
    chain_name: localChainName,
    assets: await generatedAssetlist
  }
  //console.log(chainAssetlist);
  
  writeToFile(chainAssetlist);

}

function selectDomain(domain) {
  if(domain == "mainnets") {
    chainRegistrySubdirectory = chainRegistryMainnetsSubdirectory;
    assetlistsSubdirectory = assetlistsMainnetsSubdirectory;
    localChainName = mainnetChainName;
    localChainId = mainnetChainId;
    getLocalChainAssetBases();
  } else if(domain == "testnets") {
    chainRegistrySubdirectory = chainRegistryTestnetsSubdirectory;
    assetlistsSubdirectory = assetlistsTestnetsSubdirectory;
    localChainName = testnetChainName;
    localChainId = testnetChainId;
    getLocalChainAssetBases();
  } else {
    console.log("Invalid Domain (Mainnets, Testnets, Devnets, etc.)");
  }
}

async function main() {

  selectDomain("mainnets");
  await generateAssetlist();
  selectDomain("testnets");
  generateAssetlist();
  
}

main();