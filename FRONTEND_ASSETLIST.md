# Frontend asset-list audit and compact embedding

## What the frontend actually consumes

Consumer reviewed: `../osmosis-frontend/packages/web/config/generate-lists.ts`, the asset/chain types, config utilities, wallet conversion, and server asset queries.

The frontend already consumes `generated/frontend/assetlist.json`, not the much larger Chain Registry or asset-detail lists. It adds local logo paths, groups assets by wallet chain, emits symbol/variant types and embeds the resulting `AssetLists` in client and server code. The full generated metadata is close to its runtime `Asset` interface.

Default visibility is **not** a safe criterion for removing rows:

- Unverified assets can be opted into.
- Preview assets are explicitly looked up for balances and other queries.
- Halted/stranded assets still need balance recognition and withdrawal/incident UI.
- Variant relationships, pool assets, token identities and transfer metadata need to remain intact.

This change therefore preserves all rows and fields. A genuinely smaller token subset would need a separate product policy and a tested fallback for omitted balances, variants and pool denoms; it is not inferred from `verified`, `preview` or transfer-health flags.

## Audit results

Snapshots reviewed: assetlists `48445c0e`, frontend `7fcd4608f`; pinned Chain Registry `c9d65b60bc0229c06d49ded805ba528f316bd9c7`. The detailed, reproducible findings are in [audits/frontend-assetlist.md](audits/frontend-assetlist.md).

- Mainnet: **1,348 assets**, 968 configured pointers; **2 integrity errors**, 33 warnings.
- Testnet: **159 assets**, 24 configured pointers; **2 integrity errors**, 16 warnings.
- No duplicate Osmosis denoms, dangling variant references, missing required display fields, invalid decimals, IBC path/hash mismatches, registered-channel mismatches, or configured flag/reason/tooltip drift found.
- Every generated source pointer exists in the pinned registry; the testnet Nomic route has no registry IBC file and needs its custom override reviewed.
- Four IBC assets reference display-only chain entries with no wallet chain ID: mainnet **G24 / blg24**, **MUC / mucoin**, testnet **BLD and IST / agoricdevnet**.
  - The pinned registry has IDs, endpoints and fees for these chains but lacks transaction-explorer URL templates. `getSuggestionChainProperties` requires an explorer and consequently falls back to a display-only entry. Do not invent explorer URLs. Add verified source overrides or separately review whether that gate should be optional.
  - Frontend codegen previously grouped these tokens under an empty chain ID. It now keeps them in the Osmosis group and emits a warning; this preserves recognition without inventing a working IBC wallet configuration. Their bridge configuration remains unresolved.
- Mainnet has **9 case-insensitive symbol collisions** (one is an exact collision), and **24 missing logos**; testnet has **5 missing logos**. Symbol lookup and lowercase local logo filenames make these worth reviewing; this change does not rename or deduplicate tokens.
- Ten testnet assets originate from registry-killed chains without transfer halts. Review lifecycle coverage on testnet rather than assuming their routes are usable.

The audit deliberately exits **1** while the four wallet-chain errors remain. Compact-format tests pass independently; a lossless representation must preserve existing data, not silently repair financial metadata. No source flags, endpoints, verification status, names or denoms were changed.

**Scope limit:** registration and structural consistency were checked, not live availability. Existing endpoint, IBC-client, market-health and verification utilities remain necessary to establish current bridge/market health. Logo URLs were checked syntactically, not downloaded by the audit.

## Compact v1 contract

`generated/frontend/assetlist.compact.json` is generated alongside the unchanged public object list. SQS, Numia, runtime bridge queries and other consumers retain their existing file paths.

```json
{
  "format": "osmosis-assetlist-v1",
  "chainName": "osmosis",
  "fields": ["coinMinimalDenom", "symbol", "verified"],
  "defaults": {"verified": false},
  "rows": [["uosmo", "OSMO", true], ["example", "EXAMPLE"]]
}
```

- Columns travel with the file; order is deterministic, with sparse columns last.
- A cell of `null`, or an omitted trailing cell, means the default value if defined, otherwise an absent property.
- Defaults are only the known empty arrays and false flags, and only used when every input row contains that property. This preserves absent optional fields exactly.
- Explicit top-level null/undefined values are rejected instead of silently losing them. The generator normalizes its Date/undefined values through JSON before encoding. Nested metadata, including nested nulls, is untouched.
- Unknown asset fields survive encoding/decoding. Unknown format versions, duplicate/unsafe columns, unsupported defaults and oversized rows fail closed.
- Default arrays are recreated per asset, never shared.
- A publication-time equality assertion and CI tests compare every decoded asset against the original, including order, halts, reasons, tooltips, dates and transfer methods.

The producer codec is `.github/workflows/utility/compact_assetlist.mjs`; the matching frontend codec is `packages/web/config/compact-asset-list.ts`. Keep the v1 contract in sync; an incompatible change needs a new format version. Cross-repository compatibility was verified against both complete generated snapshots.

## Frontend integration

- Codegen fetches the compact file at the same pinned/latest commit as the chainlist.
- A **404 only** falls back to `assetlist.json` at that exact same commit. This supports historical pins and producer-first rollout. Rate limits, network errors and malformed compact files do not trigger fallback.
- Codegen still derives local image paths, groups assets and emits existing symbol/variant types.
- It embeds a compact table plus group counts, rather than expanding the fetched table back into full object literals in the bundle.
- `decodeAssetLists` restores the existing `AssetList[]` API once at module initialization. Existing imports, queries and stores remain unchanged. No new runtime data fetch is required.
- Grouping locates Osmosis by chain ID, not by assuming the first chain entry. Non-Cosmos origins cannot accidentally become invalid Cosmos wallet groups. Display-only chain entries are excluded from generated chain-ID types.

## Measurements and trade-offs

Bytes measured from the checked-in snapshots (gzip using Node's default settings):

| Mainnet representation | Raw bytes | gzip bytes |
|---|---:|---:|
| Original pretty JSON | 2,573,962 | 227,330 |
| Original minified JSON | 1,890,024 | 202,071 |
| Compact wire JSON | 1,522,346 | 198,083 |
| Frontend grouped objects, with image paths (minified) | 1,970,547 | 197,351 |
| Frontend compact embedding (minified) | 1,574,496 | 194,190 |

The wire file is **41% smaller than pretty JSON**, but only **19.5% smaller than minified JSON / 2% smaller gzipped**. Actual grouped embedding is **20.1% smaller raw / 1.6% smaller gzipped**. Testnet embedding is 226,345 → 185,808 raw bytes, 19,968 → 19,675 gzip bytes.

Repeated keys compress well already. This is principally an uncompressed source/embedding reduction, **not** a large compressed-network saving. The decoder adds a small initialization step and reconstructs the same runtime objects, so retained asset-object memory is not reduced. Full production Next bundle size/startup performance has not been benchmarked. Existing chainlist size and logo downloads are unchanged.

## Verification and rollout

Verified locally:

- Producer unit tests and full mainnet/testnet lossless artifact checks.
- Frontend codec, grouping and pinned-fallback unit tests.
- Actual codegen against both complete local snapshots, with image downloads disabled; all assets, fields and local image paths preserved. Historical 404 fallback was also exercised through actual codegen.
- Frontend typecheck against regenerated mainnet and testnet output.

Publish assetlists first, then the frontend changes. Daily and standalone asset generation publish both representations; deployment monitors include the compact file. No source-list migration is required.

```sh
node .github/workflows/utility/generate_compact_assetlist.mjs
node --test .github/workflows/utility/compact_assetlist.test.mjs
node .github/workflows/utility/audit_assetlists.mjs
```

In `../osmosis-frontend/packages/web` (after dependencies are installed):

```sh
../../node_modules/.bin/jest --runInBand \
  config/__tests__/compact-asset-list.spec.ts \
  config/__tests__/asset-chain.spec.ts \
  config/__tests__/load-asset-list.spec.ts
../../node_modules/.bin/tsc --noEmit -p tsconfig.typecheck.json
```

Before production rollout, preview-test search, portfolio balances, variant grouping, asset incident banners, IBC/external bridges, alloy conversions, mainnet/testnet, and chain-ID overrides. Confirm the four unresolved chain entries do not present a functional native bridge merely because their tokens remain recognizable.

Rollback: revert the frontend codegen integration and regenerate from the unchanged full object lists, or pin an earlier frontend deployment. Older assetlist pins also work through the 404 fallback. Keeping both public formats avoids a coordinated rollback with SQS/Numia.
