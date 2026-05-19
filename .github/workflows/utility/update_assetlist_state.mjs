
/*  Purpose:
 *    to manage the state for Osmosis Zone assets
 *    which includes data like: listingDate, ...
 * 
 * 
 *  State:
 *    "assets": []
 *      for each asset object{}:
 *        "base_denom": "uosmo",
 *        "listingDate": "{UTC date time format}",
 *        "legacyAsset": true,
 *        ...
 * 
 * 
 *  Plan:
 *    For each asset, see if it's verified, if so, we should have a listing date for it
 *    see if we have a listing date in the state
 *    if so, proceed to next
 *    if not, we should add a listing date for that asset to the state
 *    unless they are a legacy asset, which wew can determine from the state
 *  
 *  Note about Legacy Assets:
 *    however, many verified assets don't have a listing date, in which case, we should identify them as a legacy asset
 *    the state will keep a property 'legacyAsset: true' where the asset is verified but doesn't have a listing date
 *    legacyAssets will have to be populated manually, but they are easier to identify in an initial setup
 *    becase they are just all the verified assets without any listingDate
 * 
 * 
 * */


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as path from 'path';

const stateFileName = "state.json";
const stateDirName = "state";
const stateDir = path.join(zone.generatedDirectoryName, stateDirName);

const stateLocations = [
  "assets"
];
const stateAssetProperties = [
  "listingDate",
  "legacyAsset"
];

const currentDateUTC = new Date().toISOString();


/**
 * Set listing date for a verified asset
 *
 * LISTING DATE WORKFLOW:
 * When an asset transitions from unverified → verified, we record the exact date/time.
 * This allows frontends to show "Recently Listed" badges, sort by listing date, etc.
 *
 * STATE AS SOURCE OF TRUTH:
 * Listing dates are stored in state.json (persistent) and copied to assetlist.json (generated).
 * - state.json: Persistent record of when each asset was verified
 * - assetlist.json: Generated file that includes listing date from state
 *
 * LEGACY ASSET EXEMPTION:
 * Assets that were already verified BEFORE this state tracking system was implemented
 * are marked with legacyAsset: true. These assets DON'T get listing dates because:
 * - We don't know when they were originally verified
 * - Backfilling fake dates would be misleading
 * - "Recently Listed" badges shouldn't show for years-old assets
 *
 * NEW VERIFIED ASSETS:
 * When an asset becomes verified and is NOT a legacy asset:
 * - If state already has a listing date: use existing date (preserve original listing date)
 * - If state has NO listing date: assign current UTC datetime (first time verified)
 *
 * @param {Object} stateAsset - Asset record from state.json (persistent)
 * @param {Object} assetlistAsset - Asset object being added to assetlist.json (generated)
 *
 * @example
 * // Legacy asset (verified before state tracking)
 * stateAsset = { base_denom: "uosmo", legacyAsset: true }
 * assetlistAsset = { coinMinimalDenom: "uosmo", verified: true }
 * setAssetListingDate(stateAsset, assetlistAsset)
 * // Result: assetlistAsset has NO listingDate property
 *
 * @example
 * // New asset being verified for first time
 * stateAsset = { base_denom: "ibc/ABC...", listingDate: undefined }
 * assetlistAsset = { coinMinimalDenom: "ibc/ABC...", verified: true }
 * setAssetListingDate(stateAsset, assetlistAsset)
 * // Result: stateAsset.listingDate = "2024-03-15T10:30:00.000Z" (current time)
 * //         assetlistAsset.listingDate = "2024-03-15T10:30:00.000Z" (copied from state)
 *
 * @example
 * // Asset that was verified in the past (state already has date)
 * stateAsset = { base_denom: "ibc/DEF...", listingDate: "2024-01-10T08:00:00.000Z" }
 * assetlistAsset = { coinMinimalDenom: "ibc/DEF...", verified: true }
 * setAssetListingDate(stateAsset, assetlistAsset)
 * // Result: assetlistAsset.listingDate = "2024-01-10T08:00:00.000Z" (preserves original)
 */
function setAssetListingDate(stateAsset, assetlistAsset) {

  //legacy assets don't need a listing date
  if (stateAsset.legacyAsset) { return; }

  //use the recorded listing date
  if (!stateAsset.listingDate) {
    //or else it's current datetime
    stateAsset.listingDate = currentDateUTC;
  }

  //save to assetlist
  assetlistAsset.listingDate = stateAsset.listingDate;

}

/**
 * Get or create a state record for an asset
 *
 * State records are indexed by base_denom (the local denomination on Osmosis).
 * If the asset doesn't have a state record yet, we create a minimal one.
 *
 * STATE RECORD LIFECYCLE:
 * 1. Asset first becomes verified → getStateAsset() creates minimal record
 * 2. setAssetListingDate() populates listingDate
 * 3. State persisted to state.json
 * 4. Future runs: existing state record found and reused
 *
 * @param {string} base_denom - Local denomination (e.g., "uosmo", "ibc/27394FB...")
 * @param {Object} state - Full state object with assets array
 * @returns {Object} State record for this asset (existing or newly created)
 *
 * @example
 * state = { assets: [{ base_denom: "uosmo", listingDate: "..." }] }
 * getStateAsset("uosmo", state)
 * // Returns: { base_denom: "uosmo", listingDate: "..." } (existing record)
 *
 * @example
 * state = { assets: [] }
 * getStateAsset("ibc/NEW...", state)
 * // Returns: { base_denom: "ibc/NEW..." } (newly created, added to state.assets)
 */
function getStateAsset(base_denom, state) {
  let stateAsset = state.assets?.find(stateAsset => stateAsset.base_denom === base_denom);
  if (!stateAsset) {
    stateAsset = {
      base_denom: base_denom
    };
    state.assets.push(stateAsset);
  }
  return stateAsset;
}

/**
 * Generate and update state file from assetlist
 *
 * STATE FILE WORKFLOW:
 * This function maintains a persistent state.json file that tracks metadata for verified assets.
 * It's called AFTER assetlist.json is generated to update state and copy data back to assetlist.
 *
 * EXECUTION FLOW:
 * 1. Load existing state.json (or create empty state if doesn't exist)
 * 2. Iterate all assets in generated assetlist.json
 * 3. For each VERIFIED asset:
 *    - Get/create state record
 *    - Assign listing date (if not legacy asset and not already set)
 *    - Copy listing date from state → assetlist (bidirectional sync)
 * 4. Save updated state.json
 * 5. Assetlist will be saved by caller (if needed)
 *
 * BIDIRECTIONAL SYNCHRONIZATION:
 * - State → Assetlist: Listing dates are copied FROM state TO assetlist
 * - Assetlist → State: Assetlist triggers state updates (new verified assets)
 * - Why bidirectional? State is source of truth, assetlist is generated output
 *
 * ERROR RECOVERY:
 * If state.json is missing or corrupt:
 * - Creates new empty state
 * - All verified assets get current date as listing date (unless legacyAsset)
 * - This is safe: worst case, listing dates are reset to "now"
 *
 * VERIFIED ASSETS ONLY:
 * Unverified assets are skipped - no state tracking needed until they're verified.
 * This keeps state.json focused on production assets that users can trade.
 *
 * @param {string} chainName - Zone chain name (e.g., "osmosis-1", "osmo-test-5")
 * @param {Object} assetlist - Generated assetlist object with assets array (mutated in place)
 *
 * @example
 * // Normal workflow (called from generate_assetlist.mjs)
 * assetlist = {
 *   chainName: "osmosis-1",
 *   assets: [
 *     { coinMinimalDenom: "uosmo", verified: true },
 *     { coinMinimalDenom: "ibc/NEW...", verified: true },
 *     { coinMinimalDenom: "ibc/UNVERIFIED...", verified: false }
 *   ]
 * }
 * generateState("osmosis-1", assetlist)
 * // Result:
 * // - uosmo: No listingDate (legacyAsset: true in state)
 * // - ibc/NEW...: Gets listingDate = current datetime
 * // - ibc/UNVERIFIED...: Skipped (not verified)
 */
const generateState = (chainName, assetlist) => {

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


  // Iterate each asset
  if (!state.assets) { state.assets = [] }
  for (let assetlistAsset of assetlist?.assets) {

    let stateAsset;

    //see if it's verified, and skip if not
    if (assetlistAsset.verified) {

      //get the state asset
      stateAsset = getStateAsset(assetlistAsset.coinMinimalDenom, state);

      // Property 1: Get the listing Date
      setAssetListingDate(stateAsset, assetlistAsset);


      // Property 2: anything else...


    }

  }


  // Write the state to the state file
  zone.writeToFile(chainName, stateDir, stateFileName, state);
  console.log(`Update state completed. Data saved.`);

};


function getAssetlistFromFile(chainName) {

  // Read the generate assetlist
  const assetlist = zone.readFromFile(chainName, zone.zoneConfigAssetlist, zone.assetlistFileName);
  //console.log(`Generated Assetlist is: ${assetlist}`);
  return assetlist;

}

function saveAssetlistToFile(chainName, assetlist) {

  // Write the state to the state file
  zone.writeToFile(chainName, zone.zoneConfigAssetlist, zone.assetlistFileName, assetlist);
  console.log(`Update assetlist completed. Data saved.`);

}


/**
 * Update state file and optionally persist changes back to assetlist
 *
 * PUBLIC API for state management. This is the function called by other scripts.
 *
 * TWO USAGE MODES:
 *
 * Mode 1: IN-MEMORY (assetlist provided)
 * - Called from generate_assetlist.mjs during assetlist generation
 * - Assetlist object passed in memory (not yet saved to disk)
 * - State updated and listing dates copied to assetlist object
 * - Assetlist NOT saved here (caller will save it)
 * - Use case: Part of generation pipeline, avoid redundant file I/O
 *
 * Mode 2: FILE-BASED (no assetlist provided)
 * - Called standalone to update state from existing assetlist.json
 * - Assetlist loaded from disk
 * - State updated and listing dates copied to assetlist
 * - Assetlist saved back to disk with updated listing dates
 * - Use case: Manual state regeneration, fixing corrupt state
 *
 * WHEN TO USE EACH MODE:
 * - generate_assetlist.mjs calls with assetlist object → Mode 1
 * - Manual scripts/fixes call without params → Mode 2
 * - Workflow runs typically use Mode 1 (more efficient)
 *
 * @param {string} chainName - Zone chain name (e.g., "osmosis-1")
 * @param {Object} [assetlist] - Optional assetlist object. If not provided, loads from file.
 *
 * @example
 * // Mode 1: Called during assetlist generation (in-memory)
 * import { updateState } from './update_assetlist_state.mjs';
 * let assetlist = { chainName: "osmosis-1", assets: [...] };
 * updateState("osmosis-1", assetlist);
 * // assetlist.assets now have listingDate populated
 * // Caller will save assetlist to file
 *
 * @example
 * // Mode 2: Standalone state update (file-based)
 * import { updateState } from './update_assetlist_state.mjs';
 * updateState("osmosis-1");
 * // Loads assetlist.json, updates state, saves assetlist.json back
 */
export function updateState(chainName, assetlist) {
  let assetlistFromFile = false;
  if (!assetlist) {
    assetlist = getAssetlistFromFile(chainName);
    assetlistFromFile = true;
  }
  generateState(chainName, assetlist);
  if (assetlistFromFile) {
    saveAssetlistToFile(chainName, assetlist);
  }
}


function main() {
  zone.chainNames.forEach(chainName => generateState(chainName));
}