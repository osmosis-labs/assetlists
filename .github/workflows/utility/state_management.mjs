
import * as zone from "./assetlist_functions.mjs";

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
}

export function removeFromState(state, value, status, items) {
  if (!state || !state[value] || !state[value][status]) { return; }
  state[value][status] = zone.removeElements(state[value][status], items);
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