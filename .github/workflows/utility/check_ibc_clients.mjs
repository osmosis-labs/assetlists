// Purpose:
//   Check IBC client health for all IBC assets in the generated frontend
//   assetlist. Automatically sets/clears osmosis_unstable in zone_assets.json,
//   adding new minimal entries for assets not yet present and removing them
//   when they recover.
//
// Usage:
//   node check_ibc_clients.mjs <zone_name>
//   Example: node check_ibc_clients.mjs osmosis-1

import * as fs from 'fs';
import * as path from 'path';

const LCD = "https://lcd.osmosis.zone";
const CONCURRENCY = 5;
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 3;

const zoneBasePath = process.argv[2] || 'osmosis-1';
const zonePath = path.join('..', '..', '..', zoneBasePath);
const filePrefix = zoneBasePath.split('-')[0];
const zoneAssetsPath = path.join(zonePath, `${filePrefix}.zone_assets.json`);
const frontendPath = path.join(zonePath, 'generated', 'frontend', 'assetlist.json');

// Fields that constitute a "thin" auto-added entry (safe to remove entirely
// when the client recovers, since there's nothing else of value in the entry)
const THIN_FIELDS = new Set(['chain_name', 'base_denom', 'path', 'osmosis_unstable', '_comment']);

function isThinEntry(asset) {
  return Object.keys(asset).every(k => THIN_FIELDS.has(k));
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(500);
  }
  return results;
}

// ── IBC client lookup ─────────────────────────────────────────────────────────

async function getClientStatusForChannel(channelId) {
  const channelData = await fetchJSON(
    `${LCD}/ibc/core/channel/v1/channels/${channelId}/ports/transfer`
  );
  const connectionId = channelData.channel?.connection_hops?.[0];
  if (!connectionId) throw new Error(`No connection for ${channelId}`);

  const connData = await fetchJSON(
    `${LCD}/ibc/core/connection/v1/connections/${connectionId}`
  );
  const clientId = connData.connection?.client_id;
  if (!clientId) throw new Error(`No client for ${connectionId}`);

  const statusData = await fetchJSON(
    `${LCD}/ibc/core/client/v1/client_status/${clientId}`
  );
  return { channelId, connectionId, clientId, status: statusData.status };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load zone_assets.json
  let zoneData;
  try {
    zoneData = JSON.parse(fs.readFileSync(zoneAssetsPath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${zoneAssetsPath}: ${err.message}`);
    process.exit(1);
  }

  // Load generated frontend assetlist as the source of truth for IBC assets
  let frontendData;
  try {
    frontendData = JSON.parse(fs.readFileSync(frontendPath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${frontendPath}: ${err.message}`);
    process.exit(1);
  }

  // Build a lookup of zone_assets entries by path for fast matching
  const zoneByPath = new Map();
  for (const asset of zoneData.assets) {
    if (asset.path) zoneByPath.set(asset.path, asset);
  }

  // Collect IBC assets from the frontend assetlist
  const ibcAssets = [];
  for (const asset of frontendData.assets ?? []) {
    const ibcMethod = asset.transferMethods?.find(m => m.type === 'ibc');
    if (!ibcMethod?.chain?.channelId || !ibcMethod?.chain?.path) continue;

    ibcAssets.push({
      chainName:   asset.chainName,
      sourceDenom: asset.sourceDenom,
      symbol:      asset.symbol,
      channelId:   ibcMethod.chain.channelId,
      ibcPath:     ibcMethod.chain.path,
    });
  }

  // Deduplicate by channel
  const channelToAssets = new Map();
  for (const a of ibcAssets) {
    if (!channelToAssets.has(a.channelId)) channelToAssets.set(a.channelId, []);
    channelToAssets.get(a.channelId).push(a);
  }

  const uniqueChannels = [...channelToAssets.keys()];
  console.log(`Checking IBC client status for ${uniqueChannels.length} unique channels (${ibcAssets.length} IBC assets in frontend)...\n`);

  // Query LCD in batches
  const results = await processInBatches(
    uniqueChannels,
    CONCURRENCY,
    async (channelId) => {
      try {
        const result = await getClientStatusForChannel(channelId);
        return { channelId, ...result, error: null };
      } catch (err) {
        return { channelId, status: 'error', error: err.message };
      }
    }
  );

  const stats = { active: 0, flagged: 0, cleared: 0, removed: 0, alreadyFlagged: 0, errors: 0 };
  const newlyFlagged  = [];
  const newlyCleared  = [];
  const newlyRemoved  = [];
  const errorChannels = [];

  for (const result of results) {
    const channelAssets = channelToAssets.get(result.channelId);

    if (result.error) {
      stats.errors++;
      errorChannels.push({ channelId: result.channelId, error: result.error });
      continue; // leave flags unchanged on error
    }

    const isProblematic = result.status !== 'Active';

    for (const fa of channelAssets) {
      const zoneAsset = zoneByPath.get(fa.ibcPath);

      if (isProblematic) {
        if (zoneAsset) {
          if (zoneAsset.osmosis_unstable === true) {
            stats.alreadyFlagged++;
          } else {
            zoneAsset.osmosis_unstable = true;
            stats.flagged++;
            newlyFlagged.push({ ...fa, status: result.status, clientId: result.clientId });
          }
        } else {
          // Asset not in zone_assets yet — add a minimal entry
          const newEntry = {
            chain_name: fa.chainName,
            base_denom: fa.sourceDenom,
            path:       fa.ibcPath,
            osmosis_unstable: true,
            _comment:   `${fa.symbol} $${fa.symbol}`,
          };
          zoneData.assets.push(newEntry);
          zoneByPath.set(fa.ibcPath, newEntry);
          stats.flagged++;
          newlyFlagged.push({ ...fa, status: result.status, clientId: result.clientId, added: true });
        }
      } else {
        // Active — clear or remove
        stats.active++;
        if (zoneAsset?.osmosis_unstable === true) {
          if (isThinEntry(zoneAsset)) {
            // Auto-added entry with nothing else of value — remove it entirely
            zoneData.assets = zoneData.assets.filter(a => a !== zoneAsset);
            zoneByPath.delete(fa.ibcPath);
            stats.removed++;
            newlyRemoved.push({ ...fa, clientId: result.clientId });
          } else {
            // Manually curated entry — just clear the flag
            delete zoneAsset.osmosis_unstable;
            stats.cleared++;
            newlyCleared.push({ ...fa, clientId: result.clientId });
          }
        }
      }
    }
  }

  // Write back only if something changed
  if (stats.flagged > 0 || stats.cleared > 0 || stats.removed > 0) {
    fs.writeFileSync(zoneAssetsPath, JSON.stringify(zoneData, null, 2) + '\n', 'utf8');
    console.log(`✓ Updated ${zoneAssetsPath}`);
  } else {
    console.log('No changes needed.');
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  IBC CLIENT HEALTH SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Channels checked   : ${uniqueChannels.length}`);
  console.log(`  Active assets      : ${stats.active}`);
  console.log(`  Already flagged    : ${stats.alreadyFlagged}`);
  console.log(`  Newly flagged      : ${stats.flagged}`);
  console.log(`  Flag cleared       : ${stats.cleared}`);
  console.log(`  Entry removed      : ${stats.removed}`);
  console.log(`  Errors             : ${stats.errors}`);
  console.log('='.repeat(70));

  if (newlyFlagged.length > 0) {
    console.log('\n🔴 NEWLY FLAGGED unstable (expired/frozen client):');
    for (const a of newlyFlagged) {
      const marker = a.added ? ' [new entry]' : '';
      console.log(`  ${a.symbol.padEnd(20)} ${a.ibcPath.padEnd(45)} status=${a.status}  client=${a.clientId ?? '?'}${marker}`);
    }
  }

  if (newlyCleared.length > 0) {
    console.log('\n🟢 FLAG CLEARED (client active, entry kept):');
    for (const a of newlyCleared) {
      console.log(`  ${a.symbol.padEnd(20)} ${a.ibcPath.padEnd(45)} client=${a.clientId ?? '?'}`);
    }
  }

  if (newlyRemoved.length > 0) {
    console.log('\n🗑️  ENTRY REMOVED (client active, thin entry):');
    for (const a of newlyRemoved) {
      console.log(`  ${a.symbol.padEnd(20)} ${a.ibcPath.padEnd(45)} client=${a.clientId ?? '?'}`);
    }
  }

  if (errorChannels.length > 0) {
    console.log('\n⚪ ERRORS (flags unchanged):');
    for (const { channelId, error } of errorChannels) {
      console.log(`  ${channelId.padEnd(16)} ${error}`);
    }
  }

  // Machine-readable summary for the workflow
  console.log(`\nIBC_NEWLY_FLAGGED=${stats.flagged}`);
  console.log(`IBC_NEWLY_CLEARED=${stats.cleared + stats.removed}`);
  console.log(`IBC_ERRORS=${stats.errors}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
