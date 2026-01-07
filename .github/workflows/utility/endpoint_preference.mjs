/*
 * Shared Provider Preference Logic
 * Used by both validation and chainlist generation to prioritize reliable endpoints
 */

/**
 * Preferred Providers List
 *
 * These providers are prioritized after team endpoints but before all others.
 * Providers within this list are tested in their original Chain Registry order.
 *
 * To add a new preferred provider, add their identifier (as returned by
 * getProviderFromEndpoint) to this array.
 */
const PREFERRED_PROVIDERS = [
  'keplr'
];

/**
 * Extract provider info from endpoint URL or metadata
 * Detects 27+ known providers by URL patterns
 */
export function getProviderFromEndpoint(endpoint) {
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
}

/**
 * Check if endpoint is from the chain's official team
 */
export function isTeamEndpoint(endpoint, chainName) {
  const address = endpoint.address || endpoint;
  const chainLower = chainName.toLowerCase();

  try {
    const url = new URL(address);
    const hostname = url.hostname.toLowerCase();

    const hostParts = hostname.split('.');

    // Get the primary domain (second-to-last part before TLD)
    if (hostParts.length >= 2) {
      const primaryDomain = hostParts[hostParts.length - 2];

      // Check if primary domain matches chain name exactly or is chain-specific
      if (primaryDomain === chainLower) {
        return true;
      }

      // Domain contains chain name: gopanacea contains panacea
      if (primaryDomain.includes(chainLower)) {
        return true;
      }
    }

    // Check provider metadata for foundation indicators
    if (endpoint.provider) {
      const providerLower = endpoint.provider.toLowerCase();
      if (providerLower.includes('foundation')) {
        return true;
      }
      // Check if provider name matches chain name (e.g., "medibloc" for panacea)
      // This catches official team providers even if domain doesn't match
      if (providerLower === chainLower) {
        return true;
      }
    }
  } catch (e) {
    // Invalid URL
  }

  return false;
}

/**
 * Check if provider is in the preferred list
 * Preferred providers are defined in PREFERRED_PROVIDERS array above
 */
export function isPreferredProvider(endpoint, chainName) {
  const provider = getProviderFromEndpoint(endpoint);

  // Check if provider is in the preferred list
  return PREFERRED_PROVIDERS.includes(provider);
}

/**
 * Sort endpoints by provider preference
 *
 * Priority order:
 *   1. Team endpoints
 *   2. Preferred providers (defined in PREFERRED_PROVIDERS)
 *   3. All other providers
 *
 * Within each priority level, endpoints maintain their original Chain Registry order.
 * This means if multiple preferred providers exist, they're tested in the order they
 * appear in the Chain Registry, not the order they appear in PREFERRED_PROVIDERS.
 */
export function sortEndpointsByProvider(endpoints, chainName) {
  return endpoints.sort((a, b) => {
    const aIsTeam = isTeamEndpoint(a, chainName);
    const bIsTeam = isTeamEndpoint(b, chainName);
    const aIsPreferred = isPreferredProvider(a, chainName);
    const bIsPreferred = isPreferredProvider(b, chainName);

    // Team endpoints come first
    if (aIsTeam && !bIsTeam) return -1;
    if (!aIsTeam && bIsTeam) return 1;

    // Then preferred providers
    if (aIsPreferred && !bIsPreferred) return -1;
    if (!aIsPreferred && bIsPreferred) return 1;

    // Keep original order for same preference level
    return 0;
  });
}
