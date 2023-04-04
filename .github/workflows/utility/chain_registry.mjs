// Purpose:
//   to provide chain registry lookup functionality to other programs


// -- IMPORTS --

import * as fs from 'fs';
import * as path from 'path';

// -- VARIABLES --

export let chainNameToDirectoryMap = new Map();

export const chainRegistryRoot = "../../../chain-registry";

const networkTypeToDirectoryNameMap = new Map();
networkTypeToDirectoryNameMap.set("mainnet", "");
networkTypeToDirectoryNameMap.set("testnet", "testnets");
const networkTypes = Array.from(networkTypeToDirectoryNameMap.keys());

const domainToDirectoryNameMap = new Map();
domainToDirectoryNameMap.set("cosmos", "");
domainToDirectoryNameMap.set("non-cosmos", "_non-cosmos");
const domains = Array.from(domainToDirectoryNameMap.keys());

const fileToFileNameMap = new Map();
fileToFileNameMap.set("chain", "chain.json");
fileToFileNameMap.set("assetlist", "assetlist.json");
const files = Array.from(domainToDirectoryNameMap.keys());

export const nonChainDirectories = [
  ".git",
  ".github",
  "_IBC",
  "_non-cosmos",
  "testnets",
  ".gitignore",
  "assetlist.schema.json",
  "chain.schema.json",
  "ibc_data.schema.json",
  "README.md"
]


const networkTypeToDirectoryMap = new Map();
networkTypeToDirectoryMap.set("mainnet", "");
networkTypeToDirectoryMap.set("testnet", "testnets");
for (const [networkType, directory] of networkTypeToDirectoryMap.entries()) {
  networkTypeToDirectoryMap.set(networkType, path.join(chainRegistryRoot, directory));
}

const fileNames = {
  chain: "chain.json",
  assetlist: "assetlist.json",
};

let paths = {};
let chains = [];
export const chain__FileName = "chain.json";
export const assetlist__FileName = "assetlist.json";

export let debug = 1;


export let allChains = "";

// -- GENERAL UTILITY FUNCTIONS --

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch (err) {
    console.log(err);
  }
}

export function writeJsonFile(file, object) {
  try {
    fs.writeFileSync((file), JSON.stringify(object,null,2), (err) => {
      if (err) throw err;
    });
  } catch (err) {
    console.log(err);
  }
}

export function getDirectoryContents(directory) {
  let array = [];
  try {
    array = fs.readdirSync(directory, (err, list) => {
      if (err) throw err;
      return list;
    });
  } catch (err) {
    console.log(err);
  }
  return array;
}

export function setDifferenceArray(a, b) {
  let c = [];
  a.forEach((item) => {
    if(!b.includes(item)) {
      c.push(item);
    }
  });
  return c;
}

// -- CHAIN REGISTRY MODULES --


export function populateChainDirectories() {
  for (let [networkType, networkTypeDirectoryName] of networkTypeToDirectoryNameMap) {
    for (let [domain, domainDirectoryName] of domainToDirectoryNameMap) {
      chains = setDifferenceArray(
        getDirectoryContents(path.join(chainRegistryRoot, networkTypeDirectoryName, domainDirectoryName)),
        nonChainDirectories
      );
      chains.forEach((chainName) => {
        chainNameToDirectoryMap.set(
          chainName,
          path.join(chainRegistryRoot, networkTypeDirectoryName, domainDirectoryName, chainName)
        );
      });
    }
  }
}

export function getFileProperty(chainName, file, property) {
  const chainDirectory = chainNameToDirectoryMap.get(chainName);
  if(chainDirectory) {
    const filePath = path.join(chainDirectory,fileToFileNameMap.get(file));
    const FILE_EXISTS = fs.existsSync(filePath);
    if(FILE_EXISTS) {
      return readJsonFile(filePath)[property];
    }
  }
}

export function setFileProperty(chainName, file, property, value) {
  const chainDirectory = chainNameToDirectoryMap.get(chainName);
  if(chainDirectory) {
    const filePath = path.join(chainDirectory,fileToFileNameMap.get(file));
    const FILE_EXISTS = fs.existsSync(filePath);
    if(FILE_EXISTS) {
      let json = readJsonFile(filePath);
      json[property] = value;
      writeJsonFile(filePath, json);
      return;
    }
  }
}

export function getAssetProperty(chainName, baseDenom, property) {
  const assets = getFileProperty(chainName, "assetlist", "assets");
  if(assets) {
    let selectedAsset;
    assets.forEach((asset) => {
      if(asset.base == baseDenom) {
        selectedAsset = asset;
        return;
      }
    });
    if(selectedAsset) {
      return selectedAsset[property];
    }
  }
}

export function setAssetProperty(chainName, baseDenom, property, value) {
  const assets = getFileProperty(chainName, "assetlist", "assets");
  if(assets) {
    assets.forEach((asset) => {
      if(asset.base == baseDenom) {
        asset[property] = value;
        setFileProperty(chainName, "assetlist", "assets", assets);
        return;
      }
    });
  }
}

export function getAssetPointersByChain(chainName) {
  let assetPointers = [];
  const assets = getFileProperty(chainName, "assetlist", "assets");
  if(assets) {
    assets.forEach((asset) => {
      if(asset.base) {
        assetPointers.push({
          chain_name: chainName,
          base_denom: asset.base
        });
      }
    });
  }
  return assetPointers;
}

export function getAssetPointersByNetworkType(networkType) {
  let assetPointers = [];
  const assets = getFileProperty(chainName, "assetlist", "assets");
  if(assets) {
    assets.forEach((asset) => {
      if(asset.base) {
        assetPointers.push({
          chain_name: chainName,
          base_denom: asset.base
        });
      }
    });
  }
  return assetPointers;
}

export function getAssetPointers() {
  let assetPointers = [];
  Array.from(chainNameToDirectoryMap.keys()).forEach((chainName) => {
    assetPointers = assetPointers.concat(getAssetPointersByChain(chainName));
  });
  return assetPointers;
}

export function getChains() {
  chains = Array.from(chainNameToDirectoryMap.keys());
  return chains;
}

export function filterChainsByFileProperty(chains, file, property, value) {
  let filtered = [];
  chains.forEach((chain) => {
    let propertyValue = getFileProperty(chain, file, property);
    if(value == "*") {
      if(propertyValue && propertyValue != "") {
        filtered.push(pointer);
      }
    } else {
      if(propertyValue == value) {
        filtered.push(pointer);
      }
    }
  });
  return filtered;
}

export function filterAssetPointersByFileProperty(pointers, file, property, value) {
  let filtered = [];
  pointers.forEach((pointer) => {
    let propertyValue = getFileProperty(pointer.chain_name, file, property);
    if(value == "*") {
      if(propertyValue && propertyValue != "") {
        filtered.push(pointer);
      }
    } else {
      if(propertyValue == value) {
        filtered.push(pointer);
      }
    }
  });
  return filtered;
}

export function filterAssetPointersByAssetProperty(pointers, property, value) {
  let filtered = [];
  pointers.forEach((pointer) => {
    let propertyValue = getAssetProperty(pointer.chain_name, pointer.base_denom, property);
    if(value == "*") {
      if(propertyValue && propertyValue != "") {
        filtered.push(pointer);
      }
    } else {
      if(propertyValue == value) {
        filtered.push(pointer);
      }
    }
  });
  return filtered;
}

function main() {
  populateChainDirectories();
}

main();