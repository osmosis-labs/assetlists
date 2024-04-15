// Purpose:
//   to generate the zone_config json using the zone json and chain registry data

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
import * as zone from "./assetlist_functions.mjs";
import { getAssetsPricing } from "./getPools.mjs";
import { getAllRelatedAssets } from "./getRelatedAssets.mjs";
import * as assetlist from "./generate_assetlist_functions.mjs";


//-- Functions --

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const generateAssets = async (
  chainName,
  zoneConfig,
  zone_assets,
  frontend_assets,
  chain_reg_assets
) => {

  //--Get Pool Data--
  let pool_assets;
  pool_assets = await getAssetsPricing(chainName);
  if (!pool_assets) {
    return;
  }
  const pool_data = pool_assets;

  await asyncForEach(zone_assets, async (zone_asset) => {

    //--Create the Generated Asset Objects--
    let generated_asset = {};


    //--Establish Asset Data--
    let asset_data = {
      chainName: chainName,
      zone_config: zoneConfig,
      zone_asset: zone_asset,
      frontend: {},
      chain_reg: {},
      asset_detail: {}
    }

    //source_asset (the most recent ibc transfer source (not necessarily the origin))
    assetlist.setSourceAsset(asset_data);

    //local_asset (e.g., uosmo, ibc/27..., factory/.../milkTIA, ...)
    await assetlist.setLocalAsset(asset_data);

    //canonical_asset (e.g., pstake on Ethereum, usdc on ethereum)
    assetlist.setCanonicalAsset(asset_data);

    assetlist.setSourceDenom(asset_data);
    assetlist.setCoinMinimalDenom(asset_data);
    assetlist.setSymbol(asset_data);
    assetlist.setDecimals(asset_data);
    assetlist.setLogoURIs(asset_data);
    assetlist.setAddress(asset_data);
    assetlist.setCoinGeckoId(asset_data);
    assetlist.setVerifiedStatus(asset_data);
    assetlist.setUnstableStatus(asset_data);
    assetlist.setDisabledStatus(asset_data);
    assetlist.setPreviewStatus(asset_data);
    assetlist.setPrice(asset_data, pool_data);
    assetlist.setListingDate(asset_data);
    assetlist.setBase(asset_data);
    assetlist.setDisplay(asset_data);
    assetlist.setCategories(asset_data);
    assetlist.setPegMechanism(asset_data);
    assetlist.setTransferMethods(asset_data);
    assetlist.setCounterparty(asset_data);
    assetlist.setVariantGroupKey(asset_data);
    assetlist.setDenomUnits(asset_data);
    assetlist.setName(asset_data);
    assetlist.setDescription(asset_data);
    assetlist.setTraces(asset_data);
    assetlist.setSortWith(asset_data);
    assetlist.setChainName(asset_data);
    assetlist.setImages(asset_data);
    assetlist.setTooltipMessage(asset_data);
    assetlist.setKeywords(asset_data);
    assetlist.setTypeAsset(asset_data);
    assetlist.setSocials(asset_data);

    //--Append to Chain_Reg Assetlist--
    assetlist.reformatChainRegAsset(asset_data);
    chain_reg_assets.push(asset_data.chain_reg);

    //--Append to Frontend Assetlist--
    assetlist.reformatFrontendAsset(asset_data);
    frontend_assets.push(asset_data.frontend);

    //--Append to Asset_Detail Assetlist--
    //assetlist.reformatAssetDetailAsset(asset_data);
    //asset_details.push(asset_data.asset_detail);

  });
};


//--Get Remaining Assets only in Chain Registry--
function getChainRegAssets(chainName, chain_reg_assets) {
  let registered_assets = chain_reg_assets;
  let assetPointers = chain_reg.getAssetPointersByChain(chainName);
  assetPointers.forEach((assetPointer) => {
    if (
      !chain_reg_assets.some(
        (chain_reg_asset) => chain_reg_asset.base == assetPointer.base_denom
      )
    ) {
      registered_assets.push(
        chain_reg.getAssetObject(
          assetPointer.chain_name,
          assetPointer.base_denom
        )
      );
    }
  });
  return registered_assets;
}

async function generateAssetlist(chainName) {
  let zoneConfig = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneConfigFileName
  )?.config;
  let zoneAssetlist = zone.readFromFile(
    chainName,
    zone.noDir,
    zone.zoneAssetlistFileName
  )?.assets;
  let frontend_assets = [];
  let chain_reg_assets = [];
  await generateAssets(
    chainName,
    zoneConfig,
    zoneAssetlist,
    frontend_assets,
    chain_reg_assets
  );
  //zone_config_assets = await getAllRelatedAssets(
  //  zone_config_assets,
  //  zoneConfig
  //);
  chain_reg_assets = getChainRegAssets(chainName, chain_reg_assets);
  let chain_reg_assetlist = {
    $schema: "../assetlist.schema.json",
    chain_name: chainName,
    assets: chain_reg_assets,
  };

  let frontend_assetlist = {
    chainName: chainName,
    assets: frontend_assets,
  };
  zone.writeToFile(
    chainName,
    zone.zoneConfigAssetlist,
    zone.assetlistFileName,
    frontend_assetlist
  );
  zone.writeToFile(
    chainName,
    zone.chainRegAssetlist,
    zone.assetlistFileName,
    chain_reg_assetlist
  );
}

async function generateAssetlists() {
  for (const chainName of zone.chainNames) {
    await generateAssetlist(chainName);
  }
}

function main() {
  generateAssetlists();
}

main();
