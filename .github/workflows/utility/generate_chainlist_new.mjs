// Purpose:
//   to generate the chainlist json using the zone_chains json and chain registry data

// -- THE PLAN --
//
// read zone list from osmosis.zone_chains.json
// add chains to zone array
// for each chain in zone array, identify the chain_name (this is primary key)
//   get various chain properties
//     for bech32, is no bech32 config, get bech32 prefix, and then generate the rest of the bech32 config
// write chainlist array to file osmosis-1.chainlist.json

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
//chain_reg.setup();
import * as zone from "./assetlist_functions.mjs";

//-- Globals --

let zoneAssetlist;

//-- Functions --

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

//getIbcDenom
async function getLocalBaseDenom(chain_name, base_denom, local_chain_name) {
  if (chain_name == local_chain_name) {
    return base_denom;
  }
  for (const asset of zoneAssetlist.assets) {
    if (
      asset.base_denom == base_denom &&
      asset.chain_name == chain_name &&
      asset.path
    ) {
      return await zone.calculateIbcHash(asset.path);
    }
  }
}

function getZoneChains(chainName) {
  return zone.readFromFile(chainName, zone.noDir, zone.zoneChainlistFileName);
}

function getCounterpartyChainsFromAssetlist(chainName) {

  //Read Assetlist File
  zoneAssetlist = zone.readFromFile(
    chainName,
    zone.zoneConfigAssetlist,
    zone.assetlistFileName
  );

  //Write list of all counterparty chains
  let counterpartyChainNames = [];
  //iterate each chain in the file
  zoneAssetlist?.assets?.forEach((asset) => {
    //iterate each counterparty
    asset.counterparty?.forEach((counterparty) => {
      //add chain name to list (but don't add duplicates)
      zone.addUniqueArrayItem(counterparty.chain_name, counterpartyChainNames);
    });
  });

  //TODO: remove the cout--just for testing
  console.log("counterpartyChainNames:")
  console.log(counterpartyChainNames);

}

function getMininmalChainProperties(chain) {

  //A chain could meet up to three levels of requirements:
  //level 1: chain_name, pretty_name, logo_URIs--allows showing the chain in the D/W flow
  //level 2: chain-id, apis, explorer, fees (and level 1 req's)--allows:
  //counterparty balance detection, querying providers, tx explorer url, chain suggestion, subtracting fees

  const chain_name = chain.chain_name;

  // Level 1:
  //-- Get Pretty Name --
  chain.prettyName = chain_reg.getFileProperty(chain_name, "chain", "pretty_name");
  if (!chain.prettyName) return false;
  // -- Get Chain Logo --
  const logo_URIs = chain_reg.getFileProperty(chain_name, "chain", "logo_URIs");
  if (!logo_URIs) {
    let image = chain_reg.getFileProperty(chain_name, "chain", "images")?.[0];
    if (image) {
      chain.logo_URIs = image;
      delete chain.logo_URIs.image_sync;
      delete chain.logo_URIs.theme;
    } else {
      let stakingTokenDenom = chain_reg_staking?.staking_tokens[0].denom;
      if (stakingTokenDenom) {
        let stakingTokenLogoURIs = chain_reg.getAssetProperty(chain_name, stakingTokenDenom, "logo_URIs");
        if (!stakingTokenLogoURIs) {
          let stakingTokenImage = chain_reg.getAssetProperty(chain_name, stakingTokenDenom, "images")?.[0];
          if (stakingTokenImage) {
            chain.logo_URIs = image;
            delete chain.logo_URIs.image_sync;
            delete chain.logo_URIs.theme;
          }
        }
      }
    }
  }
  if (!chain.logo_URIs) return false;

  return true;

}

function getSuggestionCurrencyProperties(currency, chain_name/*, asset = {}*/) {

  const base_denom = currency.base_denom;
  if (!currency.base_denom) return false;

  const local_chain_name = "osmosis";//delete later

  // -- Get Properties Pt. 1 --
  currency.coinDenom = chain_reg.getAssetProperty(chain_name, base_denom, "symbol");
  if (!currency.coinDenom) return false;
  chainSuggestionDenom = base_denom;

  //TODO: Confirm that we would be able to get rid of this (still will use the same property name)
  // -- Get Osmosis-local Base Denom
  coinMinimalDenom = await getLocalBaseDenom(
    chain_name,
    base_denom,
    local_chain_name
  ) || "";

  // -- Get Properties Pt. 2 --
  sourceDenom: base_denom;
  currency.coinDecimals = chain_reg.getAssetDecimals(chain_name, base_denom) || 0;
  currency.coinGeckoId = chain_reg.getAssetPropertyWithTraceIBC(chain_name, base_denom, "coingecko_id");

  // -- Get Logo --
  logo_URIs = chain_reg.getAssetProperty(chain_name, base_denom, "logo_URIs");
  if (!logo_URIs) {
    logo_URIs = chain_reg.getAssetProperty(chain_name, base_denom, "images")?.[0];
  }
  currency.coinImageUrl = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
  if (!coinImageUrl) return false;

  // -- Handle Exceptions --
  if (base_denom == local_base_denom) {
    delete currency.sourceDenom;
  }

  return true;

}

function getChainSuggestionFeatures(chain, zoneChain) {

  let features = zoneChain.keplr_features || [];
  let feature = "";

  //eth-key-sign, eth-address-gen === coinType 60
  const coinType = chain.slip44;
  feature = "eth-key-sign";
  if (!features.includes(feature)) {
    if (coinType === 60) features.push(feature);
  }
  feature = "eth-address-gen";
  if (!features.includes(feature)) {
    if (coinType === 60) features.push(feature);
  }

  //ibc-go
  feature = "ibc-go";
  const recommended_version = chain_reg.getFileProperty(chain.chain_name, "chain", "codebase")?.recommended_version;
  if (recommended_version) {
    const versions = chain_reg.getFileProperty(chain.chain_name, "version", "versions");
    for (const version of versions) {
      if (version.recommended_version === recommended_version) {
        if (version.ibc.type === "go") {
          features.push(feature);
        }
      }
    }
  }

  //not sure how to derive wasmd_0.24+
  

}

function getSuggestionChainProperties(minimalChain, zoneChain = {}) {

  const chain_name = minimalChain.chain_name;
  let chain = {
    chain_name: chain_name;
  }

  //Make sure it's a Cosmos Chain
  let chainType = chain_reg.getFileProperty(chain_name, "chain", "chain_type");
  if (chainType !== "cosmos") return false;


  // -- Get Basic Metadata --
  chain.status = chain_reg.getFileProperty(chain_name, "chain", "status");
  if (!chain.status) return false;
  chain.networkType = chain_reg.getFileProperty(chain_name, "chain", "network_type");
  if (!chain.networkType) return false;
  chain.prettyName = minimalChain.prettyName;
  chain.chain_id = chain_reg.getFileProperty(chain_name, "chain", "chain_id");
  if (!chain.chain_id) return false;

  // -- Get bech32_config --
  chain.bech32Prefix = chain_reg.getFileProperty(chain_name, "chain", "bech32_prefix");
  if (!chain.bech32Prefix) return false;
  let bech32_config = chain_reg.getFileProperty(chain_name, "chain", "bech32_config") || {};
  chain_reg.bech32ConfigSuffixMap.forEach((value, key) => {
    if (bech32_config[key]) return;
    bech32_config[key] = chain.bech32Prefix?.concat(value);
  });
  chain.bech32Config = bech32_config;

  // -- Get SLIP44 --
  chain.slip44 = chain_reg.getFileProperty(chain_name, "chain", "slip44");
  if (!chain.slip44) return false;
  chain.alternativeSlip44s = chain_reg.getFileProperty(chain_name, "chain", "alternative_slip44s");

  // -- Get Chain Logo --
  chain.logo_URIs = minimalChain.logo_URIs;

  // -- Check that Chain Fees Exist --
  let chainFees = chain_reg.getFileProperty(chain_name, "chain", "fees");
  if (!chainFees) return false;

  // -- Get APIs --
  let apis = chain_reg.getFileProperty(chain.chain_name, "chain", "apis");
  let rest = zoneChain.rest || apis?.rest?.[0].address
  if (!rest) return false;
  let rpc = zoneChain.rpc || apis?.rpc?.[0].address
  if (!rpc) return false;

  // -- Get Explorer Tx URL --
  let explorers = chain_reg.getFileProperty(chain.chain_name, "chain", "explorers");
  let explorer = zoneChain.explorer_tx_url || explorers?.[0].txPage;
  if (!explorer) return false;

  // -- By this point, we have the minimum required data to be able to suggest the chain --

  // -- Get Staking --
  let chain_staking = chain_reg.getFileProperty(chain_name, "chain", "staking");
  if (chain_staking) {

    const base_denom = chain_staking?.staking_tokens[0]?.denom;
    let currency = {
      base_denom: base_denom
    }
    const hasMetadata = getCurrencyProperties(currency, chain_name);
    chain.stakeCurrency = hasMetadata ? currency : {};
  }

  // -- Get Fees --
  chain.feeCurrencies = [];
  await asyncForEach(chainFees?.fee_tokens, async (fee) => {

    let currency = {
      base_denom: fee.denom
    }
    const hasMetadata = getSuggestionCurrencyProperties(currency, chain_name);
    if (!hasMetadata) return;

    // -- Gas Pricing --
    if (fee.low_gas_price && fee.average_gas_price && fee.high_gas_price) {
      currency.gasPriceStep = {
        low: fee.low_gas_price,
        average: fee.average_gas_price,
        high: fee.high_gas_price,
      };
    }
    if (fee.gas_costs) {
      currency.gasCosts = {
        cosmosSend: fee.gas_costs?.cosmos_send,
        ibcTransfer: fee.gas_costs?.ibc_transfer,
      };
    }

    // -- Add to Chain --
    chain.feeCurrencies.push(currency);

  });
  //Double-check that there is at least one valid feeCurrency
  if (chain.feeCurrencies.length <= 0) return false;

  // -- Get Currencies --
  chain.currencies = [];
  let chain_assets = chain_reg.getFileProperty(chain_name, "assetlist", "assets");

  //chain_reg_assets?.forEach((asset) => {
  await asyncForEach(chain_assets, async (asset) => {

    let currency = {
      base_denom: asset.base
    }
    const hasMetadata = getSuggestionCurrencyProperties(currency, chain_name/*, asset*/);//Here it's looking up the values for each asset again, but we're already passing in the asset. It's like all we really needed was the base denom
    if (!hasMetadata) return;

    chain.currencies.push(currency);

  });

  // -- Get Description --
  chain.description = chain_reg.getFileProperty(chain_name, "chain", "description");


  // -- Create APIs Property --
  chain.apis = {};
  chain.apis.rpc = [];
  chain.apis.rpc[0] = {};
  chain.apis.rpc[0].address = rpc;
  chain.apis.rest = [];
  chain.apis.rest[0] = {};
  chain.apis.rest[0].address = rest;

  // -- Create Explorers Propterty --
  chain.explorers = [];
  chain.explorers[0] = {};
  chain.explorers[0].txPage = explorer;

  // -- Get Keplr Suggest Chain Features --
  getChainSuggestionFeatures(chain, zoneChain);

  // -- Override Minimal Chain Object with new Suggestion-compatible Chain Object --
  minimalChain = chain;

  return true;


}

function getZoneChainOverrideProperties(chain, zoneChain) {

  // -- Get Outage Alerts --
  chain.outage = zoneChain.outage;

  return true;

}

async function generateChains(chains, zone_chains, local_chain_name) {
  //zone_chains.forEach(async (zone_chain) => {
  await asyncForEach(zone_chains, async (zoneChain) => {

    // -- Start Chain Object --
    let chain = {
      chain_name: zone_chain.chain_name
    };
    // -- Minimal Metadata Requirements --
    let hasMinimalRequirements = getMininmalChainProperties(chain);
    if (!hasMinimalRequirements) return;

    // -- Suggestion Metadata Requirements --
    let ableToSuggest = getSuggestionChainProperties(chain, zoneChain);
    if (!ableToSuggest) {
      chains.push(chain);
      return;
    }

    // -- Get Manually Provided Values from Zone Chains --
    getZoneChainOverrideProperties(chain, zoneChain);

    // -- Push Chain --
    chains.push(chain);

  });
  return;
}

async function generateChainlist(chainName) {

  let zoneChainlist = getZoneChains(chainName);
  let chains = [];
  await generateChains(chains, zoneChainlist.chains, chainName);

  let generatedChainlist = {
    zone: chainName,
    chains: chains,
  };

  zone.writeToFile(
    chainName,
    zone.zoneConfigChainlist,
    zone.chainlistFileName,
    generatedChainlist
  );
}

async function generateChainlists() {
  for (const chainName of zone.chainNames) {
    await generateChainlist(chainName);
  }
}

function main() {
  generateChainlists();
}

main();
