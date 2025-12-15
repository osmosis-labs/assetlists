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
console.log(`Validation mode: ${process.env.GITHUB_EVENT_NAME || 'default'} - Will query up to ${numChainsToQuery} chains`);
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
        errorCode: null,
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
        errorCode: null,
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


async function validateCounterpartyChain(counterpartyChain) {

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

  // Get endpoint counts
  const rpcCount = getEndpointCount(counterpartyChain, RPC_NODE);
  const restCount = getEndpointCount(counterpartyChain, REST_NODE);

  // Find working RPC endpoint
  let rpcResults = null;
  let rpcEndpointIndex = 0;
  let rpcAddress = null;

  for (let i = 0; i < rpcCount; i++) {
    const results = await Promise.all(rpcTestTypes.map(test => validate(test, i)));
    const flatResults = results.flat();

    rpcResults = flatResults;
    rpcEndpointIndex = i;
    rpcAddress = getCounterpartyChainAddress(counterpartyChain, RPC_NODE, i);

    // Check if all RPC tests passed
    const allPassed = flatResults.every(r => r.success && !r.stale);
    if (allPassed) {
      if (i > 0) {
        console.log(`RPC Backup Used [${i}]: ${rpcAddress}`);
      }
      break;
    }
  }

  // Find working REST endpoint
  let restResults = null;
  let restEndpointIndex = 0;
  let restAddress = null;

  for (let i = 0; i < restCount; i++) {
    const results = await Promise.all(restTestTypes.map(test => validate(test, i)));
    const flatResults = results.flat();

    restResults = flatResults;
    restEndpointIndex = i;
    restAddress = getCounterpartyChainAddress(counterpartyChain, REST_NODE, i);

    // Check if all REST tests passed
    const allPassed = flatResults.every(r => r.success);
    if (allPassed) {
      if (i > 0) {
        console.log(`REST Backup Used [${i}]: ${restAddress}`);
      }
      break;
    }
  }

  // Combine results
  const allResults = [...(rpcResults || []), ...(restResults || [])];

  // Return results with endpoint information
  return {
    results: allResults,
    rpcEndpointIndex,
    restEndpointIndex,
    rpcAddress,
    restAddress
  };

}


function determineValidationSuccess(validationResults) {
  for (const validationResult of validationResults) {
    if (!validationResult.success) { return false; }
    if (validationResults.stale) { return false; }
  }
  return true;
}

function constructValidationRecord(counterpartyChainName, validationData) {
  const record = {
    chain_name: counterpartyChainName,
    validationDate: currentDateUTC,
    validationSuccess: determineValidationSuccess(validationData.results),
    validationResults: validationData.results
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
  console.log(`Target: ${numChainsToQuery} chains\n`);

  // Build queue respecting requery delays and priority
  let numChainsQueried = 0;
  for (const prioritizedChain of prioritizedChains) {
    if (numChainsQueried >= numChainsToQuery) { break; }
    if (prioritizedChain.recentlyQueried) { continue; }

    chainQueryQueue.push(prioritizedChain.chain);
    numChainsQueried++;
    console.log(`[${numChainsQueried}/${numChainsToQuery}] ${prioritizedChain.chain.chain_name} (Priority ${prioritizedChain.priority}, Last: ${prioritizedChain.validationDate?.toISOString() || 'never'})`);
  }

  if (chainQueryQueue.length === 0) {
    console.log("\nNo chains need validation. All recently queried.");
    return;
  }

  console.log(`\nValidating ${chainQueryQueue.length} chains...\n`);

  // Generate validation promises
  const validationPromises = chainQueryQueue.map(async (counterpartyChain) => {
    const validationResults = await validateCounterpartyChain(counterpartyChain);
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
      const validationResults = await validateCounterpartyChain(counterpartyChain);
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
    const validationResults = await validateCounterpartyChain(counterpartyChain);
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

  const failedChains = state.chains.filter(chain =>
    chain.validationSuccess === false
  ).sort((a, b) => {
    const dateA = new Date(a.validationDate);
    const dateB = new Date(b.validationDate);
    return dateB.getTime() - dateA.getTime();
  });

  let report = `# Endpoint Validation Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += `**Total Chains:** ${state.chains.length}\n`;
  report += `**Failed Validations:** ${failedChains.length}\n`;
  report += `**Success Rate:** ${((state.chains.length - failedChains.length) / state.chains.length * 100).toFixed(1)}%\n\n`;

  if (failedChains.length === 0) {
    report += `## ✅ All Chains Validated Successfully\n\n`;
  } else {
    report += `## ⚠️ Chains with Failed Validations\n\n`;
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

    report += `\n### Top 10 Failed Chains (Details)\n\n`;
    failedChains.slice(0, 10).forEach(chain => {
      report += `#### ${chain.chain_name}\n`;
      report += `- **Last Validation:** ${new Date(chain.validationDate).toISOString()}\n`;

      if (chain.validationResults) {
        const failedTests = chain.validationResults.filter(r => !r.success);
        report += `- **Failed Tests:** ${failedTests.length}/${chain.validationResults.length}\n`;
        failedTests.forEach(test => {
          report += `  - ${test.test}: ${test.url || 'N/A'}\n`;
        });
      }
      report += `\n`;
    });

    if (failedChains.length > 10) {
      report += `*Showing top 10. Total failed: ${failedChains.length}*\n`;
    }
  }

  // Write to GitHub Actions summary
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, report);
      console.log("\n✓ Report written to GitHub Actions summary");
    } catch (error) {
      console.error("Failed to write summary:", error);
      console.log("\n" + report);
    }
  } else {
    console.log("\n" + report);
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
    console.log("Running generateReport...");
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