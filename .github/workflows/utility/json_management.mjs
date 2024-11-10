
import * as fs from 'fs';

function getNestedReference(structure, location, createIfMissing = false) {
  const keys = location
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.');
  let current = structure;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      if (createIfMissing) {
        const nextKey = keys[i + 1];
        current[key] = /^\d+$/.test(nextKey) ? [] : {};
      } else {
        return null;
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

export function readFromFile(location) {
  try {
    return JSON.parse(
      fs.readFileSync(location)
    );
  } catch (err) {
    console.log(err);
  }
}

export function writeToFile(location, value, indent = 2) {
  try {
    fs.writeFileSync(
      location,
      JSON.stringify(value, null, indent),
      (err) => {
        if (err) throw err;
      }
    );
  } catch (err) {
    console.log(err);
  }
}