# Asset Lists

## Description

Inspired by Ethereum's [Token Lists](https://tokenlists.org/) project, Asset Lists aim to enhance the discoverability of Cosmos SDK denominations by associating them with metadata. While primarily used for assets transferred over IBC, this standard is still evolving. The `assets` format in the assetlist.json structure closely mirrors Cosmos SDK's [`banktypes.DenomMetadata`](https://docs.cosmos.network/v0.47/modules/bank#denommetadata), paving the way for potential migration into a Cosmos SDK module for on-chain maintenance in the future. Find the assetlist JSON Schema at the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry/blob/master/assetlist.schema.json).

## Prerequisite

The `.assetlist.json` files herein are generated, which will be triggered by additions to the corresponding `osmosis.zone_assets.json` file, fetching the metadata from the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry). The primary prerequisite to adding an asset here is complete registration of the asset and it's originating chain (and the IBC connection between the origin chain and Osmosis, if not native to Osmosis) to the Cosmos Chain Registry, so please make sure that's done first. We have [a guide](https://docs.osmosis.zone/overview/integrate/registration) on registering a Chain and Asset to the Cosmos Chain Registry.

## How to Add Assets

Please see the asset [listing requirements](https://github.com/osmosis-labs/assetlists/blob/main/LISTING.md) for information about displaying assets on Osmosis Zone.

To add an asset, add a new asset object to the very bottom of the _osmosis.zone_assets.json_ file, containing some identifying and key details:
- `base_denom` is the minimal/indivisible (i.e., exponent: 0) denomination unit for the asset, corresponding to its `base` at the Chain Registry.
- `chain_name` must be the exact value defined as `chain_name` in the chain's _chain.json_ file at the Chain Registry.
- `path` is required for all ics20 assets (i.e., assets that are transferred to Osmosis from another chain via IBC); the only exception are asset deployed directly on Osmosis (e.g., factory tokens). It is comprised of: the destination IBC port and channel for each IBC hop, followed by the base denom on the IBC-originating chain. The is used as input into the SHA256 hash function.
  - e.g., `"path": "transfer/channel-0/uatom"`
- `osmosis_verified` should always be set to `false` upon initial listing; this indicates whether the 'Unverified Assets' setting must be toggled to reveal the asset on Osmosis Zone. After meeting the requirements described in the listing requirements page, an additional PR may created to set it to `true`.

There are also some additional details that may be defined for an asset: 
- `transfer_methods` should be included whenever a basic IBC transfer initialatd via Osmosis Zone Deposit and Withdraw buttons is unable to carry-out an interchain transfer.
- `override_properties` may be defined for cases where Osmosis Zone shall display the asset differently than how registered on its source chain.
- `canonical` shall be defined for assets that are Osmosis' canonical representation of an asset different than its source (e.g., Axelar's WETH(.axl) is Osmosis' canonical representation of Ether $ETH on Osmosis)
- `categories` are best manually defined for an asset, including: "defi" and "meme".


## Zone Example

An example asset object in `osmosis.zone.json`:

```
{
  "base_denom": "uosmo",
  "chain_name": "osmosis",
  "osmosis_verified": true,
  "_comment": "Osmosis $OSMO"
},
...
{
  "base_denom": "ustk",
  "chain_name": "steakchain",
  "path": "transfer/channel-69/ustk",
  "osmosis_verified": true,
  "_comment": "Steak $STK"
},
{
  "base_denom": "ufoocoin",
  "chain_name": "fubarchain",
  "path": "transfer/channel-420/ufoocoin",
  "osmosis_verified": false
  "osmosis_unlisted": true,
  "_comment": "Foocoin $FOO"
}
```

## Dependencies

Note that there are apps, interfaces, and tools that look at this repository as a data dependency:
- Osmosis Zone app (app.osmosis.zone):
  - .../generated/frontend/assetlist.json
  - .../generated/frontend/chainlist.json (soon, not yet migrated to v2)
  - .../osmosis-1.chainlist.json
  - .../osmo-test-5.chainlist.json
- Osmosis Labs' Sidecar Query Service (SQS):
  - .../generated/frontend/assetlist.json
- Numia Data Services (e.g., API):
  - .../generated/frontend/assetlist.json
  - .../generated/chain-registry/assetlist.json
