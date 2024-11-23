
/*  Purpose:
 *    to manage the comments for each asset in Osmosis Zone Zone_Assets
 *    which looks like: "_comment": "Asset Name (variant info) $TICKER"
 * 
 * 
 *  Plan:
 *    Iterate through the zone_assets,
 *    for each asset, get the name and symbol,
 *    construct the comment (appending name and symbol together)
 *    save the comment to the zone_asset object
 * 
 * 
 * */


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as path from 'path';



//-- Files and Directories --
//--


//-- Global Vars --
//--


//-- Functions --
function getZoneAssetsJson(chainName) {
  let zoneAssetsJson;
  try {
    zoneAssetsJson = zone.readFromFile(chainName, zone.noDir, zone.zoneAssetsFileName);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`File not found: ${error.message}`);
    } else {
      throw error;
    }
  }
  return zoneAssetsJson;
}

function getAssetlistAsset(zoneAsset, assetlist) {
  if (!zoneAsset.base_denom || !zoneAsset.chain_name) { return; }
  return assetlist.find(asset =>
    asset.sourceDenom === zoneAsset.base_denom
      &&
    asset.chainName === zoneAsset.chain_name
  );
}

function getAssetComment(assetlistAsset) {
  if (!assetlistAsset?.name || !assetlistAsset?.symbol) {
    console.log(`Assetlist Asset missing name or symbol. ${assetlistAsset}`);
    return;
  }
  return `${assetlistAsset.name} $${assetlistAsset.symbol}`;
}

function saveZoneAssets(chainName, zoneAssetsJson) {
  zone.writeToFile(chainName, zone.noDir, zone.zoneAssetsFileName, zoneAssetsJson);
  console.log(`Saved zone_assets for ${chainName}`);
}

function generateComments(chainName) {

  const assetlist = zone.readFromFile(chainName, zone.frontendAssetlistDir, zone.assetlistFileName)?.assets;
  if (!assetlist) { console.log("Assetlist not found"); return; }

  let zoneAssetsJson = getZoneAssetsJson(chainName);
  if (!zoneAssetsJson) { return; }
  zoneAssetsJson.assets.forEach(zoneAsset => {
    if (!zoneAsset.base_denom || !zoneAsset.chain_name) { return; }
    const assetlistAsset = getAssetlistAsset(zoneAsset, assetlist);
    zoneAsset._comment = getAssetComment(assetlistAsset);
  });

  saveZoneAssets(chainName, zoneAssetsJson);

}

function main() {
  zone.chainNames.forEach(chainName => generateComments(chainName));
}

main();