// Purpose:
//   Post-processing step to deduplicate symbols by suffixing non-canonical assets with .chain
//
// Logic:
//   1. Collect all symbols after initial generation
//   2. Identify symbols that appear multiple times
//   3. For each duplicate:
//      - Keep canonical asset symbol unchanged
//      - Add .chain suffix to non-canonical variants
//
// Example:
//   Noble USDC (canonical)     → "USDC"      (unchanged)
//   Carbon USDC (non-canonical)→ "USDC.carbon" (suffixed)
//   Axelar USDC (non-canonical)→ "USDC.axelar" (suffixed)
//
// Symbols that differ only by case (solvBTC / SolvBTC) count as duplicates: a
// user picking from a list can't tell them apart either.

import * as chain_reg from "../../../chain-registry/.github/workflows/utility/chain_registry.mjs";

/**
 * Map of chain names to their short suffix forms
 * This is the single source of truth for all chain suffixes
 */
const CHAIN_SUFFIX_MAP = {
  "cosmoshub": "atom",
  "carbon": "carbon",
  "axelar": "axl",
  "ethereum": "eth",
  "polygon": "matic",
  "avalanche": "avax",
  "binancesmartchain": "bsc",
  "arbitrum": "arb",
  "optimism": "op",
  "composable": "pica",
  "composablepolkadot": "pica",
  "neutron": "ntrn",
  "stride": "strd",
  "injective": "inj",
  "dydx": "dydx",
  "celestia": "tia",
  "gateway": "wh",
  "forex": "forex",
  "gravitybridge": "grv",
  "kujira": "kuji",
  "nomic": "nom",
  "oraichain": "orai",
  "planq": "planq",
  "terra2": "luna",
  "onomy": "nym",
  "source": "src",
  "sunrise": "rise",
  "juno": "juno",
  "persistence": "xprt",
  "noble": "noble",
};

/**
 * Short forms for bridge providers named in registry traces, used when two
 * assets share a symbol, chain and origin and differ only by the bridge.
 */
const PROVIDER_SUFFIX_MAP = {
  "portal": "wh",
  "wormhole": "wh",
  "axelar": "axl",
  "gravity bridge": "grv",
  "nomic": "nom",
  "picasso": "pica",
};

// Case-insensitive grouping key, so case-only look-alikes are deduplicated.
const symbolKey = (symbol) => symbol.toLowerCase();

/**
 * Group assets by their current frontend symbol, case-insensitively.
 * @returns {Map<string, Array>} symbol key → assets
 */
function groupBySymbol(asset_datas) {
  const groups = new Map();
  asset_datas.forEach((asset_data) => {
    const symbol = asset_data.frontend?.symbol;
    if (!symbol) return;
    const key = symbolKey(symbol);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(asset_data);
  });
  return groups;
}

/**
 * Short form of the bridge provider that brought an asset to the chain it is
 * transferred to Osmosis from, or null when the registry names none.
 */
function getProviderSuffix(asset_data) {
  const traces = asset_data.traces_for_deduplication ?? [];
  const provider = traces
    .slice(0, -1)
    .reverse()
    .find((trace) => trace?.provider && trace.provider.toLowerCase() !== "unknown")
    ?.provider;
  if (!provider) return null;
  const key = provider.toLowerCase();
  return PROVIDER_SUFFIX_MAP[key] || key.replace(/[^a-z0-9]/g, "");
}

/**
 * Get a short, human-readable chain name for suffixing
 * @param {string} chainName - Full chain name
 * @returns {string} Short chain name for suffix
 */
function getChainSuffix(chainName) {
  // Return mapped name or use chain name as-is
  return CHAIN_SUFFIX_MAP[chainName?.toLowerCase()] || chainName?.toLowerCase() || "unknown";
}

/**
 * Deduplicates symbols by adding .chain suffix to non-canonical duplicates
 * @param {Array} asset_datas - Array of asset data objects from generate_assetlist.mjs
 */
export function deduplicateSymbols(asset_datas) {
  console.log(`\n=== Symbol Deduplication Starting ===`);
  console.log(`Total assets: ${asset_datas.length}`);

  // Track all chains that need suffixes for the suffix map
  const chainsNeedingSuffixes = new Set();

  // Step 1: Group assets by their current symbol (case-insensitive)
  const symbolGroups = groupBySymbol(asset_datas);

  console.log(`Unique symbols before deduplication: ${symbolGroups.size}`);

  // Step 2: Find duplicate symbols (symbols with multiple assets)
  const duplicateSymbols = Array.from(symbolGroups.entries())
    .filter(([symbol, assets]) => assets.length > 1);

  console.log(`Symbols with duplicates: ${duplicateSymbols.length}`);

  // Step 3: Process each duplicate symbol group
  let suffixedCount = 0;

  duplicateSymbols.forEach(([symbol, assets]) => {
    console.log(`\nProcessing duplicate symbol: ${symbol} (${assets.length} variants)`);

    // Find the preferred asset using fallback hierarchy:
    // 1. Asset with canonical field set (explicitly configured)
    // 2. First verified asset
    // 3. First asset in the group
    let preferredAsset = assets.find(asset_data => asset_data.zone_asset?.canonical);
    let preferredReason = "has canonical field";

    if (!preferredAsset) {
      preferredAsset = assets.find(asset_data => asset_data.frontend?.verified);
      preferredReason = "is verified";
    }

    if (!preferredAsset) {
      preferredAsset = assets[0];
      preferredReason = "is first in list";
    }

    if (preferredAsset) {
      console.log(`  ✓ Preferred: ${preferredAsset.frontend.symbol} (${preferredAsset.source_asset?.chain_name}) - ${preferredReason}`);
    }

    // Suffix all non-preferred assets
    assets.forEach((asset_data) => {
      // Skip if this is the preferred asset
      if (asset_data === preferredAsset) {
        console.log(`  ✓ Keeping: ${symbol} (${asset_data.source_asset?.chain_name})`);
        return;
      }

      // Skip if already has an override (respect manual overrides)
      if (asset_data.zone_asset?.override_properties?.symbol) {
        console.log(`  ⊘ Skipping ${symbol} - has manual override`);
        return;
      }

      // Get the chain name for suffixing
      const chainName = asset_data.source_asset?.chain_name;
      if (!chainName) {
        console.log(`  ✗ Cannot suffix ${symbol} - missing chain name`);
        return;
      }

      const chainSuffix = getChainSuffix(chainName);
      const ownSymbol = asset_data.frontend.symbol;
      const newSymbol = `${ownSymbol}.${chainSuffix}`;

      console.log(`  → Suffixing: ${ownSymbol} → ${newSymbol} (from ${chainName})`);

      // Track this chain for suffix map verification
      chainsNeedingSuffixes.add(chainName);

      // Update the symbol in all output formats
      asset_data.frontend.symbol = newSymbol;
      asset_data.asset_detail.symbol = newSymbol;
      // Note: We don't change chain_reg.symbol as that represents the source chain's symbol

      suffixedCount++;
    });
  });

  console.log(`\n=== Symbol Deduplication Complete ===`);
  console.log(`Total assets suffixed: ${suffixedCount}`);

  // Step 4: Handle secondary duplicates (e.g., USDC.carbon appears twice)
  // After initial suffixing, check if any suffixed symbols are still duplicates
  const secondarySymbolGroups = groupBySymbol(asset_datas);

  const secondaryDuplicates = Array.from(secondarySymbolGroups.entries())
    .filter(([symbol, assets]) => assets.length > 1);

  if (secondaryDuplicates.length > 0) {
    console.log(`\n=== Resolving Secondary Duplicates ===`);
    console.log(`Found ${secondaryDuplicates.length} symbols that need further disambiguation`);

    secondaryDuplicates.forEach(([symbol, assets]) => {
      console.log(`\nResolving: ${symbol} (${assets.length} variants)`);

      // For secondary duplicates, add origin chain suffix to ALL variants for clarity
      // This way both variants show where they came from (e.g., ETH.base.carbon vs ETH.eth.carbon)
      assets.forEach((asset_data, index) => {
        // Try to get immediate source chain from trace chain
        // Traces are ordered from origin to current: [origin→hop1, hop1→hop2, ..., lastHop→current]
        // The last trace is always the IBC transfer to the current chain (e.g., carbon → osmosis)
        // We want the second-to-last trace to get the immediate source (e.g., binancesmartchain → carbon)
        // This gives more meaningful suffixes: USDC.bsc.carbon instead of USDC.forex.carbon
        let originChain = null;

        if (asset_data.traces_for_deduplication?.length > 1) {
          // Get the SECOND-TO-LAST trace to find the immediate source chain
          // The last trace is always the IBC transfer to Osmosis (carbon → osmosis)
          // The second-to-last shows the hop right before that (e.g., binancesmartchain → carbon)
          const immediateSourceTrace = asset_data.traces_for_deduplication[asset_data.traces_for_deduplication.length - 2];
          originChain = immediateSourceTrace?.counterparty?.chain_name;
        }

        // Fallback: Check counterparty chain (for IBC assets without full traces)
        if (!originChain && asset_data.frontend?.counterparty?.length > 0) {
          const counterpartyChain = asset_data.frontend.counterparty[0]?.chainName;
          if (counterpartyChain && counterpartyChain !== asset_data.source_asset?.chain_name) {
            originChain = counterpartyChain;
          }
        }

        const ownSymbol = asset_data.frontend.symbol;
        let newSymbol;
        if (originChain) {
          const originSuffix = getChainSuffix(originChain);

          // Track this chain for suffix map verification
          chainsNeedingSuffixes.add(originChain);

          // Insert origin chain before the last bridge suffix
          // e.g., ETH.carbon (from base) → ETH.base.carbon
          const parts = ownSymbol.split('.');
          if (parts.length > 1) {
            // Symbol already has suffixes (e.g., "ETH.carbon")
            const basePart = parts.slice(0, -1).join('.'); // "ETH"
            const bridgePart = parts[parts.length - 1]; // "carbon"
            newSymbol = `${basePart}.${originSuffix}.${bridgePart}`;
            console.log(`  → Inserting origin chain: ${ownSymbol} → ${newSymbol} (${originChain} via ${bridgePart})`);
          } else {
            // Symbol has no suffix yet (shouldn't happen in secondary dedup, but handle it)
            newSymbol = `${ownSymbol}.${originSuffix}`;
            console.log(`  → Adding origin chain suffix: ${ownSymbol} → ${newSymbol} (from ${originChain})`);
          }
        } else {
          // Fall back to numeric suffix if origin can't be determined
          newSymbol = `${ownSymbol}.${index + 1}`;
          console.log(`  → Adding numeric suffix (origin unknown): ${ownSymbol} → ${newSymbol}`);
        }

        asset_data.frontend.symbol = newSymbol;
        asset_data.asset_detail.symbol = newSymbol;
        suffixedCount++;
      });
    });

    console.log(`\n=== Secondary Deduplication Complete ===`);
  }

  // Step 5: Same symbol, chain and origin, so only the bridge tells them apart
  // (two LINK cw20s on Terra, one bridged from Ethereum by Portal). Insert the
  // bridge provider before the last suffix on the assets whose trace names one:
  // LINK.eth.terra (Portal) → LINK.eth.wh.terra. An asset whose trace names no
  // provider keeps its symbol, so it stays stable as other listings come and go.
  const tertiaryDuplicates = Array.from(groupBySymbol(asset_datas).values())
    .filter((assets) => assets.length > 1);
  tertiaryDuplicates.forEach((assets) => {
    const withProvider = assets
      .map((asset_data) => ({ asset_data, provider: getProviderSuffix(asset_data) }))
      .filter(({ provider }) => provider);
    const distinctProviders = new Set(withProvider.map(({ provider }) => provider));
    // Inserting the same provider into every member would leave them equal.
    if (distinctProviders.size < withProvider.length) return;
    if (withProvider.length === assets.length && distinctProviders.size === 1) return;
    withProvider.forEach(({ asset_data, provider }) => {
      const parts = asset_data.frontend.symbol.split('.');
      const newSymbol = parts.length > 1
        ? `${parts.slice(0, -1).join('.')}.${provider}.${parts[parts.length - 1]}`
        : `${parts[0]}.${provider}`;
      console.log(`  → Inserting bridge provider: ${asset_data.frontend.symbol} → ${newSymbol}`);
      asset_data.frontend.symbol = newSymbol;
      asset_data.asset_detail.symbol = newSymbol;
      suffixedCount++;
    });
  });

  // Step 6: Verify no duplicates remain
  const finalSymbolGroups = groupBySymbol(asset_datas);

  const remainingDuplicates = Array.from(finalSymbolGroups.entries())
    .filter(([symbol, assets]) => assets.length > 1);

  if (remainingDuplicates.length > 0) {
    console.log(`\n⚠ WARNING: ${remainingDuplicates.length} symbols still have duplicates:`);
    remainingDuplicates.forEach(([symbol, assets]) => {
      console.log(`  - ${assets.map((a) => a.frontend.symbol).join(' / ')}: ${assets.length} assets`);
    });
  } else {
    console.log(`\n✓ Success: All duplicate symbols resolved!`);
  }

  console.log(`Final unique symbols: ${finalSymbolGroups.size}`);

  // Report chain suffix map status
  if (chainsNeedingSuffixes.size > 0) {
    console.log(`\n=== Chain Suffix Map Report ===`);
    console.log(`Total chains used for suffixing: ${chainsNeedingSuffixes.size}`);

    const unmappedChains = [];
    const mappedChains = [];

    chainsNeedingSuffixes.forEach(chain => {
      const chainLower = chain?.toLowerCase();
      if (CHAIN_SUFFIX_MAP[chainLower]) {
        mappedChains.push(`${chain} → ${CHAIN_SUFFIX_MAP[chainLower]}`);
      } else {
        unmappedChains.push(chain);
      }
    });

    if (mappedChains.length > 0) {
      console.log(`\n✓ Mapped chains (${mappedChains.length}):`);
      mappedChains.sort().forEach(mapping => console.log(`  ${mapping}`));
    }

    if (unmappedChains.length > 0) {
      console.log(`\n⚠ Unmapped chains using fallback (${unmappedChains.length}):`);
      unmappedChains.sort().forEach(chain => console.log(`  ${chain} → ${chain.toLowerCase()} (add to chainSuffixMap for custom suffix)`));
    }
  }

  console.log(); // Empty line at end
}
