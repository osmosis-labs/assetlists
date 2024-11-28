/*
 * Purpose:
 *  to validate chain endpoints
 *  
 *  
 * Plan:
 *  when given a chain and rpc+rest,
 *  validate that our frontend will be able to connect
 *  and receive a valid respoind from thier endpoint
 *  RPC, WSS, REST
 * 
 * 
 */

//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as path from 'path';
import * as api_mgmt from "./api_management.mjs";

//-- Globals --

const chainlistFileName = "chainlist.json";
const chainlistDirName = "frontend";
const chainlistDir = path.join(zone.generatedDirectoryName, chainlistDirName);

const stateFileName = "state.json";
const stateDirName = "state";
const stateDir = path.join(zone.generatedDirectoryName, stateDirName);

const rpcEndpoints = [
  "status"
];
const restEndpoints = [];

const testChains = [
  "osmosis",
  "agoric"
];

const currentDateUTC = new Date();
const numDaysInMs = 30 * 24 * 60 * 60 * 1000; // set to 30 days in milliseconds

//-- Functions --

function constructEndpointUrl(address, endpoint) {
  if (!address || !endpoint) {
    console.error("Invalid address or endpoint:", { address, endpoint });
    return null;
  }
  return new URL(endpoint, address).toString();
}


function queryEndpoint(address, endpoint) {
  const endpointUrl = constructEndpointUrl(address, endpoint);
  if (!endpointUrl) { return; }
  console.log(endpointUrl);
  return api_mgmt.queryApi(endpointUrl);
  //return "yo";
}

function getChainlist(chainName) {
  return zone.readFromFile(chainName, chainlistDir, chainlistFileName);
}

function getCounterpartyChainRpc(counterpartyChain) {
  return counterpartyChain?.apis?.rpc?.[0]?.address;
}

function getCounterpartyChainRest(counterpartyChain) {
  return counterpartyChain?.apis?.rest?.[0]?.address;
}

async function validateCounterpartyChain(counterpartyChain) {

  let results = [];

//--RPC--
  let address = getCounterpartyChainRpc(counterpartyChain);
  let endpoints = rpcEndpoints;
  for (const endpoint of endpoints) {
    if (!address) { break; }
    const response = await queryEndpoint(address, endpoint);
    let result = {
      endpoint: endpoint,
      query: constructEndpointUrl(address, endpoint),
      validResponse: response ? true : false
    }
    if (endpoint === "status") {
      const latestBlockTime = new Date(response?.result?.sync_info?.latest_block_time);
      const lenientDateUTC = new Date(currentDateUTC - 60 * 60 * 1000);
      result.stale = latestBlockTime < lenientDateUTC;
    }
    results.push(result);
  }
//--

//--REST--
  address = getCounterpartyChainRest(counterpartyChain);
  endpoints = restEndpoints;
  for (const endpoint of endpoints) {
    if (!address) { break; }
    results.push({
      query: constructEndpointUrl(address, endpoint),
      response: await queryEndpoint(address, endpoint) ? true : false
    });
  }
//--

  return results;

}

function constructValidationRecord(counterpartyChainName, validationResults) {
  return {
    chain_name: counterpartyChainName,
    queryDate: currentDateUTC,
    validationResults: validationResults
  };
}

function addValidationRecordsToState(state, chainName, validationRecords) {

  
  getState(chainName);

  if (!state.chains) { state.chains = []; }
  validationRecords.forEach((validationRecord) => {
    const index = state.chains.findIndex(chain => chain.chain_name === validationRecord.chain_name);
    if (index !== -1) {
      state.chains[index] = validationRecord;
    } else {
      state.chains.push(validationRecord);
    }
  });
  zone.writeToFile(chainName, stateDir, stateFileName, state);


}

function getState(chainName) {

  let state = {};
  try {
    state = zone.readFromFile(chainName, stateDir, stateFileName);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`File not found: ${error.message}`);
      state = {}; // Assign empty object if file doesn't exist
    } else {
      throw error; // Re-throw for unexpected errors
    }
  }
  return state;

}

async function validateEndpointsForAllCounterpartyChains(chainName) {

  if (chainName !== "osmosis") { return; } // temporary--just focusing on mainnet for now
  const chainlist = getChainlist(chainName)?.chains;
  if (!chainlist) { return; }

  let state = getState(chainName);

  let validationRecords = [];
  for (const counterpartyChain of chainlist) {

    if (!testChains.includes(counterpartyChain.chain_name)) { continue; } // temporary--only the test chains will proceed

    //See if it was recently queried, and skip if so
    const stateChain = state.chains?.find(chain => chain.chain_name === counterpartyChain.chain_name);
    if (stateChain) {
      const queryDate = new Date(stateChain.queryDate);
      if (!isNaN(queryDate.getTime())) {
        const RECENTLY_QUERIED = currentDateUTC.getTime() - queryDate.getTime() <= numDaysInMs;
        if (RECENTLY_QUERIED) {
          console.log(`Skipping chain ${counterpartyChain.chain_name} - queried recently.`);
          continue;  // Skip the rest of this iteration
        }
      }
    }
    
    const validationResults = await validateCounterpartyChain(counterpartyChain);
    //console.log(`Validation Results: ${JSON.stringify(validationResults, null, 2)}`);
    const validationRecord = constructValidationRecord(counterpartyChain.chain_name, validationResults);
    //console.log(`Validation Record: ${JSON.stringify(validationRecord, null, 2) }`);
    validationRecords.push(validationRecord);
  }
  //console.log(`Validation Records: ${JSON.stringify(validationRecords, null, 2)}`);
  addValidationRecordsToState(state, chainName, validationRecords);

}

function main() {
  zone.chainNames.forEach(chainName => validateEndpointsForAllCounterpartyChains(chainName));
}

main();