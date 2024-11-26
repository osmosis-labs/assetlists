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

const testRPC = "";
const testREST = "";
const statusEndpoint = "status";

const testChains = [
  "osmosis",
  "agoric"
];

const currentDateUTC = new Date().toISOString();

//-- Functions --

function constructEndpointUrl(address, endpoint) {
  console.log(`Endpoint: ${address}/${endpoint}`);
  if (!address || !endpoint) { return; }
  return path.join(address, endpoint);
}

function queryEndpoint(address, endpoint) {
  const endpointUrl = constructEndpointUrl(address, endpoint);
  if (!endpointUrl) { return; }
  const result = api_mgmt.queryApi(endpointUrl);
  return result;
}

function getChainlist(chainName) {
  return zone.readFromFile(chainName, chainlistDir, chainlistFileName);
}

function getCounterpartyChainRpc(counterpartyChain) {
  return counterpartyChain?.apis?.rpc?.[0]?.address;
}

function validateCounterpartyChain(counterpartyChain) {
  const rpcAddress = getCounterpartyChainRpc(counterpartyChain);
  console.log(`Address: ${rpcAddress}`);
  if (!rpcAddress) { return; }

  //--STATUS--
  //const statusEndpointResult = queryEndpoint(rpcAddress, statusEndpoint);
  const statusEndpointResult = "yo"; //temporary
  console.log(`Status Endpoint Result: ${statusEndpointResult}`);
  let testStatus = {
    query: statusEndpoint,
    result: statusEndpointResult
  }
  //--


  let results = [
    testStatus
  ];
  return results;
}

function constructValidationRecord(counterpartyChainName, validationResults) {
  return {
    chain_name: counterpartyChainName,
    queryDate: currentDateUTC,
    validationResults: validationResults
  };
}

function addValidationRecordsToState(chainName, validationRecords) {

  
  // Read the existing State file
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

async function validateEndpointsForAllCounterpartyChains(chainName) {

  if (chainName !== "osmosis") { return; } // temporary--just focusing on mainnet for now
  const chainlist = getChainlist(chainName)?.chains;
  if (!chainlist) { return; }

  let validationRecords = [];

  chainlist.forEach((counterpartyChain) => {
    if (!testChains.includes(counterpartyChain.chain_name)) { return; } // temporary--only the test chains will proceed
    const validationResults = validateCounterpartyChain(counterpartyChain);
    const validationRecord = constructValidationRecord(counterpartyChain.chain_name, validationResults);
    console.log(`Validation Record: ${validationRecord}`);
    validationRecords.push(validationRecord);
  });

  addValidationRecordsToState(chainName, await validationRecords);

}

function main() {
  zone.chainNames.forEach(chainName => validateEndpointsForAllCounterpartyChains(chainName));
}

main();