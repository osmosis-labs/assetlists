// Purpose:
//   to generate the chainlist json using the zone_chains json and chain registry data

// -- THE PLAN --
//
// read zone list from osmosis.zone_chains.json
// add chains to zone array
// for each chain in zone array, identify the chain_name (this is primary key)
//   get various chain properties
//     for bech32, is no bech32 config, get bech32 prefix, and then generate the rest of the bech32 config
// write chainlist array to file generated/frontend/chainlist.json

//-- Imports --

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";
chain_reg.setup();
import * as zone from "./assetlist_functions.mjs";
import * as path from 'path';
import * as fs from 'fs';

//-- Globals --

let zoneAssetlist;

// Load validation state
function getValidationState(chainName) {
  try {
    const stateFilePath = path.join('..', '..', '..', chainName, 'generated', 'state', 'state.json');
    const stateContent = fs.readFileSync(stateFilePath, 'utf8');
    return JSON.parse(stateContent);
  } catch (error) {
    console.warn(`Could not load validation state: ${error.message}`);
    return null;
  }
}

function getValidationRecord(state, chain_name) {
  if (!state || !state.chains) return null;
  return state.chains.find(c => c.chain_name === chain_name);
}

//-- Functions --

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

function getChainImage(chain_name) {

  const logo_URIs = chain_reg.getFileProperty(chain_name, "chain", "logo_URIs");
  if (logo_URIs) return logo_URIs;
  let image = chain_reg.getFileProperty(chain_name, "chain", "images")?.[0];
  if (image) {
    delete image.image_sync;
    delete image.theme;
    return image;
  }

}

function getAssetImage(chain_name, base_denom) {

  const logo_URIs = chain_reg.getAssetProperty(chain_name, base_denom, "logo_URIs");
  if (logo_URIs) return logo_URIs;
  let image = chain_reg.getAssetProperty(chain_name, base_denom, "images")?.[0];
  if (image) {
    delete image.image_sync;
    delete image.theme;
    return image;
  }

}

function getChainLogo(chain_name) {

  let logo_URIs = getChainImage(chain_name);
  if (logo_URIs) return logo_URIs;

  let stakingTokenDenom = chain_reg.getFileProperty(chain_name, "chain", "staking")?.staking_tokens?.[0]?.denom;
  if (stakingTokenDenom) {
    logo_URIs = getAssetImage(chain_name, stakingTokenDenom);
    if (logo_URIs) return logo_URIs;
  }

  let feeTokenDenom = chain_reg.getFileProperty(chain_name, "chain", "fees")?.fee_tokens?.[0]?.denom;
  if (feeTokenDenom) {
    logo_URIs = getAssetImage(chain_name, feeTokenDenom);
    if (logo_URIs) return logo_URIs;
  }

  if (chain_reg.getFileProperty(chain_name, "chain", "network_type") !== "mainnet") {
    const testnetIndex = chain_name.indexOf("testnet");
    const devnetIndex = chain_name.indexOf("devnet");

    // pick the first occurrence if either exists
    let cutIndex = -1;
    if (testnetIndex !== -1 && devnetIndex !== -1) {
      cutIndex = Math.min(testnetIndex, devnetIndex);
    } else if (testnetIndex !== -1) {
      cutIndex = testnetIndex;
    } else if (devnetIndex !== -1) {
      cutIndex = devnetIndex;
    }

    // if neither word is found, return the whole string
    const mainnetName = cutIndex !== -1 ? chain_name.slice(0, cutIndex) : chain_name;

    if (cutIndex) {
      console.log("found one");
      console.log(mainnetName);
    }

    if (!mainnetName) return;

    let logo_URIs = getChainLogo(mainnetName);
    if (logo_URIs) return logo_URIs;

  }

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
  chain.logo_URIs = getChainLogo(chain_name);

  return true;

}

async function getSuggestionCurrencyProperties(currency, chain_name) {

  const base_denom = currency.base_denom;
  if (!currency.base_denom) return false;

  // -- Get Properties Pt. 1 --
  currency.coinDenom = chain_reg.getAssetProperty(chain_name, base_denom, "symbol");
  if (!currency.coinDenom) return false;

  currency.coinMinimalDenom = base_denom;

  // -- Get Properties Pt. 2 --
  currency.coinDecimals = chain_reg.getAssetDecimals(chain_name, base_denom) || 0;
  currency.coinGeckoId = chain_reg.getAssetPropertyWithTraceIBC(chain_name, base_denom, "coingecko_id");
  if (!currency.coinGeckoId) delete currency.coinGeckoId;

  // -- Get Logo --
  let logo_URIs = chain_reg.getAssetProperty(chain_name, base_denom, "logo_URIs");
  if (!logo_URIs) {
    logo_URIs = chain_reg.getAssetProperty(chain_name, base_denom, "images")?.[0];
  }
  currency.coinImageUrl = logo_URIs?.png ? logo_URIs?.png : logo_URIs?.svg;
  //if (!currency.coinImageUrl) return false; // TODO: determine whether logo is required

  delete currency.base_denom;

  return true;

}

function getChainSuggestionFeatures(chain, zoneChain) {

  let features = zoneChain.override_properties?.keplr_features || zoneChain.keplr_features || [];
  let feature = "";

  const recommended_version = chain_reg.getFileProperty(chain.chain_name, "chain", "codebase")?.recommended_version;
  if (recommended_version) {
    const versions = chain_reg.getFileProperty(chain.chain_name, "versions", "versions");
    for (const version of versions) {
      if (version.recommended_version === recommended_version) {

        //ibc-go
        feature = "ibc-go";
        if (version.ibc?.type === "go") {
          zone.addUniqueArrayItem(feature, features);
        }

        //cosmwasm
        feature = "cosmwasm";
        if (version.cosmwasm) {
          zone.addUniqueArrayItem(feature, features);
        }

      }
    }
  }

  //not sure how to derive wasmd_0.24+
  //keplr might be able to get this on their own, but it look like it needs "cosmwasm" to know whether to look for it
  //still, the osmosis zone frontend needs this, so we may have to derive this ourselves.
  //It's probably best to just have to manually specify it

  if (features.length > 0) {
    chain.features = features;
  }

}

async function getSuggestionChainProperties(minimalChain, zoneChain = {}) {

  const chain_name = minimalChain.chain_name;
  let chain = {
    chain_name: chain_name
  }

  //Make sure it's a Cosmos Chain
  let chainType = chain_reg.getFileProperty(chain_name, "chain", "chain_type");
  if (chainType !== "cosmos") return false;

  // -- Get Basic Metadata with override support --
  chain.status = zoneChain.override_properties?.status ||
                 chain_reg.getFileProperty(chain_name, "chain", "status");
  if (!chain.status) return false;
  chain.networkType = zoneChain.override_properties?.network_type ||
                      chain_reg.getFileProperty(chain_name, "chain", "network_type");
  if (!chain.networkType) return false;
  chain.prettyName = zoneChain.override_properties?.pretty_name ||
                     minimalChain.prettyName;

  chain.chain_id = chain_reg.getFileProperty(chain_name, "chain", "chain_id");
  if (!chain.chain_id) return false;

  // -- Get bech32_config with override support --
  chain.bech32Prefix = zoneChain.override_properties?.bech32_prefix ||
                       chain_reg.getFileProperty(chain_name, "chain", "bech32_prefix");
  if (!chain.bech32Prefix) return false;
  let bech32_config = zoneChain.override_properties?.bech32_config ||
                      chain_reg.getFileProperty(chain_name, "chain", "bech32_config") || {};
  chain_reg.bech32ConfigSuffixMap.forEach((value, key) => {
    if (bech32_config[key]) return;
    bech32_config[key] = chain.bech32Prefix?.concat(value);
  });
  chain.bech32Config = bech32_config;

  // -- Get SLIP44 with override support --
  chain.slip44 = zoneChain.override_properties?.slip44 ||
                 chain_reg.getFileProperty(chain_name, "chain", "slip44");
  if (!chain.slip44) return false;
  chain.alternativeSlip44s = zoneChain.override_properties?.alternative_slip44s ||
                             chain_reg.getFileProperty(chain_name, "chain", "alternative_slip44s");
  if (!chain.alternativeSlip44s) delete chain.alternativeSlip44s;

  // -- Get Chain Logo --
  chain.logo_URIs = minimalChain.logo_URIs;

  // -- Check that Chain Fees Exist with override support --
  let chainFees = zoneChain.override_properties?.fees ||
                  chain_reg.getFileProperty(chain_name, "chain", "fees");
  if (!chainFees) return false;

  // -- Get APIs --
  let apis = chain_reg.getFileProperty(chain_name, "chain", "apis");

  // For validation: ensure we have at least one RPC and REST endpoint
  let rest = zoneChain.rest || apis?.rest?.[0]?.address;
  if (!rest) return false;
  let rpc = zoneChain.rpc || apis?.rpc?.[0]?.address;
  if (!rpc) return false;

  // -- Get Explorer Tx URL with override support --
  let explorers = chain_reg.getFileProperty(chain.chain_name, "chain", "explorers");
  let explorer = zoneChain.override_properties?.explorer_tx_url || zoneChain.explorer_tx_url || explorers?.[0]?.txPage;
  if (!explorer) return false;

  // -- By this point, we have the minimum required data to be able to suggest the chain --

  delete minimalChain.prettyName;
  delete minimalChain.logo_URIs;

  let requiredCurrencies = [];

  // -- Get Staking with override support --
  let chain_staking = zoneChain.override_properties?.staking ||
                      chain_reg.getFileProperty(chain_name, "chain", "staking");
  if (chain_staking) {

    const base_denom = chain_staking?.staking_tokens[0]?.denom;
    let currency = {
      base_denom: base_denom
    }
    const hasMetadata = getSuggestionCurrencyProperties(currency, chain_name);
    chain.stakeCurrency = hasMetadata ? currency : {};
    if (hasMetadata) requiredCurrencies.push(currency); //all staking tokens must be added to currencies

  }

  // -- Get Fees --
  chain.feeCurrencies = [];
  await asyncForEach(chainFees?.fee_tokens, async (fee) => {

    let currency = {
      base_denom: fee.denom
    }
    const hasMetadata = await getSuggestionCurrencyProperties(currency, chain_name); //await is temporary to enforce property order
    if (!hasMetadata) return;

    if (currency.coinMinimalDenom !== chain.stakeCurrency?.coinMinimalDenom)
      requiredCurrencies.push({ ...currency }); //all fee tokens must be added to currencies
      
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
    /*if (currency.coinMinimalDenom === chain.stakeCurrency?.coinMinimalDenom) return;
    requiredCurrencies.push(currency); //all fee tokens must be added to currencies*/

  });
  //Double-check that there is at least one valid feeCurrency
  if (chain.feeCurrencies.length <= 0) return false;


  // -- Get Currencies --
  //chain.currencies = [];
  chain.currencies = [...requiredCurrencies];
  let chain_assets = chain_reg.getFileProperty(chain_name, "assetlist", "assets");

  //chain_reg_assets?.forEach((asset) => {
  await asyncForEach(chain_assets, async (asset) => {

    let currency = {
      base_denom: asset.base
    }

    //remove ics20 assets
    if (chain_reg.getAssetProperty(chain_name, currency.base_denom, "type_asset") === "ics20") {
      //but only if it's source chain is a cosmos chain
      const traces = chain_reg.getAssetProperty(chain_name, currency.base_denom, "traces");
      if (traces) {
        const counterpartyChain = traces?.[traces.length - 1]?.counterparty?.chain_name;
        if (counterpartyChain) {
          const chainType = chain_reg.getFileProperty(counterpartyChain, "chain", "chain_type");
          if (chainType === "cosmos") {
            return;
          }
        }
      }
    }

    const hasMetadata = await getSuggestionCurrencyProperties(currency, chain_name, asset);//Here it's looking up the values for each asset again, but we're already passing in the asset. It's like all we really needed was the base denom
    if (!hasMetadata) return;

    if (requiredCurrencies.some(asset => asset.coinMinimalDenom === currency.coinMinimalDenom)) return;
    chain.currencies.push(currency); //only add currencies that haven't already been added

  });

  // -- Get Description with override support --
  chain.description = zoneChain.override_properties?.description ||
                      chain_reg.getFileProperty(chain_name, "chain", "description");
  if (!chain.description) delete chain.description;

  // -- Create APIs Property --
  chain.apis = {};

  const forceRpc = zoneChain.override_properties?.force_rpc || false;
  const forceRest = zoneChain.override_properties?.force_rest || false;

  // Helper function to extract provider info from endpoint URL or metadata
  // Extracts provider from URL patterns since all providers follow consistent naming
  const getProviderFromEndpoint = (endpoint) => {
    const address = endpoint.address || endpoint;
    const addressLower = address.toLowerCase();

    // Check URL patterns for known providers
    if (addressLower.includes('polkachu.com')) return 'polkachu';
    if (addressLower.includes('keplr.app')) return 'keplr';
    if (addressLower.includes('lavenderfive.com')) return 'lavenderfive';
    if (addressLower.includes('stakin-nodes.com') || addressLower.includes('stakin.com')) return 'stakin';
    if (addressLower.includes('ecostake.com')) return 'ecostake';
    if (addressLower.includes('kjnodes.com')) return 'kjnodes';
    if (addressLower.includes('nodestake.org') || addressLower.includes('nodestake.top')) return 'nodestake';
    if (addressLower.includes('notional.ventures')) return 'notional';
    if (addressLower.includes('staketab.org')) return 'staketab';
    if (addressLower.includes('stakeflow.io')) return 'stakeflow';
    if (addressLower.includes('publicnode.com')) return 'publicnode';
    if (addressLower.includes('goldenratiostaking.net')) return 'goldenratiostaking';
    if (addressLower.includes('highstakes.ch')) return 'highstakes';
    if (addressLower.includes('lava.build')) return 'lava';
    if (addressLower.includes('whispernode.com')) return 'whispernode';
    if (addressLower.includes('architectnodes.com')) return 'architectnodes';
    if (addressLower.includes('dragonstake.io')) return 'dragonstake';
    if (addressLower.includes('silknodes.io')) return 'silknodes';
    if (addressLower.includes('w3coins.io')) return 'w3coins';
    if (addressLower.includes('stake-town.com')) return 'staketown';
    if (addressLower.includes('noders.services')) return 'noders';
    if (addressLower.includes('cryptocrew.com') || addressLower.includes('ccvalidators.com')) return 'cryptocrew';
    if (addressLower.includes('quickapi.com')) return 'chainlayer';
    if (addressLower.includes('freshstaking.com')) return 'freshstaking';
    if (addressLower.includes('easy2stake.com')) return 'easy2stake';
    if (addressLower.includes('rockrpc.net')) return 'rockawayX';
    if (addressLower.includes('citizenweb3.com')) return 'citizenweb3';

    // Fallback to provider metadata if available
    if (endpoint.provider) {
      return endpoint.provider.toLowerCase();
    }

    // Extract from domain as last resort (e.g., "rpc.osmosis.zone" -> "osmosis")
    try {
      const url = new URL(address);
      const hostParts = url.hostname.split('.');
      // Get the primary domain (second-to-last part before TLD)
      if (hostParts.length >= 2) {
        return hostParts[hostParts.length - 2];
      }
    } catch (e) {
      // Invalid URL, return empty string
    }

    return '';
  };

  // Helper function to check if provider is preferred
  // Preferred providers: Keplr, Polkachu, and official team providers (matching chain name)
  const isPreferredProvider = (endpoint, chainName) => {
    const provider = getProviderFromEndpoint(endpoint);
    const chainLower = chainName.toLowerCase();

    // Check for explicit preferred providers (by URL pattern)
    if (provider === 'keplr' || provider === 'polkachu') {
      return true;
    }

    // Check if provider matches chain name (official team)
    // e.g., "osmosis.zone" for "osmosis" chain
    if (provider.includes(chainLower) || chainLower.includes(provider)) {
      return true;
    }

    return false;
  };

  // Helper function to sort endpoints by provider preference
  const sortEndpointsByProvider = (endpoints, chainName) => {
    return endpoints.sort((a, b) => {
      const aPreferred = isPreferredProvider(a, chainName);
      const bPreferred = isPreferredProvider(b, chainName);

      if (aPreferred && !bPreferred) return -1;
      if (!aPreferred && bPreferred) return 1;
      return 0; // Keep original order for endpoints with same preference level
    });
  };

  const allRpcEndpoints = [];
  const allRestEndpoints = [];

  // RPC endpoint collection - always add zone endpoint first if it exists
  if (zoneChain.rpc) {
    allRpcEndpoints.push(zoneChain.rpc);
    if (forceRpc) {
      console.log(`Force RPC enabled for ${chain_name}: ${zoneChain.rpc} (locked in first position)`);
    }
  }

  // Sort Chain Registry RPC endpoints by provider preference before adding
  if (apis?.rpc?.length > 0) {
    const sortedRpcEndpoints = sortEndpointsByProvider([...apis.rpc], chain_name);
    sortedRpcEndpoints.forEach(endpoint => {
      if (!allRpcEndpoints.includes(endpoint.address)) {
        allRpcEndpoints.push(endpoint.address);
      }
    });
  }

  // REST endpoint collection - always add zone endpoint first if it exists
  if (zoneChain.rest) {
    allRestEndpoints.push(zoneChain.rest);
    if (forceRest) {
      console.log(`Force REST enabled for ${chain_name}: ${zoneChain.rest} (locked in first position)`);
    }
  }

  // Sort Chain Registry REST endpoints by provider preference before adding
  if (apis?.rest?.length > 0) {
    const sortedRestEndpoints = sortEndpointsByProvider([...apis.rest], chain_name);
    sortedRestEndpoints.forEach(endpoint => {
      if (!allRestEndpoints.includes(endpoint.address)) {
        allRestEndpoints.push(endpoint.address);
      }
    });
  }

  // Reorder based on validation (ONLY if not forced)
  // When forced, zone endpoint stays in first position regardless of validation
  const validationState = getValidationState('osmosis-1');
  const validationRecord = getValidationRecord(validationState, chain_name);

  if (validationRecord?.backupUsed) {
    const { rpcAddress, restAddress, rpcEndpointIndex, restEndpointIndex } = validationRecord.backupUsed;

    if (!forceRpc && rpcAddress && allRpcEndpoints.includes(rpcAddress)) {
      allRpcEndpoints.splice(allRpcEndpoints.indexOf(rpcAddress), 1);
      allRpcEndpoints.unshift(rpcAddress);
      if (rpcEndpointIndex > 0) {
        console.log(`Using validated RPC [${rpcEndpointIndex}] for ${chain_name}: ${rpcAddress}`);
      }
    }

    if (!forceRest && restAddress && allRestEndpoints.includes(restAddress)) {
      allRestEndpoints.splice(allRestEndpoints.indexOf(restAddress), 1);
      allRestEndpoints.unshift(restAddress);
      if (restEndpointIndex > 0) {
        console.log(`Using validated REST [${restEndpointIndex}] for ${chain_name}: ${restAddress}`);
      }
    }
  }

  chain.apis.rpc = allRpcEndpoints.map(address => ({ address }));
  chain.apis.rest = allRestEndpoints.map(address => ({ address }));

  // -- Create Explorers Propterty --
  chain.explorers = [];
  chain.explorers[0] = {};
  chain.explorers[0].txPage = explorer;

  // -- Get Keplr Suggest Chain Features --
  getChainSuggestionFeatures(chain, zoneChain);

  // -- Override Minimal Chain Object with new Suggestion-compatible Chain Object --
  Object.assign(minimalChain, chain);
  //since minimalChain is a reference, I want each property (and sub object) in chain object to be added to minimalChain

  return true;


}

function getZoneChainOverrideProperties(chain, zoneChain) {

  // -- Get Outage Alerts with override support --
  if (zoneChain.override_properties?.outage || zoneChain.outage) {
    chain.outage = zoneChain.override_properties?.outage || zoneChain.outage;
  }

  return true;

}

async function generateChains(generatedChains, chainsToGenerate, local_chain_name) {
  //zone_chains.forEach(async (zone_chain) => {

  await asyncForEach(chainsToGenerate, async (chainToGenerate) => {

    // -- Start Chain Object --
    let chain = {
      chain_name: chainToGenerate.chain_name
    };
    // -- Minimal Metadata Requirements --
    let hasMinimalRequirements = getMininmalChainProperties(chain);
    if (!hasMinimalRequirements) return;

    // -- Suggestion Metadata Requirements --
    let ableToSuggest = await getSuggestionChainProperties(chain, chainToGenerate);
    if (!ableToSuggest) {
      generatedChains.push(chain);
      return;
    }
    
    // -- Get Manually Provided Values from Zone Chains --
    getZoneChainOverrideProperties(chain, chainToGenerate);

    // -- Push Chain --
    generatedChains.push(chain);

  });
  return;
}

function getZoneChains(chainName, zoneChains) {
  Object.assign(zoneChains,
    zone.readFromFile(
      chainName,
      zone.noDir,
      zone.zoneChainlistFileName
    )?.chains || []
  );
}

function getZoneAssets(chainName, assets) {
  Object.assign(assets,
    zone.readFromFile(
      chainName,
      zone.frontendAssetlistDir,
      zone.assetlistFileName
    )?.assets || []
  );
}

function getCounterpartyChainsFromAssets(chainName, chains = []) {

  //'assets' is an array of assets (formatted for frontend), which contains...
  //...all zone_assets + all other qualifying assets from the chain registry.

  //'chains' is an array of chains to add to the chainlist
  //by this stage, it should already have all the chains from zone_chains
  //this function adds to 'chains' any additional chains that are mentioned...
  //...as a counterparty chain for any asset in 'assets'

  let assets = [];
  getZoneAssets(chainName, assets);
  let chainNames = chains.map(chain => chain.chain_name);

  //iterate each chain in the file
  assets?.forEach((asset) => {
    //iterate each counterparty
    asset.counterparty?.forEach((counterparty) => {
      //add chain name to list (but don't add duplicates)
      //zone.addUniqueArrayItem(counterparty.chain_name, chainNames);
      if (!chainNames.includes(counterparty.chainName)) {
        let chain = {
          chain_name: counterparty.chainName
        }
        chains.push(chain);
        chainNames.push(counterparty.chainName);
      }
    });
  });

}

async function generateChainlist(chainName) {

  let chains = [];
  await getZoneChains(chainName, chains); // manually specified chains from zone_chains file

  //still need to get qualifying assets
  getCounterpartyChainsFromAssets(chainName, chains); // get additional chains

  let generatedChains = [];
  await generateChains(generatedChains, chains, chainName);//remove chainName once confirmed that it's not needed

  let generatedChainlist = {
    zone: chainName,
    chains: generatedChains,
  };

  zone.writeToFile(
    chainName,
    zone.zoneConfigChainlist,
    zone.chainlistFileName,
    generatedChainlist
  );
}

async function generateChainlists() {
  for (const chainName of zone.chainNames) {//mainnet, testnet, etc.
    await generateChainlist(chainName);
  }
}

function main() {
  generateChainlists();
}

main();
