# Asset Lists

## Description

Asset Lists are inpsired by the [Token Lists](https://tokenlists.org/) project on Ethereum, which helps discoverability of ERC20 tokens by mapping ERC20 contracts to their associated metadata. Asset Lists offer a similar mechanism to allow frontends and other UIs to fetch metadata associated with Cosmos SDK denominations, especially for assets sent over IBC, although, this standard is a work in progress. You'll notice that the format of `assets` in the assetlist.json structure is a strict superset json representation of the [`banktypes.DenomMetadata`](https://docs.cosmos.network/v0.47/modules/bank#denommetadata) from the Cosmos SDK; this is purposefully done so that this standard may eventually be migrated into a Cosmos SDK module in the future, so it can be easily maintained on chain instead of on GitHub. The assetlist JSON Schema can be found at the Chain Registry [here](https://github.com/cosmos/chain-registry/blob/master/assetlist.schema.json).

## Prerequisite

The `.assetlist.json` files herein are generated, which will be triggered by additions to the corresponding `osmosis.zone_assets.json` file, fetching the metadata from the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry). The primary prerequisite to adding an asset here is complete registration of the asset and it's originating chain (and the IBC connection between the origin chain and Osmosis, if not native to Osmosis) to the Cosmos Chain Registry, so please make sure that's done first. We have [a guide](https://docs.osmosis.zone/overview/integrate/registration) on registering a Chain and Asset to the Cosmos Chain Registry.

## How to Add Assets

Please see the asset [listing requirements](https://github.com/osmosis-labs/assetlists/blob/main/LISTING.md) to display assets on Osmosis Zone web app. 

To add an asset, add a new asset object to the very bottom of the _osmosis.zone_assets.json_ file, containing the asset's base denom and chain name.
- `base_denom` is the indivisible, minimial (exponent 0) denomination unit for the asset, which is also the value defined as `base` for the asset in the Chain Registry.
- `chain_name` must be the exact value defined as `chain_name` for the chain in the Chain Registry--it is also the name of the chain's directory in the Chain Registry.
- `path` is required for all ics20 assets (assets that have been transferred from another chain to Osmosis via IBC), which includes the vast majority of tokens except for those deployed directly on Osmosis. It requires: the IBC port; the IBC channel; and the base denomination representation that is used as input for the IBC denomination hash function (which is usually just the base denom of the asset on the origin chain (e.g., uatom), but sometimes can be different)
  - e.g., `"path": "transfer/channel-8008135/ucoin"`
- In the Pull Request, be sure to add in the description, or leave a comment, of the pool_id of the liquidity pool(s)
- You may also notice some booleans:
  - `osmosis_verified` should always either be omitted or set to `false` unless modified by, or explicitly instructed otherwise by, Osmosis Labs. This indicates whether the 'Unverified Assets setting must be toggled to reveal the asset by default on various Osmosis Zone app pages (Swap, Assets, Pools).
  - `osmosis_unlisted` should always be included and set to `true`(, meaning it will NOT show up on Osmosis Zone app,) until after the asset's respresntation, transfer experience, and explorer URL to the transaction hash have all been validated by Osmosis Labs, at which point it can be set to `false` (or, preferrably, removed).

## Zone Example

An example asset object in `osmosis.zone.json`:

```
{
  "base_denom": "uosmo",
  "chain_name": "osmosis",
  "osmosis_verified": true
},
...
{
  "base_denom": "ustk",
  "chain_name": "steakchain",
  "path": "transfer/channel-69/ustk",
  "osmosis_verified": true
},
{
  "base_denom": "ufoocoin",
  "chain_name": "fubarchain",
  "path": "transfer/channel-420/ufoocoin",
  "osmosis_unlisted": true
}
```
