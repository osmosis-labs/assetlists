# Asset Lists

## Description

Asset Lists are inpsired by the [Token Lists](https://tokenlists.org/) project on Ethereum, which helps discoverability of ERC20 tokens by mapping ERC20 contracts to their associated metadata. Asset Lists offer a similar mechanism to allow frontends and other UIs to fetch metadata associated with Cosmos SDK denominations, especially for assets sent over IBC, although, this standard is a work in progress. You'll notice that the format of `assets` in the assetlist.json structure is a strict superset json representation of the [`banktypes.DenomMetadata`](https://docs.cosmos.network/v0.47/modules/bank#denommetadata) from the Cosmos SDK; this is purposefully done so that this standard may eventually be migrated into a Cosmos SDK module in the future, so it can be easily maintained on chain instead of on GitHub. The assetlist JSON Schema can be found at the Chain Registry [here](https://github.com/cosmos/chain-registry/blob/master/assetlist.schema.json).

## Prerequisite

The `.assetlist.json` files herein are generated, which will be triggered by additions to the corresponding `osmosis.zone.schema` file, fetching the metadata from the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry). One prerequisite to adding an asset here is complete registration of the asset and it's originating chain (and the ibc connection between the chain and Osmosis) to the Cosmos Chain Registry, so make sure that's done first.

## How to Add Assets

To add an asset, add a new asset object to the very bottom of the _osmosis.zone.schema_ file, containing the asset's base denom and chain name.
- `base_denom` is the indivisible, minimial (exponent 0) denomination unit for the asset, which is also the value defined as `base` for the asset in the Chain Registry.
- `chain_name` must be the exact value defined as `chain_name` for the chain in the Chain Registry--it is also the name of the chain's directory in the Chain Registry. 
- Be sure to also provide the pool_id of the liquidity pools containing the asset for each of the following pair assets, where it exists: OSMO, ATOM, USDC.axl, JUNO, SCRT, STARS. E.g.:
```
"pools": {
  "OSMO": 123,
  "ATOM": 124,
  "USDC.axl": 126
}
```
(If needed, and upon request, Osmosis may be able to provide a staging link with the new token added so you can deposit some onto Osmosis and create pools for it using a frontend UI.)
- You may also notice some booleans: 
  - `osmosis_frontier` requires that a pool ID be defined. It is used to keep track of which tokens appear on Osmosis Frontier.
  - `osmosis_main` requires that 'osmosis-frontier' be `true`, and also requires either: Osmosis governance to approve that the token be shown on app.osmosis.zone (Main site), or that the token is incentivized by Osmosis--which is also approved by Osmosis governance(, unless its high market cap ranks it a top 100 asset). It is used to keep track of which tokens appear on Osmosis Main.
  - `osmosis_info` requires that 'osmosis-frontier' be `true`, and that >=$1,000 USD-worth of total liquidity of the asset be in the defined pools. It is used to filter which assets will appear on the [Osmosis Info](https://info.osmosis.zone/) site and be queryable by the API.

## Zone Example

An example asset object in `osmosis.zone.json`:

```
...
{
  "base_denom": "ustk",
  "chain_name": "steakchain",
  "pools": {
    "OSMO": 121,
    "ATOM": 122
  },
  "osmosis_frontier": true,
  "osmosis_info": true,
  "osmosis_main": true,
},
{
  "base_denom": "ufoocoin",
  "chain_name": "fubarchain",
  "pools": {
    "OSMO": 123,
    "ATOM": 124
  },
  "osmosis_frontier": true,
  "osmosis_info": true,
  "osmosis_main": false
}
```

## Assetlist Example

An example generated assetlist JSON file:

```
{
  "chain_name": "osmosis",
  "assets": [
    {
      "description": "The native token of Steak Chain",
      "denom_units": [
        {
          "denom": "ibc/1BE2B34B......8F7A8B8C",
          "exponent": 0,
          "aliases": [
            "ustk"
          ]
        },
        {
          "denom": "steak",
          "exponent": 6
        }
      ],
      "base": "ibc/1BE2B34B......8F7A8B8C",
      "display": "steak",
      "symbol": "STK",
      "traces": [
        {
          "type": "ibc",
          "counterparty": {
            "chain_name": "steakchain",
            "base_denom": "ustk"
            "channel_id": "channel-45"
          },
          "chain": {
            "channel-id": "channel-244"
          }
        }
      ],
      "logo_URIs": {
        "png": "https://raw.githubusercontent.com/cosmos/chain-registry/master/steakchain/images/stk.png",
        "svg": "https://raw.githubusercontent.com/cosmos/chain-registry/master/steakchain/images/stk.svg"
      },
      "keywords": [
        "osmosis-main",
        "osmosis-frontier",
        "osmosis-info",
        "OSMO:121",
        "ATOM:122"
      ]
    },
    {
      "description": "Foocoin is the native token of the Foochain",
      "denom_units": [
        {
          "denom": "ibc/6ED71011F...7E59D40A7B3E",
          "exponent": 0,
          "aliases": ["ufoocoin"]
        },
        {
          "denom": "foocoin",
          "exponent": 6
        }
      ],
      "base": "ibc/6ED71011F...7E59D40A7B3E",
      "display": "foocoin",
      "symbol": "FOO",
      "traces": [
        {
          "type": "ibc",
          "counterparty": {
            "chain_name": "fubarchain",
            "base_denom": "ufoocoin"
            "channel_id": "channel-14"
          },
          "chain": {
            "channel-id": "channel-201"
          }
        }
      ],
      "logo_URIs": {
        "png": "https://raw.githubusercontent.com/cosmos/chain-registry/master/fubarchain/images/foo.png"
      },
      "coingecko_id": "foocoin-token",
      "keywords": [
        "osmosis-frontier",
        "osmosis-info",
        "OSMO:123",
        "ATOM:124"
      ]
    }
  ]
}
```
