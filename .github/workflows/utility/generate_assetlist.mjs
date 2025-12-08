// Purpose:
//   to generate the zone_config json using the zone json and chain registry data

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as zone from "./assetlist_functions.mjs";
import * as assetlist from "./generate_assetlist_functions.mjs";
import * as localization from "./localization.mjs";
import * as state from "./update_assetlist_state.mjs";


//-- Flags --
// getPools: Disabled - Pool pricing functionality exists but is not currently used.
// The code in getPools.mjs remains available for future re-implementation if needed.
// When enabled, it would add pricing information to assetlists based on pool liquidity.
const getPools = false;
const getRelatedAssets = false; //not implemented


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
  chain_reg_assets,
  asset_detail_assets,
) => {

  //--Get Pool Data--
  let pool_assets;
  if (getPools) {
    pool_assets = await getAssetsPricing(chainName);
    if (!pool_assets) {
      return;
    }
  }
  const pool_data = pool_assets;

  let asset_datas = [];

  await asyncForEach(zone_assets, async (zone_asset) => {

    //--Create the Generated Asset Objects--
    //let generated_asset = {};


    //--Establish Asset Data--
    let asset_data = {
      chainName: chainName, //osmosis vs osmosistestnet vs osmosistestnet4 vs ...
      zone_config: zoneConfig,
      zone_asset: zone_asset,
      frontend: {},
      chain_reg: {},
      asset_detail: {},
    }

    //source_asset (the most recent ibc transfer source (not necessarily the origin))
    assetlist.setSourceAsset(asset_data);

    //make usre it exists
    if (!chain_reg.getAssetProperty(asset_data.source_asset.chain_name, asset_data.source_asset.base_denom, "base")) {
      console.log(`Asset does not exist! ${asset_data.source_asset.chain_name}, ${asset_data.source_asset.base_denom}`);
      return;
    }

    //local_asset (e.g., uosmo, ibc/27..., factory/.../milkTIA, ...)
    await assetlist.setLocalAsset(asset_data);

    //canonical_asset (e.g., pstake on Ethereum, usdc on ethereum)
    //assetlist.setCanonicalAsset(asset_data);

    //Identity Asset (e.g., WBTC.axl originates from WBTC on Ethereum--NOT BTC)
    //assetlist.setIdentityAsset(asset_data);

    //Add to array of Asset data
    asset_datas.push(asset_data);

  });

  assetlist.setCanonicalAssets(asset_datas);
  assetlist.setIdentityAssets(asset_datas);

  asset_datas.forEach((asset_data) => {
    assetlist.setSourceDenom(asset_data);
    assetlist.setCoinMinimalDenom(asset_data);
    assetlist.setSymbol(asset_data);
    assetlist.setDecimals(asset_data);
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
    assetlist.setIdentityGroupKey(asset_data);
    assetlist.setBestOriginAsset(asset_data, asset_datas);
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

    assetlist.setIsAlloyed(asset_data);
    assetlist.setContract(asset_data);

    assetlist.setSocials(asset_data);

    //--Append to Chain_Reg Assetlist--
    assetlist.reformatChainRegAsset(asset_data);
    chain_reg_assets.push(asset_data.chain_reg);

    //--Append to Frontend Assetlist--
    assetlist.reformatFrontendAssetFromAssetData(asset_data);
    frontend_assets.push(asset_data.frontend);

    //--Append to Asset_Detail Assetlist--
    assetlist.reformatAssetDetailAsset(asset_data);
    asset_detail_assets.push(asset_data.asset_detail);

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
  let asset_detail_assets = [];
  await generateAssets(
    chainName,
    zoneConfig,
    zoneAssetlist,
    frontend_assets,
    chain_reg_assets,
    asset_detail_assets
  );

  let frontend_assetlist = {
    chainName: chainName,
    assets: frontend_assets,
  };

  //state
  state.updateState(chainName, frontend_assetlist);

  //post processing for reordering properties
  //frontend_assets.forEach(asset => console.log(asset.coinMinimalDenom));
  frontend_assets.forEach(asset => assetlist.reformatFrontendAsset(asset));

  zone.writeToFile(
    chainName,
    zone.zoneConfigAssetlist,
    zone.assetlistFileName,
    frontend_assetlist
  );

  let asset_detail_assetlist = {
    chainName: chainName,
    assets: asset_detail_assets,
  };
  zone.writeToFile(
    chainName,
    localization.zoneAssetDetail,
    zone.assetlistFileName,
    asset_detail_assetlist
  );
  localization.setAssetDetailLocalizationInput(chainName, asset_detail_assets);

  chain_reg_assets = getChainRegAssets(chainName, chain_reg_assets);
  let chain_reg_assetlist = {
    $schema: "../assetlist.schema.json",
    chain_name: chainName,
    assets: chain_reg_assets,
  };
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
