// Standalone regeneration from checked-in lists; no registry or network required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { encodeAssetList, decodeAssetList } from './compact_assetlist.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
for (const zone of ['osmosis-1', 'osmo-test-5']) {
  const dir = path.join(root, zone, 'generated/frontend');
  const source = JSON.parse(
    fs.readFileSync(path.join(dir, 'assetlist.json'), 'utf8'),
  );
  const compact = encodeAssetList(source);
  assert.deepEqual(decodeAssetList(compact), source);
  fs.writeFileSync(
    path.join(dir, 'assetlist.compact.json'),
    JSON.stringify(compact),
  );
  console.log(`${zone}: ${source.assets.length} assets (lossless)`);
}
