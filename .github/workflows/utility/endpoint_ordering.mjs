/*
 * Pure endpoint-ordering helpers used by chainlist generation.
 *
 * These are kept dependency-free (no chain-registry, no filesystem) so the
 * ordering logic is isolated from generation side effects and easy to reason
 * about in one place.
 *
 * Background: the validator records, per chain, which endpoints passed
 * connectivity and which failed and why. The generator uses that record to
 * (1) sink recorded-dead endpoints to the bottom of the published list and
 * (2) promote the validated working endpoint to first position. Both operations
 * key on the endpoint ADDRESS rather than a Chain Registry index, so they are
 * immune to the order mismatch between the validator's tested order and the
 * generator's published order.
 *
 * Demotion treats both connectivity failures and recorded-stale endpoints as
 * dead (see getDeadEndpointAddresses). Two boundaries remain, driven by what the
 * validator records:
 *  - REST STALENESS IS NOT DETECTED. The validator only flags staleness on the
 *    RPC /status result (latest_block_time too old); REST has no tip-freshness
 *    check, so a reachable-but-stale REST endpoint is not marked stale and so
 *    not demoted. Closing this needs a validator-side REST freshness probe.
 *  - ONLY ENDPOINTS UP TO THE WINNER ARE RECORDED. The validator stops testing
 *    at the first endpoint that passes, so allTestedEndpoints lists only the
 *    endpoints tried before (and including) the winner. Endpoints that sort
 *    after the winner are never recorded and therefore never demoted. This is
 *    sufficient for the common case (dead zone pin tested first, healthy
 *    backup wins) and is deliberate: probing every endpoint would multiply the
 *    validator's runtime and the CI latency of generation.
 */

// Error types the validator records for an endpoint that failed connectivity.
// Endpoints carrying one of these are pushed to the bottom of the published list.
export const DEAD_ENDPOINT_ERROR_TYPES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'HTTP_ERROR']);

/**
 * Build the set of endpoint addresses (of a given type) that the validator
 * recorded as failing connectivity in this chain's last validation run.
 *
 * An endpoint is "dead" if its connectivity test did not pass AND either:
 *   - at least one test result carries a connectivity error type, OR
 *   - at least one test result is flagged stale (reachable but chain tip too old;
 *     the validator marks RPC /status results stale when latest_block_time is
 *     more than an hour behind, and already rejects stale endpoints during
 *     selection via `success && !stale`).
 * We deliberately key on the recorded error type / stale flag rather than
 * connectivityPassed alone, so that a CORS-only failure (connectivity OK, CORS
 * not enabled) is NOT treated as dead.
 *
 * @param {Object} validationRecord - per-chain record from state.json
 * @param {string} nodeType - 'rpc' or 'rest'
 * @returns {Set<string>} addresses recorded as dead for that node type
 */
export function getDeadEndpointAddresses(validationRecord, nodeType) {
  const dead = new Set();
  const tested = validationRecord?.allTestedEndpoints || [];
  for (const ep of tested) {
    if (ep.type !== nodeType) continue;
    if (ep.connectivityPassed) continue;
    const results = ep.testResults || [];
    const hasConnectivityError = results.some(
      r => r.errorType && DEAD_ENDPOINT_ERROR_TYPES.has(r.errorType)
    );
    const isStale = results.some(r => r.stale === true);
    if ((hasConnectivityError || isStale) && ep.address) {
      dead.add(ep.address);
    }
  }
  return dead;
}

/**
 * Stable-partition an ordered address list so that endpoints the validator
 * recorded as dead sink to the bottom, preserving relative order within the
 * healthy and dead groups. Never removes anything (the frontend keeps dead
 * entries as last-resort fallbacks).
 *
 * ALL-FAIL GUARD: if every endpoint is recorded dead, the original order is
 * returned unchanged so we don't churn the list when there is nothing healthy
 * to promote above the failures.
 *
 * @param {string[]} addresses - ordered endpoint addresses
 * @param {Set<string>} deadAddresses - addresses recorded as dead
 * @returns {{ ordered: string[], deprioritizedCount: number }}
 */
export function deprioritizeDeadEndpoints(addresses, deadAddresses) {
  if (!deadAddresses || deadAddresses.size === 0) {
    return { ordered: addresses, deprioritizedCount: 0 };
  }
  const healthy = addresses.filter(a => !deadAddresses.has(a));
  const dead = addresses.filter(a => deadAddresses.has(a));
  // All-fail guard: nothing healthy to float above the dead ones.
  if (healthy.length === 0) {
    return { ordered: addresses, deprioritizedCount: 0 };
  }
  return { ordered: [...healthy, ...dead], deprioritizedCount: dead.length };
}

/**
 * Apply validation-driven reordering to a single node type's endpoint list:
 * first deprioritize recorded-dead endpoints, then promote the validated
 * working address to first position. This is the single entry point used by
 * generate_chainlist.mjs.
 *
 * @param {string[]} addresses - ordered endpoint addresses (zone pin first, then sorted registry)
 * @param {Object} validationRecord - per-chain record from state.json
 * @param {string} nodeType - 'rpc' or 'rest'
 * @param {string|null} validatedAddress - the validated working address for this node type
 * @returns {{ ordered: string[], deprioritizedCount: number, promoted: boolean }}
 */
export function applyValidationOrdering(addresses, validationRecord, nodeType, validatedAddress) {
  const dead = getDeadEndpointAddresses(validationRecord, nodeType);
  const { ordered, deprioritizedCount } = deprioritizeDeadEndpoints(addresses, dead);
  let result = ordered;
  let promoted = false;
  if (validatedAddress && result.includes(validatedAddress) && result[0] !== validatedAddress) {
    result = result.filter(a => a !== validatedAddress);
    result.unshift(validatedAddress);
    promoted = true;
  }
  return { ordered: result, deprioritizedCount, promoted };
}
