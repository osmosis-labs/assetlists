
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