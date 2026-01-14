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
import { sortEndpointsByProvider, isPreferredProvider, getProviderFromEndpoint, isTeamEndpoint } from './endpoint_preference.mjs';

import WebSocket from 'ws';
import https from 'https';
import fs from 'fs';

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

const tests = [
  RPC_CORS,
  REST_CORS,
  RPC_WSS,
  RPC_ENDPOINTS,
  REST_ENDPOINTS
];

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


// Determine number of chains to query based on workflow trigger type
function getNumChainsToQuery() {
  const eventName = process.env.GITHUB_EVENT_NAME || 'manual';

  if (eventName === 'schedule') {
    return 50;  // Scheduled Monday runs
  } else if (eventName === 'workflow_dispatch') {
    return 10;  // Manual workflow runs
  } else {
    return 4;   // Default for local testing
  }
}

const numChainsToQuery = getNumChainsToQuery();
console.error(`Validation mode: ${process.env.GITHUB_EVENT_NAME || 'default'} - Will query up to ${numChainsToQuery} chains`);
const currentDateUTC = new Date();
const oneDayInMs = 24 * 60 * 60 * 1000;
const successReQueryDelay = 7 * oneDayInMs;
const failureReQueryDelay = 1 * oneDayInMs;  // Check failed endpoints daily
const osmosisDomain = "https://osmosis.zone";

//-- Functions --

// Function to get the node type based on the test type
function getNodeType(test) {
  switch (test) {
    case RPC_CORS:
    case RPC_WSS:
    case RPC_ENDPOINTS:
      return RPC_NODE;
    case REST_CORS:
    case REST_ENDPOINTS:
      return REST_NODE;
    default:
      throw new Error(`Unsupported test type: ${test}`);
  }
}

// Function to get the protocol based on the test type
function getQueryProtocol(test) {
  switch (test) {
    case RPC_CORS:
    case REST_CORS:
    case REST_ENDPOINTS:
    case RPC_ENDPOINTS:
      return HTTPS_PROTOCOL;
    case RPC_WSS:
      return WSS_PROTOCOL;
    default:
      throw new Error(`Unsupported test type: ${test}`);
  }
}

// Function to get the endpoints array based on the test type
function getEndpointsArray(test) {
  switch (test) {
    case RPC_CORS:
    case REST_CORS:
      return ["/"]; // Placeholder for CORS tests
    case RPC_ENDPOINTS:
      return rpcEndpoints;
    case RPC_WSS:
      return wssEndpoints;
    case REST_ENDPOINTS:
      return restEndpoints;
    default:
      throw new Error(`Unsupported test type: ${test}`);
  }
}

const queryUrl = (url, test) => {
  switch (test) {
    case RPC_WSS:
      return queryWSS(url);
    case RPC_CORS:
    case REST_CORS:
      return queryCORS(url);
    case RPC_ENDPOINTS:
    case REST_ENDPOINTS:
      return queryHTTP(url);
    default:
      throw new Error(`Unknown test type: ${test}`);
  }
};

const evaluateWSSResult = (result) => {
  return result.success || false;
};

const evaluateCORSResult = (result) => {
  return result.corsPolicy === osmosisDomain || result.corsPolicy === "*";
};

const evaluateHTTPResult = (result) => {
  return result.success || false;
};

const evaluateResult = (result, test) => {
  console.log(`${test}:`);
  switch (test) {
    case RPC_WSS:
      return evaluateWSSResult(result);
    case RPC_CORS:
    case REST_CORS:
      return evaluateCORSResult(result);
    case RPC_ENDPOINTS:
    case REST_ENDPOINTS:
      return evaluateHTTPResult(result);
    default:
      throw new Error(`Unknown test type: ${test}`);
  }
};

function constructUrl(baseUrl, endpoint, protocol = HTTPS_PROTOCOL) {
  if (!baseUrl || !endpoint) {
    console.error("Invalid baseUrl or endpoint:", { baseUrl, endpoint });
    return null;
  }

  try {
    const url = new URL(baseUrl);
    url.protocol = protocol;

    // Append the endpoint correctly
    url.pathname = [url.pathname.replace(/\/$/, ""), endpoint.replace(/^\//, "")]
      .filter(Boolean) // Remove empty components
      .join("/");

    return url.toString(); // Return as a string if preferred
  } catch (error) {
    console.error("Failed to construct URL:", error.message);
    return null;
  }
}

const queryWSS = (url, timeoutMs = 10000) => {
  return new Promise((resolve) => {
    let timeout;

    try {
      const ws = new WebSocket(url.toString());
      const result = {
        success: false,
        headers: {},
        errorCode: null,
        message: null,
      };

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve({
          ...result,
          success: true,
          message: 'Connection successful',
        });
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          ...result,
          errorCode: err.code || 'WS_ERROR',
          message: err.message || 'WebSocket error occurred',
        });
      });

      timeout = setTimeout(() => {
        ws.close();
        resolve({
          ...result,
          errorCode: 'TIMEOUT',
          message: 'Connection timed out',
        });
      }, timeoutMs);
    } catch (err) {
      resolve({
        success: false,
        headers: {},
        errorCode: 'UNEXPECTED_ERROR',
        message: err.message || 'Unexpected error occurred',
      });
    }
  });
};
      

const queryCORS = (url) => {
  const options = {
    method: 'OPTIONS',
    headers: { Origin: osmosisDomain },
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error(`Request to ${url} timed out.`);
      resolve({ success: false, errorCode: 'TIMEOUT', corsPolicy: null });
    }, 5000);

    const req = https.request(url, options, (res) => {
      clearTimeout(timeout);

      let body = '';
      res.on('data', chunk => body += chunk); // Collect chunks
      res.on('end', () => {
        resolve({
          success: true,
          errorCode: res.statusCode,
          headers: res.headers,
          message: `CORS Policy: ${res.headers['access-control-allow-origin']}`,
          corsPolicy: res.headers['access-control-allow-origin'] || null,
        });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`Error connecting to ${url}:`, err.message);
      resolve({ success: false, errorCode: err.code || 'UNKNOWN', corsPolicy: null });
    });

    req.end();
  });
};




const queryREST = (url) => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error(`Request to ${url} timed out.`);
      resolve({ success: false, errorCode: null, message: "Request timed out" });
    }, 5000);

    let body = '';

    const req = https.request(url, { method: 'GET' }, (res) => {
      clearTimeout(timeout); // Clear timeout on response

      res.on('data', (chunk) => {
        body += chunk; // Accumulate the response body
      });

      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          errorCode: res.statusCode,
          headers: res.headers,
          message: res.statusCode >= 200 && res.statusCode < 300
            ? "Request succeeded"
            : `Invalid response: ${res.statusCode}`,
          body, // Attach the complete response body
        });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout); // Clear timeout on error
      resolve({
        success: false,
        errorCode: err.code || null,  // Include error code (ECONNREFUSED, ETIMEDOUT, etc.)
        headers: null,
        message: err.message,
        body: null,
      });
    });

    req.end();
  });
};

const queryHTTP = (url) => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error(`Request to ${url} timed out.`);
      resolve({ success: false, errorCode: null, message: "Request timed out" });
    }, 5000);

    let body = '';

    const req = https.request(url, { method: 'GET' }, (res) => {
      clearTimeout(timeout); // Clear timeout on response

      res.on('data', (chunk) => {
        body += chunk; // Accumulate the response body
      });

      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          errorCode: res.statusCode,
          headers: res.headers,
          message: res.statusCode >= 200 && res.statusCode < 300
            ? "Request succeeded"
            : `Invalid response: ${res.statusCode}`,
          body, // Attach the complete response body
        });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout); // Clear timeout on error
      resolve({
        success: false,
        errorCode: err.code || null,  // Include error code (ECONNREFUSED, ETIMEDOUT, etc.)
        headers: null,
        message: err.message,
        body: null,
      });
    });

    req.end();
  });
};

const logResult = (url, result, success) => {
  const status = result.success ? "SUCCESS" : `ERROR: ${result.errorCode || "UNKNOWN"}`;
  const message = `${result.errorCode || ""}: ${result.message || "No additional information"}`;
  const urlString = url ? url.toString() : "null";
  console.log(`[${status}] ${urlString} - ${message}`);
  console.log(`Compatible?: ${success}`);
};

/**
 * Classify error types for better reporting
 * Returns standardized error type string based on the result and test type
 */
function classifyError(result, test) {
  // If success, no error
  if (result.success) {
    return null;
  }

  // CORS-specific failures
  if (test === RPC_CORS || test === REST_CORS) {
    if (result.errorCode === 'TIMEOUT') {
      return 'TIMEOUT';
    }
    if (result.errorCode && typeof result.errorCode === 'string') {
      // Network errors like ECONNREFUSED, ENOTFOUND, etc.
      if (result.errorCode.startsWith('E')) {
        return 'NETWORK_ERROR';
      }
    }
    // CORS header missing or invalid (success=false but got response)
    if (result.errorCode >= 200 && result.errorCode < 600) {
      return 'CORS_FAILED';
    }
    return 'CORS_FAILED';
  }

  // WebSocket-specific failures
  if (test === RPC_WSS) {
    if (result.errorCode === 'TIMEOUT') {
      return 'TIMEOUT';
    }
    return 'WEBSOCKET_ERROR';
  }

  // HTTP endpoint failures (RPC or REST)
  if (test === RPC_ENDPOINTS || test === REST_ENDPOINTS) {
    // Timeout
    if (result.errorCode === null && result.message && result.message.includes('timed out')) {
      return 'TIMEOUT';
    }

    // HTTP error codes
    if (result.errorCode >= 400) {
      return 'HTTP_ERROR';
    }

    // Network errors (ECONNREFUSED, ENOTFOUND, etc.)
    if (result.message) {
      const msg = result.message.toLowerCase();
      if (msg.includes('econnrefused') || msg.includes('refused')) {
        return 'NETWORK_ERROR';
      }
      if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
        return 'NETWORK_ERROR';
      }
      if (msg.includes('etimedout') || msg.includes('esockettimedout') || msg.includes('timed out')) {
        return 'TIMEOUT';
      }
    }

    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

function getChainlist(chainName) {
  return zone.readFromFile(chainName, chainlistDir, chainlistFileName);
}


function getCounterpartyChainAddress(counterpartyChain, nodeType, endpointIndex = 0) {
  if (!counterpartyChain || !nodeType) { return; }
  if (nodeType === RPC_NODE) {
    return counterpartyChain?.apis?.rpc?.[endpointIndex]?.address;
  } else if (nodeType === REST_NODE) {
    return counterpartyChain?.apis?.rest?.[endpointIndex]?.address;
  }
  return;
}

function getEndpointCount(counterpartyChain, nodeType) {
  if (!counterpartyChain || !nodeType) { return 0; }
  if (nodeType === RPC_NODE) {
    return counterpartyChain?.apis?.rpc?.length || 0;
  } else if (nodeType === REST_NODE) {
    return counterpartyChain?.apis?.rest?.length || 0;
  }
  return 0;
}


async function validateCounterpartyChain(counterpartyChain, chainName = "osmosis-1") {

  // Load zone chains config to check for zone endpoints
  const zoneChains = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneChainlistFileName
  )?.chains || [];
  const zoneChain = zoneChains.find(z => z.chain_name === counterpartyChain.chain_name);

  // Helper to determine if an endpoint is "primary" (zone, team, or preferred provider)
  // Primary endpoints skip CORS validation
  const isPrimaryEndpoint = (endpoint, nodeType) => {
    const address = endpoint.address || endpoint;

    // Check if it's the zone endpoint
    if (nodeType === RPC_NODE && zoneChain?.rpc === address) return true;
    if (nodeType === REST_NODE && zoneChain?.rest === address) return true;

    // Check if it's a team endpoint
    if (isTeamEndpoint(endpoint, counterpartyChain.chain_name)) return true;

    // Check if it's a preferred provider
    if (isPreferredProvider(endpoint, counterpartyChain.chain_name)) return true;

    return false;
  };

  // Helper function to perform validation for a given test type with a specific endpoint index
  const validate = async (test, endpointIndex) => {
    const nodeType = getNodeType(test);
    const baseUrl = getCounterpartyChainAddress(counterpartyChain, nodeType, endpointIndex);
    const protocol = getQueryProtocol(test);
    const endpoints = getEndpointsArray(test);

    // Skip validation if no baseUrl (chain has no endpoints defined)
    if (!baseUrl) {
      return endpoints.map((endpoint) => ({
        test,
        url: null,
        success: false,
      }));
    }

    return Promise.all(
      endpoints.map(async (endpoint) => {
        const url = constructUrl(baseUrl, endpoint, protocol);

        // Handle null URL from constructUrl
        if (!url) {
          return {
            test,
            url: null,
            success: false,
          };
        }

        const result = await queryUrl(url, test);
        const success = evaluateResult(result, test);
        logResult(url, result, success);

        const validationResult = {
          test,
          url,
          success,
        };

        // Add error classification for failed tests
        if (!success) {
          const errorType = classifyError(result, test);
          if (errorType) {
            validationResult.errorType = errorType;
          }
          if (result.message) {
            validationResult.errorMessage = result.message;
          }
        }

        if (endpoint === "status") {
          const latestBlockTime = new Date(result?.sync_info?.latest_block_time);
          const lenientDateUTC = new Date(currentDateUTC - 60 * 60 * 1000);
          validationResult.stale = latestBlockTime < lenientDateUTC;
        }

        return validationResult;
      })
    );
  };

  // RPC and REST tests are independent
  const rpcTestTypes = [RPC_CORS, RPC_WSS, RPC_ENDPOINTS];
  const restTestTypes = [REST_CORS, REST_ENDPOINTS];

  // Get all RPC endpoints with original indices
  const rpcEndpoints = (counterpartyChain?.apis?.rpc || []).map((ep, idx) => ({
    ...ep,
    originalIndex: idx
  }));

  // Sort by provider preference (Team > Keplr/Polkachu > Others)
  const sortedRpcEndpoints = sortEndpointsByProvider(rpcEndpoints, counterpartyChain.chain_name);

  // Get endpoint counts
  const rpcCount = sortedRpcEndpoints.length;
  const restCount = getEndpointCount(counterpartyChain, REST_NODE);

  // Store all tested endpoints for detailed reporting
  const allTestedEndpoints = [];

  // Find working RPC endpoint (test in preferred order)
  let rpcResults = null;
  let rpcEndpointIndex = 0;
  let rpcAddress = null;
  let rpcCorsPassed = false;

  for (let i = 0; i < rpcCount; i++) {
    const endpoint = sortedRpcEndpoints[i];

    // Temporarily modify counterpartyChain to test this endpoint
    const originalRpcArray = counterpartyChain.apis.rpc;
    counterpartyChain.apis.rpc = [endpoint];

    const results = await Promise.all(rpcTestTypes.map(test => validate(test, 0)));
    const flatResults = results.flat();

    // Restore original array
    counterpartyChain.apis.rpc = originalRpcArray;

    // Check if all RPC tests passed
    // For primary endpoints (zone/team/preferred), skip CORS validation
    const isPrimary = isPrimaryEndpoint(endpoint, RPC_NODE);
    const resultsToCheck = isPrimary
      ? flatResults.filter(r => r.test !== RPC_CORS)  // Skip CORS for primary endpoints
      : flatResults;  // Require CORS for backup endpoints

    // Separate CORS from connectivity tests
    const corsTests = flatResults.filter(r => r.test === RPC_CORS);
    const connectivityTests = flatResults.filter(r => r.test !== RPC_CORS);

    const connectivityPassed = connectivityTests.every(r => r.success && !r.stale);
    const corsPassed = isPrimary || corsTests.every(r => r.success);

    // Store this endpoint's test results
    allTestedEndpoints.push({
      type: 'rpc',
      address: endpoint.address,
      isPrimary: isPrimary,
      orderTested: i,
      connectivityPassed: connectivityPassed,
      corsPassed: corsPassed,
      testResults: flatResults
    });

    const allPassed = resultsToCheck.every(r => r.success && !r.stale);
    if (allPassed) {
      if (isPrimary && flatResults.some(r => r.test === RPC_CORS && !r.success)) {
        console.log(`RPC Primary Endpoint (CORS skipped): ${endpoint.address}`);
      }
      // Only record endpoint info if validation succeeded
      rpcResults = flatResults;
      rpcEndpointIndex = endpoint.originalIndex; // Use original Chain Registry index
      rpcAddress = endpoint.address;
      rpcCorsPassed = corsPassed;

      if (endpoint.originalIndex > 0) {
        console.log(`RPC Backup Used [${endpoint.originalIndex}]: ${rpcAddress}`);
      }
      break;
    } else {
      // Store last failed results for reporting
      rpcResults = flatResults;
    }
  }

  // Get all REST endpoints with original indices
  const restEndpoints = (counterpartyChain?.apis?.rest || []).map((ep, idx) => ({
    ...ep,
    originalIndex: idx
  }));

  // Sort by provider preference (Team > Keplr/Polkachu > Others)
  const sortedRestEndpoints = sortEndpointsByProvider(restEndpoints, counterpartyChain.chain_name);

  // Find working REST endpoint (test in preferred order)
  let restResults = null;
  let restEndpointIndex = 0;
  let restAddress = null;
  let restCorsPassed = false;

  for (let i = 0; i < sortedRestEndpoints.length; i++) {
    const endpoint = sortedRestEndpoints[i];

    // Temporarily modify counterpartyChain to test this endpoint
    const originalRestArray = counterpartyChain.apis.rest;
    counterpartyChain.apis.rest = [endpoint];

    const results = await Promise.all(restTestTypes.map(test => validate(test, 0)));
    const flatResults = results.flat();

    // Restore original array
    counterpartyChain.apis.rest = originalRestArray;

    // Check if all REST tests passed
    // For primary endpoints (zone/team/preferred), skip CORS validation
    const isPrimary = isPrimaryEndpoint(endpoint, REST_NODE);
    const resultsToCheck = isPrimary
      ? flatResults.filter(r => r.test !== REST_CORS)  // Skip CORS for primary endpoints
      : flatResults;  // Require CORS for backup endpoints

    // Separate CORS from connectivity tests
    const corsTests = flatResults.filter(r => r.test === REST_CORS);
    const connectivityTests = flatResults.filter(r => r.test !== REST_CORS);

    const connectivityPassed = connectivityTests.every(r => r.success);
    const corsPassed = isPrimary || corsTests.every(r => r.success);

    // Store this endpoint's test results
    allTestedEndpoints.push({
      type: 'rest',
      address: endpoint.address,
      isPrimary: isPrimary,
      orderTested: i,
      connectivityPassed: connectivityPassed,
      corsPassed: corsPassed,
      testResults: flatResults
    });

    const allPassed = resultsToCheck.every(r => r.success);
    if (allPassed) {
      if (isPrimary && flatResults.some(r => r.test === REST_CORS && !r.success)) {
        console.log(`REST Primary Endpoint (CORS skipped): ${endpoint.address}`);
      }
      // Only record endpoint info if validation succeeded
      restResults = flatResults;
      restEndpointIndex = endpoint.originalIndex; // Use original Chain Registry index
      restAddress = endpoint.address;
      restCorsPassed = corsPassed;

      if (endpoint.originalIndex > 0) {
        console.log(`REST Backup Used [${endpoint.originalIndex}]: ${restAddress}`);
      }
      break;
    } else {
      // Store last failed results for reporting
      restResults = flatResults;
    }
  }

  // Combine results
  const allResults = [...(rpcResults || []), ...(restResults || [])];

  // Determine if primary endpoints were used (for CORS skipping in validation success check)
  const rpcIsPrimary = rpcAddress ? isPrimaryEndpoint({ address: rpcAddress }, RPC_NODE) : false;
  const restIsPrimary = restAddress ? isPrimaryEndpoint({ address: restAddress }, REST_NODE) : false;

  // Return results with endpoint information
  return {
    results: allResults,
    allTestedEndpoints,  // NEW: Detailed test results for all endpoints
    rpcEndpointIndex,
    restEndpointIndex,
    rpcAddress,
    restAddress,
    rpcIsPrimary,
    restIsPrimary,
    rpcCorsPassed,  // NEW: Whether RPC CORS passed
    restCorsPassed  // NEW: Whether REST CORS passed
  };

}


function determineValidationSuccess(validationResults, rpcIsPrimary = false, restIsPrimary = false, rpcCorsPassed = false, restCorsPassed = false) {
  // Separate RPC and REST results
  const rpcResults = validationResults.filter(r =>
    r.test === RPC_CORS || r.test === RPC_WSS || r.test === RPC_ENDPOINTS
  );
  const restResults = validationResults.filter(r =>
    r.test === REST_CORS || r.test === REST_ENDPOINTS
  );

  // Check RPC connectivity (non-CORS tests)
  const rpcConnectivityTests = rpcResults.filter(r => r.test !== RPC_CORS);
  const rpcConnectivitySuccess = rpcConnectivityTests.length > 0 &&
    rpcConnectivityTests.every(r => r.success && !r.stale);

  // Check REST connectivity (non-CORS tests)
  const restConnectivityTests = restResults.filter(r => r.test !== REST_CORS);
  const restConnectivitySuccess = restConnectivityTests.length > 0 &&
    restConnectivityTests.every(r => r.success);

  // Overall validation succeeds if EITHER RPC OR REST works
  const validationSuccess = rpcConnectivitySuccess || restConnectivitySuccess;

  return {
    validationSuccess: validationSuccess,
    rpcStatus: {
      connectivitySuccess: rpcConnectivitySuccess,
      corsSuccess: rpcCorsPassed
    },
    restStatus: {
      connectivitySuccess: restConnectivitySuccess,
      corsSuccess: restCorsPassed
    }
  };
}

function constructValidationRecord(counterpartyChainName, validationData) {
  // Determine validation status (separate RPC/REST and connectivity/CORS)
  const status = determineValidationSuccess(
    validationData.results,
    validationData.rpcIsPrimary,
    validationData.restIsPrimary,
    validationData.rpcCorsPassed,
    validationData.restCorsPassed
  );

  const record = {
    chain_name: counterpartyChainName,
    validationDate: currentDateUTC,
    validationSuccess: status.validationSuccess,  // false only if BOTH RPC and REST fail
    rpcStatus: status.rpcStatus,  // NEW: separate RPC status
    restStatus: status.restStatus,  // NEW: separate REST status
    allTestedEndpoints: validationData.allTestedEndpoints || [],  // NEW: Detailed test results
    validationResults: validationData.results  // Keep for backward compatibility
  };

  // Add backup endpoint information if any backup was used
  if (validationData.rpcEndpointIndex > 0 || validationData.restEndpointIndex > 0) {
    record.backupUsed = {
      rpcEndpointIndex: validationData.rpcEndpointIndex,
      restEndpointIndex: validationData.restEndpointIndex,
      rpcAddress: validationData.rpcAddress,
      restAddress: validationData.restAddress
    };
  }

  return record;
}

function addValidationRecordsToState(state, chainName, validationRecords) {

  
  getState(chainName);

  if (!state.chains) { state.chains = []; }

  // Track chains validated in this run
  const validatedInThisRun = validationRecords.map(r => r.chain_name);
  state.lastValidationRun = {
    timestamp: currentDateUTC.toISOString(),
    chainsValidated: validatedInThisRun
  };

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

function prioritizeChains(chainlist, state) {
  const chainsWithPriority = chainlist.map(chain => {
    const stateChain = state.chains?.find(c => c.chain_name === chain.chain_name);

    let priority = 2; // Default: normal priority
    let validationDate = null;
    let validationSuccess = null;

    if (stateChain) {
      validationDate = new Date(stateChain.validationDate);
      validationSuccess = stateChain.validationSuccess;

      // Priority 1: Failed chains (most recent validation failed)
      if (validationSuccess === false) {
        priority = 1;
      }
    } else {
      // Priority 1: Never validated chains
      priority = 1;
      validationDate = new Date(0); // Epoch time for never validated
    }

    return {
      chain: chain,
      priority: priority,
      validationDate: validationDate,
      validationSuccess: validationSuccess,
      recentlyQueried: chainRecentlyQueried(state, chain.chain_name)
    };
  });

  // Sort by priority first, then by validation date (oldest first)
  chainsWithPriority.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    if (a.validationDate && b.validationDate) {
      return a.validationDate.getTime() - b.validationDate.getTime();
    }

    if (!a.validationDate) return -1;
    if (!b.validationDate) return 1;
    return 0;
  });

  return chainsWithPriority;
}

async function validateEndpointsForAllCounterpartyChains(chainName) {
  if (chainName !== "osmosis") { return; }
  const chainlist = getChainlist(chainName)?.chains;
  if (!chainlist) { return; }

  let state = getState(chainName);
  let chainQueryQueue = [];

  // Get prioritized chain list
  const prioritizedChains = prioritizeChains(chainlist, state);

  console.log(`\nChain Prioritization Summary:`);
  console.log(`Total chains: ${chainlist.length}`);
  const failedChains = prioritizedChains.filter(c => c.priority === 1 && c.validationSuccess === false);
  const neverValidated = prioritizedChains.filter(c => c.priority === 1 && c.validationSuccess === null);
  console.log(`Priority 1 - Failed: ${failedChains.length}, Never validated: ${neverValidated.length}`);
  console.log(`Limit for successful chains: ${numChainsToQuery}\n`);

  // Build queue - ALL priority 1 (failed/never validated) + up to limit of priority 2 (successful)
  let numPriority1Added = 0;
  let numPriority2Added = 0;

  for (const prioritizedChain of prioritizedChains) {
    if (prioritizedChain.recentlyQueried) { continue; }

    // Skip killed chains
    if (prioritizedChain.chain.status === 'killed') {
      console.log(`Skipping killed chain: ${prioritizedChain.chain.chain_name}`);
      continue;
    }

    // Add all Priority 1 chains (failed + never validated)
    if (prioritizedChain.priority === 1) {
      chainQueryQueue.push(prioritizedChain.chain);
      numPriority1Added++;
      const type = prioritizedChain.validationSuccess === false ? 'Failed' : 'Never Validated';
      console.log(`[P1-${numPriority1Added}] ${prioritizedChain.chain.chain_name} (${type}, Last: ${prioritizedChain.validationDate?.toISOString() || 'never'})`);
    }
    // Add Priority 2 chains (successful) up to the limit
    else if (prioritizedChain.priority === 2) {
      if (numPriority2Added >= numChainsToQuery) { break; }
      chainQueryQueue.push(prioritizedChain.chain);
      numPriority2Added++;
      console.log(`[P2-${numPriority2Added}/${numChainsToQuery}] ${prioritizedChain.chain.chain_name} (Last: ${prioritizedChain.validationDate?.toISOString() || 'never'})`);
    }
  }

  console.log(`\nQueue Summary: ${numPriority1Added} failed/never validated + ${numPriority2Added} successful = ${chainQueryQueue.length} total`);

  if (chainQueryQueue.length === 0) {
    console.log("\nNo chains need validation. All recently queried.");
    return;
  }

  console.log(`\nValidating ${chainQueryQueue.length} chains...\n`);

  // Generate validation promises
  const validationPromises = chainQueryQueue.map(async (counterpartyChain) => {
    const validationResults = await validateCounterpartyChain(counterpartyChain, chainName);
    return constructValidationRecord(counterpartyChain.chain_name, validationResults);
  });

  const validationRecords = await Promise.all(validationPromises);
  addValidationRecordsToState(state, chainName, validationRecords);
}

async function fullValidation(chainName) {

  if (chainName !== "osmosis") { return; } // temporary--just focusing on mainnet for now
  const chainlist = getChainlist(chainName)?.chains;
  if (!chainlist) { return; }

  let state = getState(chainName);

  console.log(`Starting full validation of ${chainlist.length} chains...`);

  // Validate chains in batches to avoid overwhelming the system
  const batchSize = 10;
  for (let i = 0; i < chainlist.length; i += batchSize) {
    const batch = chainlist.slice(i, Math.min(i + batchSize, chainlist.length));

    console.log(`Validating chains ${i + 1}-${Math.min(i + batchSize, chainlist.length)} of ${chainlist.length}...`);

    // Generate validation promises for this batch
    const validationPromises = batch.map(async (counterpartyChain) => {
      const validationResults = await validateCounterpartyChain(counterpartyChain, chainName);
      return constructValidationRecord(counterpartyChain.chain_name, validationResults);
    });

    // Wait for all validations in this batch and collect the records
    const validationRecords = await Promise.all(validationPromises);

    // Add validation records to state
    addValidationRecordsToState(state, chainName, validationRecords);

    console.log(`Batch completed. ${Math.min(i + batchSize, chainlist.length)}/${chainlist.length} chains validated.`);
  }

  console.log('Full validation complete!');
}

function routineBulkValidation() {
  zone.chainNames.forEach(chainName => validateEndpointsForAllCounterpartyChains(chainName));
}

async function validateSpecificChain(chainName, chain_name) {

  const chainlist = getChainlist(chainName)?.chains;
  if (!chainlist) { return; }

  let state = getState(chainName);
  let chainQueryQueue = [];

  for (const counterpartyChain of chainlist) {
    if (counterpartyChain.chain_name !== chain_name) { continue; }
    chainQueryQueue.push(counterpartyChain);
    break;
  }

  // Generate validation promises and return records directly
  const validationPromises = chainQueryQueue.map(async (counterpartyChain) => {
    const validationResults = await validateCounterpartyChain(counterpartyChain, chainName);
    return constructValidationRecord(counterpartyChain.chain_name, validationResults);
  });

  // Wait for all validations and collect the records
  const validationRecords = await Promise.all(validationPromises);

  // Add validation records to state
  addValidationRecordsToState(state, chainName, validationRecords);

}

function generateValidationReport(chainName) {
  const state = getState(chainName);

  if (!state.chains || state.chains.length === 0) {
    console.log("\nNo validation data available.");
    return;
  }

  // Get chainlist to check for killed chains
  const chainlist = getChainlist(chainName);
  const killedChainNames = chainlist?.chains
    ?.filter(c => c.status === 'killed')
    ?.map(c => c.chain_name) || [];

  // Get zone chains config to check for forced endpoints
  const zoneChains = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneChainlistFileName
  )?.chains || [];

  const forcedEndpointChains = {};
  zoneChains.forEach(chain => {
    if (chain.override_properties?.force_rpc || chain.override_properties?.force_rest) {
      forcedEndpointChains[chain.chain_name] = {
        force_rpc: chain.override_properties?.force_rpc || false,
        force_rest: chain.override_properties?.force_rest || false,
        rpc: chain.rpc,
        rest: chain.rest
      };
    }
  });

  // Get chains validated in this run
  const chainsValidatedThisRun = state.lastValidationRun?.chainsValidated || [];

  // Categorize chains by connectivity and CORS status
  const failedChains = state.chains.filter(chain => {
    if (chain.validationSuccess !== false) return false;

    // Only include chains validated in this run
    if (!chainsValidatedThisRun.includes(chain.chain_name)) return false;

    // Skip killed chains
    if (killedChainNames.includes(chain.chain_name)) return false;

    // Only include chains where at least one endpoint type completely failed
    const rpcTests = chain.validationResults?.filter(r => r.test.includes('RPC')) || [];
    const restTests = chain.validationResults?.filter(r => r.test.includes('REST')) || [];

    const rpcAllFailed = rpcTests.length > 0 && rpcTests.every(t => !t.success);
    const restAllFailed = restTests.length > 0 && restTests.every(t => !t.success);

    // Include if at least one endpoint type completely failed (exclude double partials)
    return rpcAllFailed || restAllFailed;
  }).sort((a, b) => {
    // Sort by newest validation first
    const dateA = new Date(a.validationDate);
    const dateB = new Date(b.validationDate);
    return dateB.getTime() - dateA.getTime();
  });

  // Find chains with CORS partial failures (connectivity OK but CORS failed)
  const corsPartialFail = state.chains.filter(chain => {
    if (!chain.validationSuccess) return false;  // Skip full failures
    if (!chainsValidatedThisRun.includes(chain.chain_name)) return false;
    if (killedChainNames.includes(chain.chain_name)) return false;

    // Check if there's a CORS issue (connectivity OK but CORS failed)
    const rpcCorsIssue = chain.rpcStatus?.connectivitySuccess && !chain.rpcStatus?.corsSuccess;
    const restCorsIssue = chain.restStatus?.connectivitySuccess && !chain.restStatus?.corsSuccess;
    return rpcCorsIssue || restCorsIssue;
  }).sort((a, b) => {
    const dateA = new Date(a.validationDate);
    const dateB = new Date(b.validationDate);
    return dateB.getTime() - dateA.getTime();
  });

  // Check for forced endpoint failures
  const forcedEndpointFailures = failedChains.filter(chain =>
    forcedEndpointChains[chain.chain_name]
  );

  // Count chains with backup endpoints used (only from this run)
  const chainsWithBackupsUsed = state.chains.filter(chain =>
    chain.backupUsed && chainsValidatedThisRun.includes(chain.chain_name)
  ).length;

  const successfulThisRun = chainsValidatedThisRun.length - failedChains.length - corsPartialFail.length;
  const fullySuccessful = successfulThisRun;

  let report = `**Chains Validated This Run:** ${chainsValidatedThisRun.length}\n`;
  report += `**Fully Successful:** ${fullySuccessful}\n`;
  report += `**CORS Partial Failures:** ${corsPartialFail.length}\n`;
  report += `**Connectivity Failed:** ${failedChains.length}\n`;
  report += `**Using Backup Endpoints:** ${chainsWithBackupsUsed}\n\n`;

  // Alert for forced endpoint failures
  if (forcedEndpointFailures.length > 0) {
    report += `### 🔒 Forced Endpoint Failures\n\n`;
    report += `The following chains have forced endpoints that failed validation. These endpoints are locked in first position and cannot fall back to backups:\n\n`;
    report += `| Chain Name | Forced RPC | Forced REST | RPC Status | REST Status |\n`;
    report += `|------------|-----------|------------|------------|-------------|\n`;

    forcedEndpointFailures.forEach(chain => {
      const config = forcedEndpointChains[chain.chain_name];
      const rpcTests = chain.validationResults?.filter(r => r.test.includes('RPC')) || [];
      const restTests = chain.validationResults?.filter(r => r.test.includes('REST')) || [];

      const rpcAllFailed = rpcTests.every(t => !t.success);
      const restAllFailed = restTests.every(t => !t.success);

      const rpcStatus = rpcAllFailed ? '❌ All Failed' : '⚠️ Partial';
      const restStatus = restAllFailed ? '❌ All Failed' : '⚠️ Partial';

      const forcedRpc = config.force_rpc ? '🔒 ' + config.rpc : '—';
      const forcedRest = config.force_rest ? '🔒 ' + config.rest : '—';

      report += `| ${chain.chain_name} | ${forcedRpc} | ${forcedRest} | ${rpcStatus} | ${restStatus} |\n`;
    });
    report += `\n**Action Required:** Update the forced endpoints in \`osmosis.zone_chains.json\` or remove the force flags.\n\n`;
  }

  // Report CORS partial failures (connectivity OK, CORS failed)
  if (corsPartialFail.length > 0) {
    report += `### 📡 CORS Partial Failures (Connectivity OK)\n\n`;
    report += `The following chains have working endpoints but failed CORS validation. This may not affect browser-based frontend functionality.\n\n`;
    report += `| Chain Name | RPC Status | REST Status | Last Validation |\n`;
    report += `|------------|------------|-------------|----------------|\n`;

    corsPartialFail.forEach(chain => {
      const validationDate = new Date(chain.validationDate).toISOString().split('T')[0];

      // RPC status
      let rpcStatus = '—';
      if (chain.rpcStatus) {
        if (chain.rpcStatus.connectivitySuccess && chain.rpcStatus.corsSuccess) {
          rpcStatus = '✅ Full Pass';
        } else if (chain.rpcStatus.connectivitySuccess && !chain.rpcStatus.corsSuccess) {
          rpcStatus = '⚠️ CORS Failed';
        } else if (!chain.rpcStatus.connectivitySuccess) {
          rpcStatus = '❌ Connectivity Failed';
        }
      }

      // REST status
      let restStatus = '—';
      if (chain.restStatus) {
        if (chain.restStatus.connectivitySuccess && chain.restStatus.corsSuccess) {
          restStatus = '✅ Full Pass';
        } else if (chain.restStatus.connectivitySuccess && !chain.restStatus.corsSuccess) {
          restStatus = '⚠️ CORS Failed';
        } else if (!chain.restStatus.connectivitySuccess) {
          restStatus = '❌ Connectivity Failed';
        }
      }

      report += `| ${chain.chain_name} | ${rpcStatus} | ${restStatus} | ${validationDate} |\n`;
    });
    report += `\n`;
  }

  if (failedChains.length === 0 && corsPartialFail.length === 0) {
    report += `### ✅ All Chains Validated Successfully\n\n`;
  } else if (failedChains.length > 0) {
    report += `### ❌ Connectivity Failures\n\n`;
    report += `The following chains have endpoints that failed connectivity tests (not just CORS):\n\n`;
    report += `| Chain Name | Last Validation | Days Ago | RPC Status | REST Status |\n`;
    report += `|------------|----------------|----------|------------|-------------|\n`;

    failedChains.forEach(chain => {
      const validationDate = new Date(chain.validationDate);
      const daysSince = Math.floor((new Date().getTime() - validationDate.getTime()) / oneDayInMs);

      const rpcTests = chain.validationResults?.filter(r => r.test.includes('RPC')) || [];
      const restTests = chain.validationResults?.filter(r => r.test.includes('REST')) || [];

      const rpcAllFailed = rpcTests.every(t => !t.success);
      const restAllFailed = restTests.every(t => !t.success);

      const rpcStatus = rpcAllFailed ? '❌ All Failed' : '⚠️ Partial';
      const restStatus = restAllFailed ? '❌ All Failed' : '⚠️ Partial';

      report += `| ${chain.chain_name} | ${validationDate.toISOString().split('T')[0]} | ${daysSince} | ${rpcStatus} | ${restStatus} |\n`;
    });
    report += `\n`;
  }

  // Show chains that switched to backup endpoints (only those validated this run)
  if (chainsWithBackupsUsed > 0) {
    const chainsWithBackups = state.chains.filter(chain => {
      if (!chain.backupUsed) return false;
      // Only include chains validated in this run
      if (state.lastValidationRun?.chainsValidated) {
        return state.lastValidationRun.chainsValidated.includes(chain.chain_name);
      }
      // Fallback: include all if lastValidationRun not available
      return true;
    });

    if (chainsWithBackups.length > 0) {
      report += `### 🔄 Endpoint Reordering (Backup Endpoints Used)\n\n`;
      report += `The following chains had their zone endpoint fail validation and were reordered to use a working backup:\n\n`;
      report += `| Chain Name | RPC Endpoint Type | REST Endpoint Type | Last Validation |\n`;
      report += `|------------|-------------------|-------------------|----------------|\n`;

      chainsWithBackups.forEach(chain => {
        const validationDate = new Date(chain.validationDate).toISOString().split('T')[0];

        // Determine RPC endpoint type
        let rpcType = '—';
        if (chain.backupUsed.rpcAddress) {
          const zoneChain = zoneChains.find(z => z.chain_name === chain.chain_name);
          if (zoneChain?.rpc && chain.backupUsed.rpcAddress === zoneChain.rpc) {
            rpcType = 'Chainlist';
          } else if (isPreferredProvider({ address: chain.backupUsed.rpcAddress }, chain.chain_name)) {
            const provider = getProviderFromEndpoint({ address: chain.backupUsed.rpcAddress });
            rpcType = `Preferred (${provider})`;
          } else {
            const index = chain.backupUsed.rpcEndpointIndex || 0;
            rpcType = `Backup #${index}`;
          }
        }

        // Determine REST endpoint type
        let restType = '—';
        if (chain.backupUsed.restAddress) {
          const zoneChain = zoneChains.find(z => z.chain_name === chain.chain_name);
          if (zoneChain?.rest && chain.backupUsed.restAddress === zoneChain.rest) {
            restType = 'Chainlist';
          } else if (isPreferredProvider({ address: chain.backupUsed.restAddress }, chain.chain_name)) {
            const provider = getProviderFromEndpoint({ address: chain.backupUsed.restAddress });
            restType = `Preferred (${provider})`;
          } else {
            const index = chain.backupUsed.restEndpointIndex || 0;
            restType = `Backup #${index}`;
          }
        }

        report += `| ${chain.chain_name} | ${rpcType} | ${restType} | ${validationDate} |\n`;
      });
      report += `\n`;
    }
  }

  // Always output report to stdout (for capturing to file)
  console.log(report);

  // Also write to GitHub Actions summary if available
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, report);
      console.error("✓ Report written to GitHub Actions summary");
    } catch (error) {
      console.error("Failed to write summary:", error);
    }
  }
}

//routineBulkValidation();

const functions = {
  routineBulkValidation: () => {
    console.log("Running routineBulkValidation...");
    routineBulkValidation();
  },
  fullValidation: (chainName = "osmosis") => {
    console.log("Running fullValidation...");
    fullValidation(chainName);
  },
  validateSpecificChain: (chainName, chain_name) => {
    console.log("Running validateSpecificChain...");
    validateSpecificChain(chainName, chain_name);
  },
  generateReport: (chainName = "osmosis") => {
    console.error("Running generateReport...");
    generateValidationReport(chainName);
  },
};

const [, , funcName, ...args] = process.argv;

if (functions[funcName]) {
  functions[funcName](...args);
} else {
  console.error(`Error: Unknown function '${funcName}'`);
  process.exit(1); // Exit with error code if the function is unknown
}

/*
 * validateSpecificChain("osmosis", "konstellation");
 * > node validateEndpoints.mjs validateSpecificChain "osmosis" "konstellation"
 */