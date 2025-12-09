/*
 * Automated Verification Checker for Osmosis Assets
 *
 * Purpose:
 *   Checks if assets meet criteria required for verified status on Osmosis Zone.
 *   Criteria match LISTING.md (lines 30-48): "Upgrade Asset to Verified Status"
 *   Assets are still subject to manual verification of Deposit/Withdrawal and Swaps, this acts as a reference to pick up missing checks.
 *
 * Usage:
 *   node checkVerificationCriteria.mjs [chain-name]
 *   Example: node checkVerificationCriteria.mjs osmosis-1
 *
 * Output:
 *   - Markdown report: {chain}/generated/verification_reports/verification_report_latest.md
 
 *
 * GitHub Workflow:
 *   - .github/workflows/check_verification_criteria.yml
 *   - Manual trigger only (workflow_dispatch)
 *   - Uploads reports as artifacts
 *
 * ============================================================================
 * VERIFICATION CRITERIA (8 Checks)
 * ============================================================================
 *
 * 1. STANDARD LISTING
 *    - Asset exists in Chain Registry with required metadata
 *    - Check: chain_reg.getAssetObject(chainName, baseDenom)
 *    - Required fields: Name, Symbol, Base, Display, Type_asset
 *    - Pass: Asset object exists
 *    - Fail: Asset not found in registry
 *
 * 2. MEANINGFUL DESCRIPTION
 *    - Has a meaningful `description` field
 *    - Check: asset.description.length >= 15
 *    - Required for all assets (including memes)
 *    - Pass: Description exists and ≥15 characters
 *    - Fail: Missing or too short
 *
 * 3. EXTENDED DESCRIPTION
 *    - Has a detailed `extended_description` field
 *    - Check: asset.extended_description.length >= 100
 *    - Exemptions:
 *      a) Meme tokens (must have "meme" in categories array)
 *      b) Derivative assets (if origin asset has extended_description)
 *         Example: USDT.eth.axl can inherit from USDT
 *         Detection: asset.traces.length > 0
 *    - Pass: ≥100 chars OR meme OR derivative with valid origin
 *    - Fail: Missing/short and not exempt
 *
 * 4. SOCIALS
 *    - Has both `website` and `twitter/x` in socials
 *    - Check: !!asset.socials.website && !!asset.socials.twitter
 *    - Fallback: For staking tokens, checks chain-level socials
 *    - Exemption: Meme tokens (skipped)
 *    - Pass: Both website AND twitter present
 *    - Fail: Either missing
 *
 * 5. LOGO
 *    - Logo has square aspect ratio and file size <250KB
 *    - Check: Downloads actual image file and parses binary
 *    - PNG: Parses header at bytes 16-23 for width/height
 *      PNG structure: [8 byte signature][IHDR chunk with dimensions]
 *      Width: bytes 16-19 (big-endian uint32)
 *      Height: bytes 20-23 (big-endian uint32)
 *    - SVG: Only checks file size (aspect ratio requires XML parsing)
 *    - Osmosis Fallback: For cross-chain IBC assets with minimal source chain metadata,
 *      checks osmosis-1/generated/chain_registry/assetlist.json for logo_URIs
 *      by matching traces (counterparty.chain_name + counterparty.base_denom)
 *    - Pass: Square (width === height) AND <250KB for PNG, OR <250KB for SVG
 *    - Fail: Not square, too large, or inaccessible
 *
 * 6. POOL LIQUIDITY
 *    - Asset must have ≥$1000 USD liquidity
 *    - Check: Uses Numia tokens API directly
 *    - API: https://public-osmosis-api.numia.xyz/tokens/v2/all
 *      Returns: { denom, price, exponent, liquidity } for 2800+ tokens
 *    - Process:
 *      a) Fetches token data from Numia API
 *      b) Looks up asset's denom in Numia data
 *      c) Checks if liquidity >= $1000
 *    - Pass: liquidity >= $1000
 *    - Fail: Not found in Numia data or liquidity < $1000
 *
 * 7. BID DEPTH (2% SLIPPAGE TEST)
 *    - Pool must have 2% depth of $50 (~$5k full range liquidity)
 *    - Verifies $50 USDC can be swapped with <2% slippage
 *    - Check: Queries Numia depth API for exact 2% depth measurement
 *    - APIs:
 *      - Pairs: https://public-osmosis-api.numia.xyz/pairs/v2/summary
 *        Returns: { pool_id, base_address, quote_address, liquidity, ... }
 *      - Depth: https://public-osmosis-api.numia.xyz/pools/depth/{pool_id}/current?percent=2
 *    - Process:
 *      a) Find largest pool containing asset using Numia pairs API
 *      b) Get pool ID from largest pool
 *      c) Query depth API for 2% slippage data
 *      d) Extract usd_amount from both base_sell_depth and quote_sell_depth
 *    - API Response:
 *      {
 *        "base_sell_depth": {
 *          "token_denom": "ibc/D189...",
 *          "token_amount": "1275.391316",
 *          "usd_amount": "1278.09",     // Direct USD value at 2% depth
 *          "depth": 0.98                // Price impact (-2%)
 *        },
 *        "quote_sell_depth": {
 *          "token_denom": "uosmo",
 *          "token_amount": "14075.760319",
 *          "usd_amount": "1285.36",     // Direct USD value at 2% depth
 *          "depth": 1.02                // Price impact (+2%)
 *        }
 *      }
 *    - Primary check: usd_amount >= $50 for either base OR quote
 *      Works for ALL pairs (USDC, OSMO, ATOM, anything) since API provides USD
 *    - Fallback (if API unavailable): Uses pool liquidity >= $51
 *    - Pass: Either side has usd_amount >= $50 at 2% depth
 *    - Fail: Both sides < $50, or no pool found
 *
 * 8. CHAIN STATUS
 *    - Verifies the asset's chain is not marked as "killed"
 *    - Check: chain_reg.getFileProperty(chainName, 'chain', 'status') !== 'killed'
 *    - Exemption: Meme tokens (category includes "meme") skip this check
 *    - Pass: Chain status is "live" or "upcoming" OR asset is a meme token
 *    - Fail: Chain status is "killed" (unless meme token)
 *    - Purpose: Prevents verification of assets on killed/deprecated chains
 *      while allowing historical meme tokens to remain verified
 *
 * ============================================================================
 * ALLOY AUTO-VERIFICATION
 * ============================================================================
 *
 * Assets that are part of verified transmuter pools are automatically marked
 * as ready for verification, even if they fail individual checks.
 *
 * How It Works:
 *   1. Identifies all verified alloyed assets (e.g., allBTC, allETH, allUSDT,
 *      allSOL, etc.) from zone_assets.json
 *   2. Extracts the contract address from each alloy's factory denom:
 *      - Format: factory/{contract}/alloyed/{symbol}
 *      - Example: factory/osmo1z6r6...fu25e3/alloyed/allBTC
 *                 → contract: osmo1z6r6...fu25e3
 *   3. Uses Numia pairs API to find transmuter pools:
 *      - Transmuter pools are CosmWasm pools where pool_address = contract
 *      - Example: Pool 1868 has pool_address matching allBTC contract
 *   4. Collects all base_address and quote_address denoms from matching pairs
 *   5. Maps these denoms to their parent alloy for auto-verification
 *   6. For each asset being verified:
 *      - Computes full denom (factory tokens use base_denom, IBC uses SHA256)
 *      - Checks if denom exists in transmuter pool member map
 *      - If yes: Sets readyForVerification = true, autoVerifiedByAlloy = true
 *      - All checks still run for reporting purposes
 *
 * IBC Hash Computation:
 *   - IBC denoms use format: ibc/HASH
 *   - HASH = uppercase hex of SHA256(path)
 *   - Example: transfer/channel-208/wbtc-satoshi →
 *              ibc/D1542AA8762DB13087D8364F3EA6509FD6F009A34F00426AF9E4F9FA85CBBF1F
 *
 * Report Display:
 *   - Auto-verified assets show special notice: "✨ Auto-verified: This asset
 *     is part of the verified {SYMBOL} transmuter pool"
 *   - Full check results still displayed for manual review
 *   - Example: WBTC, nBTC, ckBTC, axl-cbBTC in pool 1868 auto-verify as
 *     they're all part of the allBTC transmuter
 *
 * Use Cases:
 *   - New bridge variants added to existing transmuter pools
 *   - Cross-chain representations of the same underlying asset
 *   - Ensures all variants in a transmuter pool are verified consistently
 *
 * ============================================================================
 * REPORT OUTPUT
 * ============================================================================
 *
 * Markdown Report:
 *   - Summary: Counts of ready/verified/failed assets
 *   - Ready for Verification: Assets passing all checks (always shown with fallback text)
 *   - Failed Checks: Detailed breakdown with subsections (always shown with fallback text)
 *     - Check failure counts table
 *     - High Liquidity Assets Failing Verification (assets with $1000+ liquidity)
 *     - Socials Failure Reasons (breakdown of missing website/twitter)
 *     - Variants Missing Traces (assets containing "." without trace definitions)
 *     - Logo Failures (assets failing logo requirements)
 *   - Individual Asset Details: Full check results for each failing asset
 *
 * JSON Report:
 *   - summary: Aggregate statistics
 *   - results: Array of asset verification results
 *   - Each result includes:
 *     - Asset identifiers (chain_name, base_denom, comment)
 *     - Flags (currently_verified, is_meme, allChecksPassed, readyForVerification)
 *     - checks: Object with results for each of 7 criteria
 *       - passed: boolean
 *       - details: string explanation
 *       - Additional data (poolId, depthData, etc.) for debugging
 *
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

//-- Imports --

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import * as zone from './assetlist_functions.mjs';
import * as chain_reg from '../../../chain-registry/.github/workflows/utility/chain_registry.mjs';

chain_reg.setup();

//-- Constants --

const USDC_DENOM = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const MIN_LIQUIDITY_USD = 1000;
const BID_TEST_AMOUNT = 50; // $50 USD
const MAX_SLIPPAGE_PERCENT = 2; // 2% slippage tolerance
const MIN_EXTENDED_DESC_LENGTH = 100; // Minimum characters for detailed description
const MAX_LOGO_SIZE_BYTES = 250 * 1024; // 250KB

//-- Numia API Data Cache --
let numiaTokensCache = null;
let numiaPairsCache = null;
let alloyPoolsCache = null;

//-- Helper Functions --

/**
 * Safely get a property from an asset object
 */
function getAssetProperty(asset, propertyName) {
  if (!asset) { return; }
  return asset[propertyName];
}

/**
 * Compute IBC denomination hash from a path
 *
 * IBC denoms are computed as: ibc/HASH where HASH is the uppercase hex
 * representation of SHA256(path)
 *
 * @param {string} path - IBC path (e.g., "transfer/channel-208/wbtc-satoshi")
 * @returns {string} IBC denom (e.g., "ibc/...")
 */
function computeIbcDenom(path) {
  const hash = crypto.createHash('sha256').update(path).digest('hex').toUpperCase();
  return `ibc/${hash}`;
}

/**
 * Get the full denomination for an asset
 *
 * For Osmosis native assets (factory tokens), returns the base_denom directly.
 * For IBC assets, computes the IBC hash from the path.
 *
 * @param {Object} asset - Asset object from zone_assets.json
 * @returns {string} Full denomination
 */
function getFullDenom(asset) {
  // For Osmosis native assets (factory tokens, etc.), the base_denom IS the full denom
  if (asset.chain_name === 'osmosis') {
    return asset.base_denom;
  }

  // For IBC assets, compute the IBC hash from the path
  if (asset.path) {
    return computeIbcDenom(asset.path);
  }

  // Fallback to base_denom if no path (shouldn't happen for cross-chain assets)
  return asset.base_denom;
}

/**
 * Fetch token data from Numia API (includes liquidity values)
 * API: https://public-osmosis-api.numia.xyz/tokens/v2/all
 *
 * @returns {Map<string, {liquidity: number, price: number, exponent: number}>} Map of denom to token data
 */
async function fetchNumiaTokens() {
  if (numiaTokensCache) {
    return numiaTokensCache;
  }

  try {
    console.log("Fetching token data from Numia...");
    const response = await fetch('https://public-osmosis-api.numia.xyz/tokens/v2/all');
    const data = await response.json();

    const tokensMap = new Map();
    data.forEach(token => {
      if (token.denom) {
        tokensMap.set(token.denom, {
          liquidity: token.liquidity || 0,
          price: token.price || 0,
          exponent: token.exponent || 0
        });
      }
    });

    numiaTokensCache = tokensMap;
    console.log(`Loaded ${tokensMap.size} tokens from Numia`);
    return tokensMap;
  } catch (error) {
    console.error("Failed to fetch token data from Numia:", error);
    return new Map();
  }
}

/**
 * Fetch pool/pair data from Numia API (includes pool liquidity)
 * API: https://public-osmosis-api.numia.xyz/pairs/v2/summary
 *
 * @returns {Array<{pool_id: string, base_address: string, quote_address: string, liquidity: number}>}
 */
async function fetchNumiaPairs() {
  if (numiaPairsCache) {
    return numiaPairsCache;
  }

  try {
    console.log("Fetching pool/pair data from Numia...");
    const response = await fetch('https://public-osmosis-api.numia.xyz/pairs/v2/summary');
    const result = await response.json();
    const pairs = result.data || [];

    numiaPairsCache = pairs;
    console.log(`Loaded ${pairs.length} pools/pairs from Numia`);
    return pairs;
  } catch (error) {
    console.error("Failed to fetch pairs data from Numia:", error);
    return [];
  }
}

/**
 * Find the largest pool (by liquidity) containing the specified asset
 *
 * @param {string} denom - Asset denomination to find
 * @param {Array} pairs - Array of pool/pair data from Numia
 * @returns {Object|null} Largest pool containing the asset, or null if not found
 */
function findLargestPoolForAsset(denom, pairs) {
  // Filter pools containing this asset (either as base or quote)
  const poolsWithAsset = pairs.filter(pair =>
    pair.base_address === denom || pair.quote_address === denom
  );

  if (poolsWithAsset.length === 0) {
    return null;
  }

  // Sort by liquidity (descending) and return the largest
  poolsWithAsset.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
  return poolsWithAsset[0];
}

/**
 * Fetch transmuter pool data from Numia and build a map of which denoms are part of verified alloys
 *
 * Transmuter pools are CosmWasm pools where the pool address matches the alloy contract address.
 * The contract address is extracted from the alloyed asset factory denom.
 * E.g., factory/osmo1z6r6...qjjlqfu25e3/alloyed/allBTC
 *       -> contract: osmo1z6r6...qjjlqfu25e3 (this IS the pool address)
 *
 * @param {Map} allAssetsMap - Map of all assets indexed by canonical ID
 * @param {Array} numiaPairs - Array of pool/pair data from Numia
 * @returns {Map<string, {alloyDenom: string, alloySymbol: string}>} Map of denom to alloy info
 */
function buildAlloyTransmuterMap(allAssetsMap, numiaPairs) {
  if (alloyPoolsCache) {
    return alloyPoolsCache;
  }

  // Map: denom -> {alloyDenom, alloySymbol}
  const alloyMembersMap = new Map();

  // Find all verified alloyed assets
  const verifiedAlloys = Array.from(allAssetsMap.values()).filter(asset =>
    asset.is_alloyed && asset.osmosis_verified
  );

  console.log(`Found ${verifiedAlloys.length} verified alloyed assets`);

  // For each verified alloy, extract its contract address and find pool members
  for (const alloy of verifiedAlloys) {
    // Extract contract address from factory denom
    // Format: factory/{contract}/alloyed/{symbol}
    const match = alloy.base_denom.match(/^factory\/([^\/]+)\/alloyed\//);
    if (!match) {
      continue; // Not a factory denom or wrong format
    }

    const contractAddress = match[1];
    const alloySymbol = alloy._comment?.match(/\$([A-Z0-9]+)/)?.[1] || alloy.base_denom.split('/').pop();

    // Find all pairs where pool_address matches the contract address
    const transmuterPairs = numiaPairs.filter(pair => pair.pool_address === contractAddress);

    if (transmuterPairs.length === 0) {
      continue;
    }

    // Collect all unique denoms from base_address and quote_address
    const denomsInPool = new Set();
    transmuterPairs.forEach(pair => {
      if (pair.base_address) denomsInPool.add(pair.base_address);
      if (pair.quote_address) denomsInPool.add(pair.quote_address);
    });

    // Map all denoms (except the alloy itself) to this alloy
    denomsInPool.forEach(denom => {
      if (denom !== alloy.base_denom) {
        alloyMembersMap.set(denom, {
          alloyDenom: alloy.base_denom,
          alloySymbol
        });
      }
    });
  }

  console.log(`Found ${alloyMembersMap.size} assets that are part of verified transmuter pools`);
  alloyPoolsCache = alloyMembersMap;
  return alloyMembersMap;
}

/**
 * Check if an asset is part of a verified transmuter pool
 *
 * @param {string} denom - Full denom of the asset to check
 * @param {Map} alloyMembersMap - Map from buildAlloyTransmuterMap
 * @returns {Object|null} Alloy info if asset is in a transmuter pool, null otherwise
 */
function checkAlloyMembership(denom, alloyMembersMap) {
  return alloyMembersMap.get(denom) || null;
}

/**
 * Fetch and parse image metadata (dimensions and file size)
 *
 * For PNG: Parses binary header to extract width/height
 * PNG file structure:
 *   Bytes 0-7: PNG signature (0x89504E47...)
 *   Bytes 8-11: IHDR chunk length
 *   Bytes 12-15: "IHDR" identifier
 *   Bytes 16-19: Width (big-endian uint32)
 *   Bytes 20-23: Height (big-endian uint32)
 *
 * For SVG: Only checks file size (aspect ratio would require XML parsing)
 *
 * @param {string} url - Logo URL from Chain Registry
 * @returns {Object} { size, width, height, isSquare, error, note }
 */
async function fetchImageMetadata(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      return { error: `Failed to fetch: ${response.status}` };
    }

    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');

    if (!contentType?.startsWith('image/')) {
      return { error: 'Not an image' };
    }

    // For file size
    const size = contentLength ? parseInt(contentLength) : null;

    // Download full image to parse dimensions and get actual size
    const fullResponse = await fetch(url);
    const buffer = await fullResponse.arrayBuffer();
    const actualSize = buffer.byteLength;

    // Parse PNG binary header for dimensions
    if (url.endsWith('.png')) {
      const view = new DataView(buffer);

      // Verify PNG signature (first 4 bytes: 0x89504E47)
      if (view.getUint32(0) !== 0x89504E47) {
        return { error: 'Invalid PNG' };
      }

      // Extract dimensions from IHDR chunk
      // Width at bytes 16-19, height at 20-23 (both big-endian)
      const width = view.getUint32(16);
      const height = view.getUint32(20);

      return {
        size: actualSize,
        width,
        height,
        isSquare: width === height
      };
    }

    // For SVG: Only check file size
    // Aspect ratio would require XML parsing (viewBox attribute)
    if (url.endsWith('.svg')) {
      return {
        size: actualSize,
        width: null,
        height: null,
        isSquare: null,
        note: 'SVG aspect ratio check skipped'
      };
    }

    return {
      size: actualSize,
      width: null,
      height: null,
      isSquare: null
    };

  } catch (error) {
    return { error: error.message };
  }
}

function hasCategories(zoneAsset, categories) {
  if (!zoneAsset?.categories) return false;
  return categories.some(cat => zoneAsset.categories.includes(cat));
}

function isMemeToken(zoneAsset) {
  return hasCategories(zoneAsset, ['meme']);
}

/**
 * Check if a chain is marked as killed in the chain registry
 *
 * @param {string} chainName - Chain name to check
 * @returns {boolean} True if chain is killed, false otherwise
 */
function isChainKilled(chainName) {
  try {
    const chainStatus = chain_reg.getFileProperty(chainName, 'chain', 'status');
    return chainStatus === 'killed';
  } catch (error) {
    // If we can't read the chain status, assume it's not killed
    return false;
  }
}

//-- Verification Check Functions --

/**
 * Check 1: Standard Listing
 * Verifies asset exists in Chain Registry with required metadata
 */
async function checkStandardListing(chainName, baseDenom) {
  try {
    const asset = chain_reg.getAssetObject(chainName, baseDenom);
    return {
      passed: !!asset,
      details: asset ? 'Asset exists in Chain Registry' : 'Asset not found in Chain Registry'
    };
  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 2: Meaningful Description
 * Verifies asset has a meaningful description field (≥15 chars)
 * Required for all assets including memes
 */
async function checkDescription(chainName, baseDenom) {
  try {
    const asset = chain_reg.getAssetObject(chainName, baseDenom);
    const description = asset?.description;

    if (!description) {
      return {
        passed: false,
        details: 'No description field found'
      };
    }

    if (description.length < 15) {
      return {
        passed: false,
        details: `Description too short (${description.length} chars, need meaningful description)`
      };
    }

    return {
      passed: true,
      details: `Description found (${description.length} characters)`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 3: Extended Description
 * Verifies asset has detailed extended_description (≥100 chars)
 *
 * Exemptions:
 *   1. Meme tokens (category includes "meme")
 *   2. Derivative assets if origin has extended_description
 *      Example: USDT.eth.axl inherits from origin USDT
 *      Detection: asset.traces.length > 0
 *      Follows traces[0].counterparty to find origin
 *
 * Per LISTING.md lines 36-38
 */
async function checkExtendedDescription(chainName, baseDenom, isMeme) {
  try {
    const asset = chain_reg.getAssetObject(chainName, baseDenom);
    const extendedDesc = asset?.extended_description;

    // Exemption 1: Meme tokens
    if (isMeme) {
      return {
        passed: true,
        details: 'Skipped for meme category',
        skipped: true
      };
    }

    // Exemption 2: Derivative/variant assets
    // Check if this asset has traces (indicates it's bridged/wrapped)
    const isDerivative = asset?.traces && asset.traces.length > 0;

    if (isDerivative && !extendedDesc) {
      // Try to find and check the origin asset's extended_description
      let originAsset = asset;

      if (asset.traces && asset.traces[0]) {
        const trace = asset.traces[0];
        if (trace.counterparty) {
          try {
            // Follow the trace to the origin chain
            originAsset = chain_reg.getAssetObject(
              trace.counterparty.chain_name,
              trace.counterparty.base_denom
            );
          } catch (e) {
            // If we can't find origin, treat as non-derivative
          }
        }
      }

      // Check if origin has extended_description
      const originExtendedDesc = originAsset?.extended_description;
      if (originExtendedDesc && originExtendedDesc.length >= MIN_EXTENDED_DESC_LENGTH) {
        return {
          passed: true,
          details: `Derivative asset: origin has extended_description (${originExtendedDesc.length} chars)`,
          note: 'Extended description inherited from origin asset'
        };
      }
    }

    // Standard check: Asset itself must have extended_description
    if (!extendedDesc) {
      return {
        passed: false,
        details: 'No extended_description field found'
      };
    }

    if (extendedDesc.length < MIN_EXTENDED_DESC_LENGTH) {
      return {
        passed: false,
        details: `Extended description too short (${extendedDesc.length} chars, minimum ${MIN_EXTENDED_DESC_LENGTH})`
      };
    }

    return {
      passed: true,
      details: `Extended description found (${extendedDesc.length} characters)`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 4: Socials (Website & Twitter)
 * Verifies asset has both website and twitter/x URLs
 *
 * Exemption: Meme tokens (skipped)
 * Fallback: For staking tokens, checks chain-level socials
 *
 * Per LISTING.md lines 35-36
 */
async function checkSocials(chainName, baseDenom, isMeme) {
  try {
    // Exemption: Meme tokens
    if (isMeme) {
      return {
        passed: true,
        details: 'Skipped for meme category',
        skipped: true
      };
    }

    const asset = chain_reg.getAssetObject(chainName, baseDenom);
    let socials = asset?.socials;

    // Fallback: For staking tokens (like OSMO, ATOM), use chain socials
    if (!socials && asset?.is_staking) {
      socials = chain_reg.getFileProperty(chainName, 'chain', 'socials');
    }

    // Fallback: For derivative/synthetic assets, check origin asset
    if (!socials && asset?.traces && asset.traces.length > 0) {
      const trace = asset.traces[0];
      if (trace.counterparty) {
        try {
          const originAsset = chain_reg.getAssetObject(
            trace.counterparty.chain_name,
            trace.counterparty.base_denom
          );
          socials = originAsset?.socials;
        } catch (e) {
          // If we can't find origin, continue with no socials
        }
      }
    }

    const hasWebsite = !!socials?.website;
    // Handle both "twitter" and "x" fields (chain registry now uses "x")
    const hasTwitter = !!(socials?.twitter || socials?.x);

    if (!hasWebsite && !hasTwitter) {
      return {
        passed: false,
        details: 'Missing both website and twitter/x'
      };
    }

    if (!hasWebsite) {
      return {
        passed: false,
        details: 'Missing website'
      };
    }

    if (!hasTwitter) {
      return {
        passed: false,
        details: 'Missing twitter/x'
      };
    }

    const twitterUrl = socials.twitter || socials.x;
    return {
      passed: true,
      details: `Website: ${socials.website}, Twitter/X: ${twitterUrl}`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 5: Logo
 * Verifies logo has square aspect ratio and file size <250KB
 *
 * PNG: Downloads and parses binary header for exact dimensions
 * SVG: Only checks file size (aspect ratio requires XML parsing)
 *
 * Per LISTING.md line 39
 */
async function checkLogo(chainName, baseDenom) {
  try {
    const asset = chain_reg.getAssetObject(chainName, baseDenom);
    let logoURIs = asset?.logo_URIs;
    let isInherited = false;

    // If no logo, check if this is a variant/derivative asset with traces
    if (!logoURIs?.png && !logoURIs?.svg) {
      const isVariant = asset?.traces && asset.traces.length > 0;

      if (isVariant && asset.traces[0]?.counterparty) {
        try {
          // Try to get logo from origin asset
          const originAsset = chain_reg.getAssetObject(
            asset.traces[0].counterparty.chain_name,
            asset.traces[0].counterparty.base_denom
          );
          if (originAsset?.logo_URIs?.png || originAsset?.logo_URIs?.svg) {
            logoURIs = originAsset.logo_URIs;
            isInherited = true;
          }
        } catch (e) {
          // If we can't find origin, continue with no logo
        }
      }

      // If still no logo after checking origin, check osmosis chain registry as fallback
      // This helps when the source chain has minimal metadata but osmosis has full metadata
      if (!logoURIs?.png && !logoURIs?.svg && chainName !== 'osmosis') {
        try {
          // Read osmosis assetlist directly from the generated chain_registry
          // process.cwd() is .github/workflows/utility, so go up 3 levels to repo root
          const osmosisAssetlistPath = path.join(process.cwd(), '../../../osmosis-1/generated/chain_registry/assetlist.json');

          if (fs.existsSync(osmosisAssetlistPath)) {
            const osmosisAssetlist = JSON.parse(fs.readFileSync(osmosisAssetlistPath, 'utf8'));
            const osmosisAssets = osmosisAssetlist.assets;

            if (osmosisAssets && Array.isArray(osmosisAssets)) {
              const matchingOsmosisAsset = osmosisAssets.find(osmosisAsset => {
                // Check if this osmosis asset traces back to our chain/denom
                if (!osmosisAsset.traces || osmosisAsset.traces.length === 0) return false;

                const trace = osmosisAsset.traces[0];
                return trace?.counterparty?.chain_name === chainName &&
                       trace?.counterparty?.base_denom === baseDenom;
              });

              if (matchingOsmosisAsset?.logo_URIs?.png || matchingOsmosisAsset?.logo_URIs?.svg) {
                logoURIs = matchingOsmosisAsset.logo_URIs;
                isInherited = true;
              }
            }
          }
        } catch (e) {
          // If osmosis fallback fails, continue with no logo
        }
      }

      // If still no logo after all checks
      if (!logoURIs?.png && !logoURIs?.svg) {
        return {
          passed: false,
          details: 'No logo found (png or svg)'
        };
      }
    }

    // Check PNG if available
    let pngResult = null;
    if (logoURIs.png) {
      pngResult = await fetchImageMetadata(logoURIs.png);
      if (pngResult.error) {
        return {
          passed: false,
          details: `PNG logo error: ${pngResult.error}`
        };
      }

      if (pngResult.size > MAX_LOGO_SIZE_BYTES) {
        return {
          passed: false,
          details: `PNG logo too large: ${(pngResult.size / 1024).toFixed(2)}KB (max 250KB)`
        };
      }

      if (pngResult.isSquare === false) {
        // Allow tolerance of ±2 pixels for square check
        const tolerance = 2;
        const diff = Math.abs(pngResult.width - pngResult.height);
        if (diff > tolerance) {
          return {
            passed: false,
            details: `PNG logo not square: ${pngResult.width}x${pngResult.height} (diff: ${diff}px, tolerance: ${tolerance}px)`
          };
        }
      }
    }

    // Check SVG if available
    let svgResult = null;
    if (logoURIs.svg) {
      svgResult = await fetchImageMetadata(logoURIs.svg);
      if (svgResult.error) {
        // SVG check is optional if PNG passed
        if (pngResult?.passed !== false) {
          return {
            passed: true,
            details: `PNG logo valid (${(pngResult.size / 1024).toFixed(2)}KB, ${pngResult.width}x${pngResult.height}), SVG check failed`,
            warnings: [`SVG: ${svgResult.error}`]
          };
        }
      } else if (svgResult.size > MAX_LOGO_SIZE_BYTES) {
        if (pngResult?.passed !== false) {
          return {
            passed: true,
            details: `PNG logo valid, SVG too large: ${(svgResult.size / 1024).toFixed(2)}KB`,
            warnings: ['SVG exceeds 250KB']
          };
        }
      }
    }

    const details = [];
    if (isInherited) {
      details.push('Logo inherited from origin asset');
    }
    if (pngResult) {
      details.push(`PNG: ${(pngResult.size / 1024).toFixed(2)}KB, ${pngResult.width}x${pngResult.height}`);
    }
    if (svgResult && !svgResult.error) {
      details.push(`SVG: ${(svgResult.size / 1024).toFixed(2)}KB`);
    }

    return {
      passed: true,
      details: details.join(', ')
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 6: Pool Liquidity
 * Verifies asset has ≥$1000 USD liquidity
 *
 * Process:
 *   1. Looks up token in Numia tokens API data
 *   2. Checks if liquidity >= $1000
 *
 * Uses Numia's pre-calculated liquidity values directly
 * No need for complex multi-hop route building
 *
 * Per LISTING.md line 43
 *
 * @param {string} chainName - Chain name
 * @param {string} baseDenom - Base denomination
 * @param {Map} numiaTokens - Token liquidity data from Numia API
 */
async function checkPoolLiquidity(chainName, baseDenom, numiaTokens) {
  try {
    if (!numiaTokens) {
      return {
        passed: false,
        details: 'No liquidity data available'
      };
    }

    const tokenData = numiaTokens.get(baseDenom);

    if (!tokenData) {
      return {
        passed: false,
        details: 'Asset not found in Numia data'
      };
    }

    const liquidity = tokenData.liquidity || 0;

    if (liquidity < 1000) {
      return {
        passed: false,
        details: `Insufficient liquidity: $${liquidity.toFixed(0)} (need $1000+)`
      };
    }

    return {
      passed: true,
      details: `Liquidity: $${liquidity.toFixed(0)}`
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 7: Bid Depth (2% Slippage Test)
 * Verifies pool has 2% depth of $50 (~$5k full range liquidity)
 * Confirms $50 USDC can be swapped with <2% slippage
 *
 * Method: Queries Numia depth API for exact 2% depth measurement
 * API: https://public-osmosis-api.numia.xyz/pools/depth/{pool_id}/current?percent=2
 *
 * Process:
 *   1. Find largest pool for asset using Numia pairs data
 *   2. Query Numia API for depth at 2% price impact
 *   3. Check if usd_amount >= $50 for base OR quote
 *
 * API Response Example:
 *   {
 *     "base_sell_depth": {
 *       "token_denom": "ibc/D189...",
 *       "token_amount": "1275.391316",
 *       "usd_amount": "1278.09",    // Direct USD value at 2% depth
 *       "depth": 0.98               // Price impact (-2%)
 *     },
 *     "quote_sell_depth": {
 *       "token_denom": "uosmo",
 *       "token_amount": "14075.760319",
 *       "usd_amount": "1285.36",    // Direct USD value at 2% depth
 *       "depth": 1.02               // Price impact (+2%)
 *     }
 *   }
 *
 * Per LISTING.md lines 44-47
 *
 * @param {string} chainName - Chain name
 * @param {string} baseDenom - Base denomination
 * @param {Array} numiaPairs - Pool/pair data from Numia API
 */
async function checkBidDepth(chainName, baseDenom, numiaPairs) {
  try {
    if (!numiaPairs) {
      return {
        passed: false,
        details: 'No pool data available'
      };
    }

    // Find the largest pool containing this asset
    const largestPool = findLargestPoolForAsset(baseDenom, numiaPairs);

    if (!largestPool) {
      return {
        passed: false,
        details: 'Asset not found in any pool'
      };
    }

    const poolId = largestPool.pool_id;
    const poolLiquidity = largestPool.liquidity || 0;

    if (!poolId) {
      return {
        passed: false,
        details: 'No pool ID found'
      };
    }

    // Query Numia depth API for 2% slippage depth
    const depthUrl = `https://public-osmosis-api.numia.xyz/pools/depth/${poolId}/current?percent=2`;

    let depthData;
    try {
      const response = await fetch(depthUrl);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      depthData = await response.json();
    } catch (apiError) {
      // Fail if depth API is unavailable
      return {
        passed: false,
        details: `Pool ${poolId}: Depth API unavailable (${apiError.message}) - pool liquidity: $${poolLiquidity.toFixed(0)}`,
        poolId
      };
    }

    // Extract USD amounts directly from API
    // API provides usd_amount for both base and quote at 2% depth
    // Works for ALL pairs (USDC, OSMO, ATOM, etc.) - no need to identify stablecoins
    const baseDenomFromAPI = depthData.base_sell_depth?.token_denom;
    const quoteDenomFromAPI = depthData.quote_sell_depth?.token_denom;
    const baseUsdAmount = parseFloat(depthData.base_sell_depth?.usd_amount || 0);
    const quoteUsdAmount = parseFloat(depthData.quote_sell_depth?.usd_amount || 0);
    const baseTokenAmount = parseFloat(depthData.base_sell_depth?.token_amount || 0);
    const quoteTokenAmount = parseFloat(depthData.quote_sell_depth?.token_amount || 0);

    // Check if either side has sufficient depth at 2% slippage
    let depthCheckPassed = false;
    let depthDetails = [];

    // Base side check
    if (baseUsdAmount >= BID_TEST_AMOUNT) {
      depthCheckPassed = true;
      depthDetails.push(`Base: $${baseUsdAmount.toFixed(2)} depth at 2%`);
    } else if (baseUsdAmount > 0) {
      depthDetails.push(`Base: $${baseUsdAmount.toFixed(2)} depth at 2% ❌ (need $${BID_TEST_AMOUNT})`);
    }

    // Quote side check
    if (quoteUsdAmount >= BID_TEST_AMOUNT) {
      depthCheckPassed = true;
      depthDetails.push(`Quote: $${quoteUsdAmount.toFixed(2)} depth at 2%`);
    } else if (quoteUsdAmount > 0) {
      depthDetails.push(`Quote: $${quoteUsdAmount.toFixed(2)} depth at 2% ❌ (need $${BID_TEST_AMOUNT})`);
    }

    // Fail if USD amounts not available from API
    // This usually means liquidity is heavily out of range on one or both sides
    if (baseUsdAmount === 0 && quoteUsdAmount === 0) {
      depthCheckPassed = false;
      depthDetails.push(`Depth estimate unavailable (pool liquidity: $${poolLiquidity.toFixed(0)}) - likely concentrated/out-of-range`);
    }

    return {
      passed: depthCheckPassed,
      details: depthDetails.length > 0
        ? `Pool ${poolId}: ${depthDetails.join(', ')}`
        : `Pool ${poolId}: Insufficient depth for $${BID_TEST_AMOUNT} swap with <${MAX_SLIPPAGE_PERCENT}% slippage`,
      poolId,
      depthData: {
        base: {
          denom: baseDenomFromAPI,
          tokenAmount: baseTokenAmount,
          usdAmount: baseUsdAmount
        },
        quote: {
          denom: quoteDenomFromAPI,
          tokenAmount: quoteTokenAmount,
          usdAmount: quoteUsdAmount
        }
      }
    };

  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error.message}`
    };
  }
}

/**
 * Check 8: Killed Chain Status
 * Verifies that the asset's chain is not marked as "killed" in the chain registry
 *
 * Assets on killed chains should not be verified, and already-verified assets
 * should be de-verified.
 *
 * Exemption: Meme tokens (category includes "meme") are allowed to remain verified
 * even on killed chains, as they may have historical/cultural value.
 *
 * Per LISTING.md chain status requirement
 *
 * @param {string} chainName - Chain name to check
 * @param {boolean} isMeme - Whether the asset is a meme token
 */
async function checkChainStatus(chainName, isMeme) {
  try {
    // Exemption: Meme tokens can remain verified on killed chains
    if (isMeme) {
      return {
        passed: true,
        details: 'Meme category: exempt from chain status check',
        skipped: true
      };
    }

    const chainIsKilled = isChainKilled(chainName);

    if (chainIsKilled) {
      return {
        passed: false,
        details: `Chain "${chainName}" is marked as killed in the chain registry`
      };
    }

    return {
      passed: true,
      details: 'Chain is active'
    };
  } catch (error) {
    return {
      passed: true,  // Assume chain is active if we can't check
      details: `Could not verify chain status: ${error.message}`
    };
  }
}

//-- Main Verification Function --

/**
 * Verify a single asset against all criteria
 *
 * @param {Object} zoneAsset - Asset from zone_assets.json
 * @param {Map} numiaTokens - Token liquidity data from Numia API
 * @param {Array} numiaPairs - Pool/pair data from Numia API
 */
async function verifyAsset(zoneAsset, numiaTokens, numiaPairs, alloyMembersMap) {
  const { chain_name, base_denom } = zoneAsset;
  const isMeme = isMemeToken(zoneAsset);
  const fullDenom = getFullDenom(zoneAsset);

  console.log(`\nVerifying ${chain_name}/${base_denom}...`);

  const results = {
    chain_name,
    base_denom,
    comment: zoneAsset._comment || '',
    currently_verified: zoneAsset.osmosis_verified || false,
    is_meme: isMeme,
    chainIsKilled: isChainKilled(chain_name),
    checks: {},
    alloyInfo: null
  };

  // Check if this asset is part of a verified transmuter pool
  const alloyInfo = checkAlloyMembership(fullDenom, alloyMembersMap);
  if (alloyInfo) {
    results.alloyInfo = alloyInfo;
    console.log(`  ✓ Part of verified ${alloyInfo.alloySymbol} transmuter pool`);
  }

  // Run all checks
  results.checks.standardListing = await checkStandardListing(chain_name, base_denom);
  results.checks.description = await checkDescription(chain_name, base_denom);
  results.checks.extendedDescription = await checkExtendedDescription(chain_name, base_denom, isMeme);
  results.checks.socials = await checkSocials(chain_name, base_denom, isMeme);
  results.checks.logo = await checkLogo(chain_name, base_denom);
  results.checks.poolLiquidity = await checkPoolLiquidity(chain_name, base_denom, numiaTokens);
  results.checks.bidDepth = await checkBidDepth(chain_name, base_denom, numiaPairs);
  results.checks.chainStatus = await checkChainStatus(chain_name, isMeme);

  // Determine overall pass/fail
  results.allChecksPassed = Object.values(results.checks).every(check => check.passed);

  // Auto-verify if part of verified alloy (even if checks fail)
  if (alloyInfo && !results.currently_verified) {
    results.readyForVerification = true;
    results.autoVerifiedByAlloy = true;
  } else {
    results.readyForVerification = results.allChecksPassed && !results.currently_verified;
    results.autoVerifiedByAlloy = false;
  }

  return results;
}

//-- Report Generation --

function generateMarkdownReport(verificationResults) {
  let markdown = '# Asset Verification Report\n\n';
  markdown += `Generated: ${new Date().toISOString()}\n\n`;

  const readyForVerification = verificationResults.filter(r => r.readyForVerification);
  const alreadyVerified = verificationResults.filter(r => r.currently_verified);
  const failedChecks = verificationResults.filter(r => !r.allChecksPassed && !r.currently_verified);

  // Filter killed chain assets (excluding meme tokens)
  const killedChainAssetsVerified = verificationResults.filter(r => r.chainIsKilled && r.currently_verified && !r.is_meme);
  const killedChainAssetsUnverified = verificationResults.filter(r => r.chainIsKilled && !r.currently_verified && !r.is_meme);

  markdown += `## Summary\n\n`;
  markdown += `- **Ready for Verification**: ${readyForVerification.length}\n`;
  markdown += `- **Failed Checks**: ${failedChecks.length}\n`;
  markdown += `- **Killed Chain Assets (Verified)**: ${killedChainAssetsVerified.length} (require de-verification)\n`;
  markdown += `- **Killed Chain Assets (Unverified)**: ${killedChainAssetsUnverified.length} (cannot be verified)\n`;
  markdown += `- **Total Checked**: ${verificationResults.length}\n\n`;

  // Ready for Verification section with asset links
  markdown += `## Ready for Verification: ${readyForVerification.length}\n\n`;

  if (readyForVerification.length > 0) {
    markdown += 'These assets pass all verification criteria:\n\n';

    readyForVerification.forEach(result => {
      const symbol = result.comment?.match(/\$([A-Z0-9]+)/)?.[1] || result.base_denom.split('/').pop();
      const assetUrl = `https://app.osmosis.zone/assets/${encodeURIComponent(symbol)}`;
      markdown += `### [${result.comment || result.base_denom}](${assetUrl})\n\n`;
      markdown += `**Chain**: ${result.chain_name} | **Denom**: \`${result.base_denom}\`\n\n`;

      // Show alloy auto-verification notice if applicable
      if (result.autoVerifiedByAlloy && result.alloyInfo) {
        markdown += `> ✨ **Auto-verified**: This asset is part of the verified **${result.alloyInfo.alloySymbol}** transmuter pool. All checks are still run for reporting purposes.\n\n`;
      }

      // Add detailed check results
      markdown += '| Check | Status | Details |\n';
      markdown += '|-------|--------|----------|\n';

      Object.entries(result.checks).forEach(([checkName, check]) => {
        const status = check.passed ? '✅' : (check.skipped ? '⏭️' : '❌');
        const name = checkName.replace(/([A-Z])/g, ' $1').trim();
        const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
        markdown += `| ${capitalizedName} | ${status} | ${check.details} |\n`;
      });

      markdown += '\n';
    });
  } else {
    markdown += 'No new assets currently pass all verification criteria.\n\n';
  }

  // Failed Checks section
  markdown += `## Failed Checks: ${failedChecks.length}\n\n`;

  if (failedChecks.length > 0) {
    const failureCounts = {
      standardListing: 0,
      description: 0,
      extendedDescription: 0,
      socials: 0,
      logo: 0,
      poolLiquidity: 0,
      bidDepth: 0
    };

    const socialsFailureReasons = {};
    const socialsFailedAssets = {};

    failedChecks.forEach(asset => {
      Object.entries(asset.checks).forEach(([checkName, check]) => {
        if (!check.passed && !check.skipped) {
          failureCounts[checkName]++;

          // Track socials failure details and assets
          if (checkName === 'socials') {
            const reason = check.details;
            socialsFailureReasons[reason] = (socialsFailureReasons[reason] || 0) + 1;

            if (!socialsFailedAssets[reason]) {
              socialsFailedAssets[reason] = [];
            }
            socialsFailedAssets[reason].push({
              symbol: asset.comment || asset.base_denom.substring(0, 40),
              chain: asset.chain_name,
              denom: asset.base_denom
            });
          }
        }
      });
    });

    markdown += `| Check | Failed Assets | Percentage |\n`;
    markdown += `|-------|---------------|------------|\n`;
    Object.entries(failureCounts).forEach(([check, count]) => {
      const percentage = ((count / failedChecks.length) * 100).toFixed(1);
      const name = check.replace(/([A-Z])/g, ' $1').trim();
      markdown += `| ${name} | ${count} | ${percentage}% |\n`;
    });
    markdown += '\n';

    // High Liquidity Assets Failing Verification
    // Find high-liquidity assets that are close to passing
    // Show all assets that pass pool liquidity but fail ANY other check
    const highLiquidityFailing = failedChecks
      .filter(r => r.checks.poolLiquidity?.passed)
      .sort((a, b) => {
        const aLiq = parseFloat(a.checks.poolLiquidity?.details?.match(/\$[\d,]+/)?.[0]?.replace(/[$,]/g, '') || 0);
        const bLiq = parseFloat(b.checks.poolLiquidity?.details?.match(/\$[\d,]+/)?.[0]?.replace(/[$,]/g, '') || 0);
        return bLiq - aLiq;
      })
      .slice(0, 10);

    markdown += `### High Liquidity Assets Failing Verification\n\n`;

    if (highLiquidityFailing.length > 0) {
      markdown += `These assets have sufficient pool liquidity ($1000+) but fail other checks:\n\n`;
      markdown += `| Asset | Comment | Pool Liquidity | Bid Depth | Other Failures |\n`;
      markdown += `|-------|---------|----------------|-----------|----------------|\n`;

      highLiquidityFailing.forEach(r => {
        const symbol = r.comment || r.base_denom.substring(0, 30);
        // Extract just the liquidity amount from the details string
        const liqMatch = r.checks.poolLiquidity?.details?.match(/\$[\d,]+/);
        const poolLiq = liqMatch ? liqMatch[0] : 'N/A';

        // Format bid depth
        let bidDepth = '';
        if (r.checks.bidDepth?.passed) {
          bidDepth = '✅ ' + r.checks.bidDepth.details;
        } else {
          const details = r.checks.bidDepth?.details || 'Failed';
          const cleanDetails = details
            .replace(/❌/g, '')
            .replace(/✅/g, '')
            .replace(/\(need \$\d+\)/g, '')
            .trim();
          bidDepth = '❌ ' + cleanDetails;
        }

        const otherFails = Object.entries(r.checks)
          .filter(([name, check]) => !check.passed && !check.skipped && name !== 'poolLiquidity' && name !== 'bidDepth')
          .map(([name]) => name.replace(/([A-Z])/g, ' $1').trim())
          .join(', ') || 'None';

        markdown += `| ${symbol} | ${r.chain_name} | ${poolLiq} | ${bidDepth} | ${otherFails} |\n`;
      });
      markdown += '\n';
    } else {
      markdown += `No high liquidity assets failing verification. All assets with sufficient pool liquidity ($1000+) pass all other checks.\n\n`;
    }

    // Socials Failure Reasons subsection
    markdown += `### Socials Failure Reasons\n\n`;

    if (Object.keys(socialsFailureReasons).length > 0) {
      markdown += `| Reason | Count |\n`;
      markdown += `|--------|-------|\n`;
      Object.entries(socialsFailureReasons)
        .sort((a, b) => b[1] - a[1])
        .forEach(([reason, count]) => {
          markdown += `| ${reason} | ${count} |\n`;
        });
      markdown += '\n';

      // List assets for specific socials failures
      const reasonsToList = ['Missing website', 'Missing twitter/x'];
      reasonsToList.forEach(reason => {
        const assets = socialsFailedAssets[reason];
        if (assets && assets.length > 0) {
          markdown += `#### Assets with "${reason}"\n\n`;
          assets.forEach(asset => {
            markdown += `- **${asset.symbol}** (${asset.chain})\n`;
          });
          markdown += '\n';
        }
      });
    } else {
      markdown += `No socials failures detected. All assets with socials requirements pass the socials check.\n\n`;
    }

    // Variants Missing Traces section
    // Check for assets that are likely variants (contain ".") but don't have defined traces
    const variantsMissingTraces = failedChecks.filter(r => {
      const likelyVariant = r.base_denom.includes('.');
      if (!likelyVariant) return false;

      // Check if asset has traces defined
      try {
        const asset = chain_reg.getAssetObject(r.chain_name, r.base_denom);
        const hasTraces = asset?.traces && asset.traces.length > 0;
        return !hasTraces;
      } catch (e) {
        return false;
      }
    });

    markdown += `### Variants Missing Traces\n\n`;

    if (variantsMissingTraces.length > 0) {
      markdown += `These assets appear to be variants (contain ".") but don't have defined traces:\n\n`;
      markdown += `| Asset | Comment | Chain | Base Denom |\n`;
      markdown += `|-------|---------|-------|------------|\n`;

      variantsMissingTraces.forEach(r => {
        const symbol = r.comment || r.base_denom.substring(0, 30);
        markdown += `| ${symbol} | ${r.chain_name} | ${r.chain_name} | ${r.base_denom} |\n`;
      });
      markdown += '\n';
    } else {
      markdown += `No variants missing traces found. All variant assets (containing ".") either have defined traces or are not in the failed checks.\n\n`;
    }

    // Logo Failures section
    const logoFailures = failedChecks.filter(r => !r.checks.logo?.passed);

    markdown += `### Logo Failures\n\n`;

    if (logoFailures.length > 0) {
      markdown += `These assets fail logo requirements:\n\n`;
      markdown += `| Asset | Comment | Issue |\n`;
      markdown += `|-------|---------|-------|\n`;

      logoFailures.forEach(r => {
        const symbol = r.comment || r.base_denom.substring(0, 40);
        const issue = r.checks.logo?.details || 'Unknown issue';
        markdown += `| ${symbol} | ${r.chain_name} | ${issue} |\n`;
      });
      markdown += '\n';
    } else {
      markdown += `No logo failures detected. All assets have valid logos that meet the requirements.\n\n`;
    }
  } else {
    markdown += `All assets pass verification checks!\n\n`;
  }

  if (failedChecks.length > 0) {
    markdown += `## ❌ Failed Verification Checks (${failedChecks.length})\n\n`;

    failedChecks.forEach(result => {
      markdown += `### ${result.chain_name}/${result.base_denom}\n`;
      if (result.comment) markdown += `*${result.comment}*\n\n`;
      if (result.is_meme) markdown += `*Meme token - socials/description checks skipped*\n\n`;

      markdown += '| Check | Status | Details |\n';
      markdown += '|-------|--------|----------|\n';

      Object.entries(result.checks).forEach(([checkName, check]) => {
        const status = check.passed ? '✅' : (check.skipped ? '⏭️' : '❌');
        const name = checkName.replace(/([A-Z])/g, ' $1').trim();
        markdown += `| ${name} | ${status} | ${check.details} |\n`;
      });

      markdown += '\n';
    });
  }

  // Killed Chain Assets Section
  if (killedChainAssetsVerified.length > 0 || killedChainAssetsUnverified.length > 0) {
    markdown += `## ⚠️ Killed Chain Assets Requiring De-verification\n\n`;
    markdown += `Assets from chains marked as "killed" in the chain registry (excluding meme tokens):\n\n`;

    // Currently Verified subsection
    if (killedChainAssetsVerified.length > 0) {
      markdown += `### Currently Verified (${killedChainAssetsVerified.length})\n\n`;
      markdown += `These verified assets belong to killed chains and should be de-verified:\n\n`;
      markdown += `| Asset | Chain | Base Denom | Comment |\n`;
      markdown += `|-------|-------|------------|----------|\n`;

      killedChainAssetsVerified.forEach(r => {
        const symbol = r.comment || r.base_denom.substring(0, 40);
        markdown += `| ${symbol} | ${r.chain_name} | \`${r.base_denom}\` | ${r.comment || 'N/A'} |\n`;
      });
      markdown += '\n';
    }

    // Unverified subsection
    if (killedChainAssetsUnverified.length > 0) {
      markdown += `### Unverified (${killedChainAssetsUnverified.length})\n\n`;
      markdown += `These unverified assets belong to killed chains and cannot be verified:\n\n`;
      markdown += `| Asset | Chain | Base Denom | Comment |\n`;
      markdown += `|-------|-------|------------|----------|\n`;

      killedChainAssetsUnverified.forEach(r => {
        const symbol = r.comment || r.base_denom.substring(0, 40);
        markdown += `| ${symbol} | ${r.chain_name} | \`${r.base_denom}\` | ${r.comment || 'N/A'} |\n`;
      });
      markdown += '\n';
    }

    markdown += `**Note:** Meme tokens are exempt from this requirement and may remain verified on killed chains due to their historical/cultural value.\n\n`;
  }

  return markdown;
}

function generateJSONReport(verificationResults) {
  const failedChecks = verificationResults.filter(r => !r.allChecksPassed && !r.currently_verified);

  // Filter killed chain assets (excluding meme tokens)
  const killedChainAssetsVerified = verificationResults.filter(r => r.chainIsKilled && r.currently_verified && !r.is_meme);
  const killedChainAssetsUnverified = verificationResults.filter(r => r.chainIsKilled && !r.currently_verified && !r.is_meme);

  // Calculate failure breakdown
  const failureCounts = {
    standardListing: 0,
    description: 0,
    extendedDescription: 0,
    socials: 0,
    logo: 0,
    poolLiquidity: 0,
    bidDepth: 0,
    chainStatus: 0
  };

  const socialsFailureReasons = {};

  failedChecks.forEach(asset => {
    Object.entries(asset.checks).forEach(([checkName, check]) => {
      if (!check.passed && !check.skipped) {
        failureCounts[checkName]++;

        if (checkName === 'socials') {
          const reason = check.details;
          socialsFailureReasons[reason] = (socialsFailureReasons[reason] || 0) + 1;
        }
      }
    });
  });

  // Calculate percentages
  const failureBreakdown = Object.entries(failureCounts).map(([check, count]) => ({
    check,
    count,
    percentage: failedChecks.length > 0 ? ((count / failedChecks.length) * 100).toFixed(1) : '0.0'
  }));

  // Find high-liquidity assets
  const highLiquidityFailing = failedChecks
    .filter(r => r.checks.poolLiquidity?.passed && !r.checks.bidDepth?.passed)
    .sort((a, b) => {
      const aLiq = parseFloat(a.checks.poolLiquidity?.details?.match(/\$[\d,]+/)?.[0]?.replace(/[$,]/g, '') || 0);
      const bLiq = parseFloat(b.checks.poolLiquidity?.details?.match(/\$[\d,]+/)?.[0]?.replace(/[$,]/g, '') || 0);
      return bLiq - aLiq;
    })
    .slice(0, 10)
    .map(r => ({
      chain_name: r.chain_name,
      base_denom: r.base_denom,
      comment: r.comment,
      poolLiquidity: r.checks.poolLiquidity?.details,
      bidDepth: r.checks.bidDepth?.details,
      otherFailures: Object.entries(r.checks)
        .filter(([name, check]) => !check.passed && !check.skipped && name !== 'poolLiquidity' && name !== 'bidDepth')
        .map(([name]) => name)
    }));

  return JSON.stringify({
    generated: new Date().toISOString(),
    summary: {
      readyForVerification: verificationResults.filter(r => r.readyForVerification).length,
      alreadyVerified: verificationResults.filter(r => r.currently_verified).length,
      failedChecks: failedChecks.length,
      killedChainAssetsVerified: killedChainAssetsVerified.length,
      killedChainAssetsUnverified: killedChainAssetsUnverified.length,
      totalChecked: verificationResults.length
    },
    analysis: {
      failureBreakdown,
      socialsFailureReasons,
      highLiquidityFailing,
      killedChainAssets: {
        verified: killedChainAssetsVerified.map(r => ({
          chain_name: r.chain_name,
          base_denom: r.base_denom,
          comment: r.comment,
          is_meme: r.is_meme,
          chainIsKilled: r.chainIsKilled
        })),
        unverified: killedChainAssetsUnverified.map(r => ({
          chain_name: r.chain_name,
          base_denom: r.base_denom,
          comment: r.comment,
          is_meme: r.is_meme,
          chainIsKilled: r.chainIsKilled
        }))
      }
    },
    results: verificationResults
  }, null, 2);
}

//-- Main Execution --

async function runVerificationReport(chainName = 'osmosis-1') {
  console.log(`Starting verification report for ${chainName}...`);

  // Load zone assets (go up 3 levels from utility/ to repo root)
  // Use fileURLToPath for proper Windows path handling
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const zoneAssetsPath = path.join(repoRoot, chainName, 'osmosis.zone_assets.json');
  const zoneAssetsData = JSON.parse(fs.readFileSync(zoneAssetsPath, 'utf8'));

  // Build allAssetsMap for alloy detection (need all assets, not just unverified)
  const allAssetsMap = new Map();
  zoneAssetsData.assets.forEach(asset => {
    const canonicalId = `${asset.chain_name}/${asset.base_denom}`;
    allAssetsMap.set(canonicalId, asset);
  });

  // Filter to unverified assets only (or check all if you want)
  const assetsToCheck = zoneAssetsData.assets.filter(asset => !asset.osmosis_verified);

  console.log(`Found ${assetsToCheck.length} unverified assets to check`);

  // Fetch Numia data ONCE for all assets (fast - just 2 API calls)
  console.log('Fetching liquidity and pool data from Numia...');
  const numiaTokens = await fetchNumiaTokens();
  const numiaPairs = await fetchNumiaPairs();
  console.log(`Loaded ${numiaTokens.size} tokens and ${numiaPairs.length} pools`);

  // Build transmuter map using Numia pairs data (contract address = pool address)
  const alloyMembersMap = buildAlloyTransmuterMap(allAssetsMap, numiaPairs);

  // Run verification for each asset
  const results = [];
  for (const asset of assetsToCheck) {
    try {
      const result = await verifyAsset(asset, numiaTokens, numiaPairs, alloyMembersMap);
      results.push(result);
    } catch (error) {
      console.error(`Error verifying ${asset.chain_name}/${asset.base_denom}:`, error);
      results.push({
        chain_name: asset.chain_name,
        base_denom: asset.base_denom,
        error: error.message,
        allChecksPassed: false,
        readyForVerification: false
      });
    }
  }

  // Generate JSON report
  const jsonReport = generateJSONReport(results);

  // Save report to /generated/verification_reports/ directory
  const reportsDir = path.join(repoRoot, chainName, 'generated', 'verification_reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save latest report (overwrites previous)
  const latestJsonPath = path.join(reportsDir, 'verification_report_latest.json');
  fs.writeFileSync(latestJsonPath, jsonReport);

  console.log(`\nReport saved to ${reportsDir}`);
  console.log(`- verification_report_latest.json`);

  // NOTE: Automatic verification flag updates are disabled
  // The script only generates reports. Manual verification flag updates should be done via PR review.
  //
  // If you want to re-enable automatic updates, uncomment the code below:
  /*
  const readyForVerification = results.filter(r => r.readyForVerification);

  if (readyForVerification.length > 0) {
    console.log(`\n🔄 Updating verification flags for ${readyForVerification.length} assets...`);

    let assetsUpdated = 0;
    zoneAssetsData.assets.forEach(asset => {
      const matchingResult = readyForVerification.find(r =>
        r.chain_name === asset.chain_name && r.base_denom === asset.base_denom
      );

      if (matchingResult && !asset.osmosis_verified) {
        asset.osmosis_verified = true;
        assetsUpdated++;
        console.log(`  ✅ Verified: ${asset.chain_name}/${asset.base_denom} (${asset._comment || 'no symbol'})`);
      }
    });

    if (assetsUpdated > 0) {
      fs.writeFileSync(zoneAssetsPath, JSON.stringify(zoneAssetsData, null, 2) + '\n');
      console.log(`\n✅ Updated ${assetsUpdated} asset(s) to verified in ${zoneAssetsPath}`);
    }
  }
  */

  return results;
}

// CLI execution
const [, , chainName] = process.argv;
runVerificationReport(chainName || 'osmosis-1').catch(console.error);
