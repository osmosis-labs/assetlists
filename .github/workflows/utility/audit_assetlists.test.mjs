import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('read-only audit reports all rows and respects the native-Osmosis codegen shortcut', () => {
  const script = fileURLToPath(
    new URL('./audit_assetlists.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [script, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, report.zones.some((z) => z.errors) ? 1 : 0);
  for (const zone of report.zones) {
    const list = JSON.parse(
      fs.readFileSync(
        new URL(
          `../../../${zone.zone}/generated/frontend/assetlist.json`,
          import.meta.url,
        ),
      ),
    );
    const nativeChainName =
      zone.zone === 'osmosis-1' ? 'osmosis' : 'osmosistestnet';
    assert.equal(zone.assets, list.assets.length);
    const nativeDenoms = new Set(
      list.assets
        .filter((a) => a.chainName === nativeChainName)
        .map((a) => a.coinMinimalDenom),
    );
    for (const issue of zone.issues.filter(
      (i) => i.code === 'legacy_frontend_skips_asset',
    )) {
      assert.equal(
        nativeDenoms.has(issue.denom),
        false,
        'native Osmosis shortcut already retains these tokens',
      );
    }
    assert.equal(
      zone.issues.filter((i) => i.severity === 'error').length,
      zone.errors,
    );
    assert.equal(
      zone.issues.filter((i) => i.severity === 'warning').length,
      zone.warnings,
    );
  }
});
