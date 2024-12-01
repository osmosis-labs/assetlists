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

import WebSocket from 'ws';
import https from 'https';

//-- Globals --

const chainlistFileName = "chainlist.json";
const chainlistDirName = "frontend";
const chainlistDir = path.join(zone.generatedDirectoryName, chainlistDirName);

const stateFileName = "state.json";
const stateDirName = "state";
const stateDir = path.join(zone.generatedDirectoryName, stateDirName);

//NODES
const RPC_NODE = "rpc";
const REST_NODE = "rest";

//PROTOCOLS
const HTTPS_PROTOCOL = "https:"
const WSS_PROTOCOL = "wss:"

//TESTS
const RPC_CORS = "RPC CORS";
const REST_CORS = "REST CORS";
const RPC_WSS = "RPC WSS";
const RPC_ENDPOINTS = "RPC Endpoints";
const REST_ENDPOINTS = "REST Endpoints";

//ENDPOINTS
const rpcEndpoints = [
  "status"
];
const wssEndpoints = [
  "websocket"
];
const restEndpoints = [
  "/cosmos/base/tendermint/v1beta1/node_info"
];


const numChainsToQuery = 2;
const currentDateUTC = new Date();
const oneDayInMs = 24 * 60 * 60 * 1000;
const successReQueryDelay = 7 * oneDayInMs;
const failureReQueryDelay = 30 * oneDayInMs;
const osmosisDomain = "https://osmosis.zone";

//-- Functions --

function constructUrl(baseUrl, endpoint, protocol = HTTPS_PROTOCOL) {
  if (!baseUrl || !endpoint) {
    console.error("Invalid baseUrl or endpoint:", { baseUrl, endpoint });
    return null;
  }
  try {
    let url = new URL(endpoint, baseUrl);
    url.protocol = protocol;
    return url;
  } catch (error) {
    console.error("Failed to construct URL:", error.message);
    return null;
  }
}

function queryUrl(url, protocol = HTTPS_PROTOCOL) {
  if (!url) { return; }
  console.log(url.toString());
  if (protocol === HTTPS_PROTOCOL) {
    return api_mgmt.queryApi(url.toString());
  } else if (protocol === WSS_PROTOCOL) {
    return testWSS(url);
  }
}

const queryRestEndpoint = (url) => {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'GET' }, (res) => {
      // Check for valid status code
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(true); // Success
      } else {
        console.error(`Invalid response from ${url}: ${res.statusCode}`);
        resolve(false); // Invalid response
      }
    });

    req.on('error', (err) => {
      console.error(`Error connecting to ${url}:`, err.message);
      resolve(false); // Connection error
    });

    req.setTimeout(5000, () => {
      console.error(`Request to ${url} timed out.`);
      req.destroy();
      resolve(false);
    });

    req.end();
  });
};

const testWSS = (url, timeoutMs = 10000) => {
  return new Promise((resolve) => {
    let timeout; // Reference for the timeout to clear later

    try {
      const ws = new WebSocket(url.toString());

      ws.on('open', () => {
        console.log(`Connection to ${url.toString()} successful!`);
        clearTimeout(timeout); // Clear the timeout to avoid unnecessary resolution
        ws.close();
        resolve(true); // Resolve with true for success
      });

      ws.on('error', (err) => {
        console.error(`Error connecting to ${url.toString()}:`, err.message);
        clearTimeout(timeout);
        resolve(false); // Resolve with false for failure
      });

      // Timeout handling
      timeout = setTimeout(() => {
        console.warn(`Connection to ${url.toString()} timed out.`);
        ws.close(); // Close the WebSocket if still open
        resolve(false); // Resolve with false for timeout
      }, timeoutMs);
    } catch (err) {
      console.error('Unexpected error:', err.message);
      resolve(null); // Resolve with null for unexpected errors
    }
  });
};


//testWSS('wss://second-server.com'); // Replace with the WSS URL

const checkCORS = (url) => {
  const options = {
    method: 'OPTIONS',
    headers: {
      Origin: osmosisDomain,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(url, options, (res) => {
      //console.log(`Status: ${res.statusCode}`);
      //console.log('Headers:', res.headers);
      if (res.headers['access-control-allow-origin']) {
        if (
          res.headers['access-control-allow-origin'] === osmosisDomain
            ||
          res.headers['access-control-allow-origin'] === "*"
        ) { resolve(true); }
        console.log(`${url} CORS Policy:`, res.headers['access-control-allow-origin']);
        resolve(false);
      } else {
        console.log('No CORS headers returned.');
        resolve(true);
      }
    });

    req.on('error', (err) => {
      console.error(`Error connecting to ${url.toString()}:`, err.message);
      resolve(false); // Resolve with false for failure
    });

    req.setTimeout(10000, () => { // Set timeout to 10 seconds
      console.error(`Request to ${url.toString()} timed out.`);
      req.destroy(); // Clean up the request
      resolve(false);
    });

    req.end();
  });
};

//checkCORS('https://second-server.com'); // Replace with the base URL of the second server

function getChainlist(chainName) {
  return zone.readFromFile(chainName, chainlistDir, chainlistFileName);
}

function getCounterpartyChainAddress(counterpartyChain, nodeType) {
  if (!counterpartyChain || !nodeType) { return; }
  if (nodeType === RPC_NODE) {
    return counterpartyChain?.apis?.rpc?.[0]?.address;
  } else if (nodeType === REST_NODE) {
    return counterpartyChain?.apis?.rest?.[0]?.address;
  }
  return;
}


async function validateCounterpartyChain(counterpartyChain) {

  //--RPC CORS--
  const rpcCorsValidation = (async () => {
    const address = getCounterpartyChainAddress(counterpartyChain, RPC_NODE);
    if (!address) return [];
    return Promise.all([
      (async () => {
        const response = await checkCORS(address, HTTPS_PROTOCOL);
        return {
          test: RPC_CORS,
          url: address,
          success: response,
        };
      })(),
    ]);
  })();
  //--

  //--RPC WSS--
  const rpcWssValidation = (async () => {
    const address = getCounterpartyChainAddress(counterpartyChain, RPC_NODE);
    if (!address) return [];
    return Promise.all(
      wssEndpoints.map(async (endpoint) => {
        const url = constructUrl(address, endpoint, WSS_PROTOCOL);
        const response = await testWSS(url);
        return {
          test: RPC_WSS,
          url: url,
          success: response,
        };
      })
    );
  })();
  //--

  //--RPC Endpoints--
  const rpcEndpointsValidation = (async () => {
    const address = getCounterpartyChainAddress(counterpartyChain, RPC_NODE);
    if (!address) return [];
    return Promise.all(
      rpcEndpoints.map(async (endpoint) => {
        const url = constructUrl(address, endpoint, HTTPS_PROTOCOL);
        const response = await queryUrl(url);
        const result = {
          test: RPC_ENDPOINTS,
          url: url,
          success: response ? true : false,
        };
        if (endpoint === "status") {
          const latestBlockTime = new Date(response?.result?.sync_info?.latest_block_time);
          const lenientDateUTC = new Date(currentDateUTC - 60 * 60 * 1000);
          result.stale = latestBlockTime < lenientDateUTC;
        }
        return result;
      })
    );
  })();
  //--

  //--REST CORS--
  const restCorsValidation = (async () => {
    const address = getCounterpartyChainAddress(counterpartyChain, REST_NODE);
    if (!address) return [];
    return Promise.all([
      (async () => {
        const response = await checkCORS(address, HTTPS_PROTOCOL);
        return {
          test: REST_CORS,
          url: address,
          success: response,
        };
      })(),
    ]);
  })();
  //--

  //--REST Endpoints--
  const restEndpointsValidation = (async () => {
    const address = getCounterpartyChainAddress(counterpartyChain, REST_NODE);
    if (!address) return [];
    return Promise.all(
      restEndpoints.map(async (endpoint) => {
        const url = constructUrl(address, endpoint, HTTPS_PROTOCOL);
        const response = await queryRestEndpoint(url);
        console.log(response);
        return {
          test: REST_ENDPOINTS,
          url: url,
          success: response ? true : false,
        };
      })
    );
  })();
  //--

  // Run all validations concurrently and merge results
  const [rpcCorsResults, rpcWssResults, rpcEndpointResults, restCorsResults, restEndpointsResults] = await Promise.all([
    rpcCorsValidation,
    rpcWssValidation,
    rpcEndpointsValidation,
    restCorsValidation,
    restEndpointsValidation,
  ]);

  return [...rpcCorsResults, ...rpcWssResults, ...rpcEndpointResults, ...restCorsResults, ...restEndpointsResults];
}


function determineValidationSuccess(validationResults) {
  for (const validationResult of validationResults) {
    if (!validationResult.success) { return false; }
    if (validationResults.stale) { return false; }
  }
  return true;
}

function constructValidationRecord(counterpartyChainName, validationResults) {
  return {
    chain_name: counterpartyChainName,
    validationDate: currentDateUTC,
    validationSuccess: determineValidationSuccess(validationResults),
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
  console.log("Saved State.");

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

function chainRecentlyQueried(state, chain_name) {
  const stateChain = state.chains?.find(chain => chain.chain_name === chain_name);
  if (stateChain) {
    const validationDate = new Date(stateChain.validationDate);
    if (!isNaN(validationDate.getTime())) {
      const WAS_SUCCESSFUL = stateChain.validationSuccess;
      if (WAS_SUCCESSFUL) {
        return currentDateUTC.getTime() - validationDate.getTime() <= successReQueryDelay;
      } else {
        return currentDateUTC.getTime() - validationDate.getTime() <= failureReQueryDelay;
      }
    }
  }
  return false;
}

async function validateEndpointsForAllCounterpartyChains(chainName) {

  if (chainName !== "osmosis") { return; } // temporary--just focusing on mainnet for now


  const chainlist = getChainlist(chainName)?.chains;
  if (!chainlist) { return; }

  let state = getState(chainName);
  let chainQueryQueue = [];
  

  let numChainsQueried = 0;
  for (const counterpartyChain of chainlist) {
    if (numChainsQueried >= numChainsToQuery) { break; }
    if (chainRecentlyQueried(state, counterpartyChain.chain_name)) { continue; }  //Skip Recently Queried Chains
    chainQueryQueue.push(counterpartyChain);
    numChainsQueried++;
  }

  // Generate validation promises and return records directly
  const validationPromises = chainQueryQueue.map(async (counterpartyChain) => {
    const validationResults = await validateCounterpartyChain(counterpartyChain);
    return constructValidationRecord(counterpartyChain.chain_name, validationResults);
  });

  // Wait for all validations and collect the records
  const validationRecords = await Promise.all(validationPromises);

  // Add validation records to state
  addValidationRecordsToState(state, chainName, validationRecords);

}

function main() {
  zone.chainNames.forEach(chainName => validateEndpointsForAllCounterpartyChains(chainName));
}

main();