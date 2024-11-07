
import * as zone from "./assetlist_functions.mjs";

const outputFileName = "output.json";
const stateFileName = "state.json";

export const Status = Object.freeze({
  PENDING: "PENDING",
  COMPLETED: "COMPLETED"
});

export function saveUpdates(memory, state, output) {
  console.log(`Update? ${state.updated ? "Yes" : "No"}`);
  if (state.updated) {
    delete state.updated;
    writeStateFile(memory.chainName, memory.dir, state);
    writeOutputFile(memory.chainName, memory.dir, output);
    console.log("Updated files!");
  }
}

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
