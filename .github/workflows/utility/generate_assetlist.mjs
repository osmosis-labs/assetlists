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


//-- Functions --

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

async function getAssetsFromChainRegistry(localChainName, asset_datas) {

  //get network_type (mainnet vs testnet)
  const localNetworkType = chain_reg.getFileProperty(localChainName, "chain", "network_type");
  if (localNetworkType !== "mainnet" && localNetworkType !== "testnet" && localNetworkType !== "devnet") return;

  //try each chain of that network_type
  let chains = chain_reg.getChains() || [];

  await asyncForEach(chains, async (chainName) => {

    if (chainName === localChainName) return; //we'll check assets under this chain separately

    const networkType = chain_reg.getFileProperty(chainName, "chain", "network_type");
    if (networkType !== localNetworkType) return; // must match the local chain's network type

    const chainType = chain_reg.getFileProperty(chainName, "chain", "chain_type");
    if (chainType !== "cosmos") return; // must be a cosmos chain

    // Checkpoint: the chain now qualifies, but we still need to check that there exists an ibc connection

    //get IBC channels
    const channels = chain_reg.getIBCFileProperty(chainName, localChainName, "channels") || [];
    if (channels.length <= 0) return;

    //find the transfer/transfer channel
    const defaultChannel = channels.find(channel => (
      channel.chain_1.port_id === "transfer" && channel.chain_2.port_id === "transfer"
    ));

    //find the only cw20 channel
    const cw20Channels = channels.filter(channel => (
      channel.chain_1.port_id.startsWith("cw20:") || channel.chain_2.port_id.startsWith("cw20:")
    ));
    let cw20Channel;
    if (cw20Channels.length === 1) cw20Channel = cw20Channels[0];

    if (!defaultChannel && !cw20Channel) return;
    const isChain1 = chainName === [chainName, localChainName].sort()?.[0] ? true : false;

    // Checkpoint: now that we know there exists an ibc connection, we can iterate the assets

    //get the chain's assets
    const assets = chain_reg.getFileProperty(chainName, "assetlist", "assets") || [];

    //iterate the assets
    await asyncForEach(assets, async (asset) => {
    //assets.forEach((asset) => {

      //get asset type
      const typeAsset = asset.type_asset;
      if (typeAsset !== "sdk.coin" && typeAsset !== "cw20") return;

      //set base_denom
      const baseDenom = asset.base;

      //--Establish Asset Data--
      let asset_data = {
        chainName: localChainName, //osmosis vs osmosistestnet vs osmosistestnet4 vs ...
        zone_config: {},
        zone_asset: {},
        frontend: {},
        chain_reg: {},
        asset_detail: {},
      }

      //we should check to make sure it's not already in the zone_assets
      let existingAsset = asset_datas.find((asset_data) => {
        asset_data.zone_asset.chain_name === chainName && asset_data.zone_asset.base_denom === baseDenom
      }); 
      // but this doesn't check cases where it's registered directly under osmosis
      if (existingAsset) return;

      asset_data.zone_asset.chain_name = chainName;
      asset_data.zone_asset.base_denom = baseDenom;

      //source_asset (the most recent ibc transfer source (not necessarily the origin))
      assetlist.setSourceAsset(asset_data);

      const channel = typeAsset === "cw20" ? cw20Channel : defaultChannel;
      if (typeAsset === "cw20" && !cw20Channel) return;
      const channel_id = isChain1 ? channel.chain_2.channel_id : channel.chain_1.channel_id;
      const path = "transfer" + "/" + channel_id + "/" + baseDenom;

      asset_data.zone_asset.path = path;

      await assetlist.setLocalAsset(asset_data);

      existingAsset = asset_datas.find((existingAssetData) => (
        existingAssetData.local_asset.base_denom === asset_data.local_asset.base_denom
      ));
      if (existingAsset) return;

      //add to asset_datas array
      asset_datas.push(asset_data);

    });

  });

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

    //make sure it exists
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

  //get assets from chain registry
  await getAssetsFromChainRegistry(chainName, asset_datas);

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
    frontend_assets, //saves to generated/frontend/assetlist.json
    chain_reg_assets, //saves to generated/chain_registry/assetlist.json
    asset_detail_assets //saves to generated/asset_detail/assetlist.json
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
