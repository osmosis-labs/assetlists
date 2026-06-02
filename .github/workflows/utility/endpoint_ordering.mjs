/*
 * Pure endpoint-ordering helpers used by chainlist generation.
 *
 * These are kept dependency-free (no chain-registry, no filesystem) so they can
 * be unit-tested directly without triggering generation side effects. See
 * endpoint_ordering.test.mjs.
 *
 * Background (MTN-101): the validator records, per chain, which endpoints passed
 * connectivity and which failed and why. The generator uses that record to
 * (1) sink recorded-dead endpoints to the bottom of the published list and
 * (2) promote the validated working endpoint to first position. Both operations
 * key on the endpoint ADDRESS rather than a Chain Registry index, so they are
 * immune to the order mismatch between the validator's tested order and the
 * generator's published order.
 */

// Error types the validator records for an endpoint that failed connectivity.
// Endpoints carrying one of these are pushed to the bottom of the published list.
export const DEAD_ENDPOINT_ERROR_TYPES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'HTTP_ERROR']);

/**
 * Build the set of endpoint addresses (of a given type) that the validator
 * recorded as failing connectivity in this chain's last validation run.
 *
 * An endpoint is "dead" if its connectivity test did not pass AND at least one
 * of its test results carries a connectivity error type. We deliberately key on
 * the recorded error type rather than connectivityPassed alone, so that a
 * CORS-only failure (connectivity OK, CORS not enabled) is NOT treated as dead.
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
    const hasConnectivityError = (ep.testResults || []).some(
      r => r.errorType && DEAD_ENDPOINT_ERROR_TYPES.has(r.errorType)
    );
    if (hasConnectivityError && ep.address) {
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
 * working address to first position. Mirrors the logic inlined in
 * generate_chainlist.mjs and is the unit under regression test.
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
