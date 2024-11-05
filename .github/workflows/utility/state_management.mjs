
import * as zone from "./assetlist_functions.mjs";
import * as api_mgmt from "./api_management.mjs";

const outputFileName = "output.json";
const stateFileName = "state.json";

export const Status = Object.freeze({
  PENDING: "PENDING",
  COMPLETED: "COMPLETED"
});

export function readStateFile(chainName, dir) {
  return zone.readFromFile(chainName, dir, stateFileName);
}

export function writeStateFile(chainName, dir, state) {
  zone.writeToFile(chainName, dir, stateFileName, state);
}

export function readOutputFile(chainName, dir) {
  return zone.readFromFile(chainName, dir, outputFileName);
}

export function writeOutputFile(chainName, dir, output) {
  zone.writeToFile(chainName, dir, outputFileName, output);
}

export function addToState(state, value, status, items) {
  state ??= {};
  state[value] ??= {};
  state[value][status] ??= [];
  items?.forEach((item) => {
    state[value][status].push(item);
  });
  state.updated = 1;
}

function getNestedReference(structure, location, createIfMissing = false) {
  const keys = location
    .replace(/\[(\d+)\]/g, '.$1') // Convert array indices to dot notation
    .split('.'); // Split by dots
  let current = structure;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      if (createIfMissing) {
        const nextKey = keys[i + 1];
        current[key] = /^\d+$/.test(nextKey) ? [] : {}; // Create an array if nextKey is a number, else create an object
      } else {
        return null; // If not creating and path doesn't exist, return null
      }
    }
    current = current[key];
  }
  return { parent: current, key: keys[keys.length - 1] };
}

export function getStructureValue(structure, location) {
  const ref = getNestedReference(structure, location);
  return ref.parent[ref.key];
}

export function setStructureValue(structure, location, value) {
  const ref = getNestedReference(structure, location, true);
  ref.parent[ref.key] = value;
}

export function removeFromState(state, value, status, items) {
  if (!state || !state[value] || !state[value][status]) { return; }
  state[value][status] = zone.removeElements(state[value][status], items);
  state.updated = 1;
}

export function addToOutput(output, value, items) {
  output ??= {};
  output[value] ??= {};
  items?.forEach((item) => {
    output[value].push(item);
  });
}

export function removeFromOutput(output, value, items) {
  if (!output || !output[value]) { return; }
  items?.forEach((item) => {
    output[value] = output[value].filter(obj => !obj[item]);
  });
}

export function saveUpdates(memory, state, output) {
  if (state.updated) {
    delete state.updated;
    writeStateFile(memory.chainName, memory.dir, state);
    writeOutputFile(memory.chainName, memory.dir, output);
    console.log("Updated files!");
  }
}

export async function checkPendingUpdates(query, condition, state, output) {
  const value = Status.PENDING;
  if (!(state?.[Status.PENDING]?.length > 0)) { return; }
  let keys = [];
  for (let i = 0; i < amount; i++) {
    const item = state[Status.PENDING][i];
    keys.push(item);
  }
  let results = {
    [Status.COMPLETED]: [],
    [Status.PENDING]: []
  }
  await api_mgmt.queryKeys(query, keys, condition, results[Status.COMPLETED], results[Status.PENDING]);
  if (results[Status.COMPLETED].length === 0) { return; }
  state_mgmt.removeFromState(state, value, state.Status.PENDING, results[state_mgmt.Status.COMPLETED]);
  state_mgmt.addToState(state, value, state.Status.COMPLETED, results[state_mgmt.Status.COMPLETED]);
  state_mgmt.removeFromOutput(output, value, results[state_mgmt.Status.COMPLETED]);
}

//let fetch = {};
//fetch.details = query;
//fetch.function = (details, keys, condition, conditionMet, conditionNotMet) => api_mgmt.queryKeys(details, keys, condition, conditionMet, conditionNotMet);

export async function checkPendingUpdatesNew(getData, condition, state, stateLocation, output, outputLocation) {
  let pendingArray = getStructureValue(state, stateLocation)?.[Status.PENDING];
  if (!(pendingArray > 0)) { return; }

  let keys = array;
  let results = {
    [Status.COMPLETED]: [],
    [Status.PENDING]: []
  }
  await getData.function(fetch.details, keys, condition, results[Status.COMPLETED], results[Status.PENDING]);

  let completedArray = getStructureValue(state, stateLocation)?.[Status.COMPLETED];
  if (results[Status.COMPLETED].length === 0) { return; }
  let outputArray = getStructureValue(output, outputLocation)?.[Status.COMPLETED];

  setStructureValue(state, stateLocation[Status.PENDING], zone.removeElements(pendingArray, results[Status.COMPLETED]));
  setStructureValue(state, stateLocation[Status.COMPLETED], completedArray.push(...results[Status.COMPLETED]));
  setStructureValue(output, outputLocation, zone.removeElements(outputArray, results[Status.COMPLETED]));
}