// Purpose:
//   Cached drop-in replacements for chain_registry.mjs's getFileProperty and
//   getAssetProperty, for the lifetime of one script run.
//
//   The chain_registry.mjs versions (in the chain-registry submodule) re-read
//   and re-parse a chain's whole chain.json / assetlist.json on every call.
//   Generating the assetlist makes tens of thousands of those calls over
//   1,300+ assets, which was ~90s of the step. These parse each file once and
//   index assets by base, and return a structuredClone of the requested value
//   so every caller still gets its own copy, as with a fresh parse.
//
//   Results match the originals, including their quirks: a missing chain or
//   file returns undefined, and getAssetProperty returns the LAST asset whose
//   base matches (the original's forEach keeps going after a match).
//   Nothing writes to the chain registry during generation, so the cache is
//   never invalidated.

import * as fs from "fs";
import * as path from "path";
import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";

const parsedFiles = new Map(); // file path -> parsed JSON (undefined if unreadable)
const assetIndexes = new Map(); // chain name -> Map(base -> asset)

function getParsedFile(chainName, file) {
  const chainDirectory = chain_reg.chainNameToDirectoryMap.get(chainName);
  if (!chainDirectory) return { found: false };
  const filePath = path.join(chainDirectory, chain_reg.fileToFileNameMap.get(file));
  if (!parsedFiles.has(filePath)) {
    if (!fs.existsSync(filePath)) return { found: false };
    parsedFiles.set(filePath, chain_reg.readJsonFile(filePath));
  }
  return { found: true, value: parsedFiles.get(filePath) };
}

export function getFileProperty(chainName, file, property) {
  const { found, value } = getParsedFile(chainName, file);
  if (!found) return undefined;
  // Like the original, an unparseable file throws here.
  return structuredClone(value[property]);
}

export function getAssetProperty(chainName, baseDenom, property) {
  if (typeof baseDenom !== "string") {
    return chain_reg.getAssetProperty(chainName, baseDenom, property);
  }
  if (!assetIndexes.has(chainName)) {
    const { found, value } = getParsedFile(chainName, "assetlist");
    const index = new Map();
    for (const asset of (found ? value.assets : undefined) ?? []) {
      // The original compares asset.base == baseDenom, which a missing base
      // never satisfies for a string denom.
      if (asset.base != null) index.set(String(asset.base), asset);
    }
    assetIndexes.set(chainName, index);
  }
  const asset = assetIndexes.get(chainName).get(baseDenom);
  return asset ? structuredClone(asset[property]) : undefined;
}
