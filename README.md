# Asset Lists

Asset Lists are inspired by the [Token Lists](https://tokenlists.org/) project on Ethereum which helps discoverability of ERC20 tokens by providing a mapping between erc20 contract addresses and their associated metadata.

Asset lists are a similar mechanism to allow frontends and other UIs to fetch metadata associated with Cosmos SDK denoms, especially for assets sent over IBC.

This standard is a work in progress. You'll notice that the format of `assets` in the assetlist.json structure is a strict superset json representation of the [`banktypes.DenomMetadata`](https://docs.cosmos.network/master/architecture/adr-024-coin-metadata.html) from the Cosmos SDK. This is purposefully done so that this standard may eventually be migrated into a Cosmos SDK module in the future, so it can be easily maintained on chain instead of on Github.

Some keywords here are reserved: 
- `osmosis-frontier` keyword requires that a pool ID be defined. It is used to keep track of which tokens appear on Osmosis Frontier.
- `osmosis-main` keyword requires that 'osmosis-frontier' be defined, and also requires either: Osmosis governance to approve that the token be shown on app.osmosis.zone (Main site), or that the token is incentivized by Osmosis--which is also approved by Osmosis governance. It is used to keep track of which tokens appear on Osmosis Main.
- `osmosis-info` keyword requires that a pool ID be defined and that >=$1,000 USD-worth of liquidity of the token be on Osmosis. It is used to filter which assets will appear on the Osmosis Info site and queryable by the API.


The assetlist JSON Schema can be found [here](/assetlist.schema.json)

An example assetlist json contains the following structure:

```
{
    "chain_id": "steak-chain-1",
    "assets": [
        {
            "description": "The native token of Steak Chain",
            "denom_units": [
                {
                    "denom": "usteak",
                    "exponent": 0,
                    "aliases": []
                },
                {
                    "denom": "steak",
                    "exponent": 6,
                    "aliases": []
                }
            ],
            "base": "usteak",
            "display": "steak",
            "symbol": "STK",
            "ibc": {
                "source_channel": "channel-35",
                "dst_channel": "channel-1",
                "source_denom": "ustk"
            },
            "logo_URIs": {
                "png": "https://raw.githubusercontent.com/cosmos/chain-registry/master/fubar/images/stk.png",
                "svg": "https://raw.githubusercontent.com/cosmos/chain-registry/master/fubar/images/stk.svg"
            },
            "keywords": [
                "osmosis-main",
                "osmosis-frontier",
                "osmosis-info"
            ],
            "pools": {
              "OSMO": 991
            }
        },
        {
            "description": "Foocoin is the native token of the Foochain",
            "denom_units": [
                {
                    "denom": "ibc/6ED71011FFBD0D137AFDB6AC574E9E100F61BA3DD44A8C05ECCE7E59D40A7B3E",
                    "exponent": 0,
                    "aliases": ["ufoocoin"]
                },
                {
                    "denom": "foocoin",
                    "exponent": 6,
                    "aliases": []
                }
            ],
            "base": "ibc/6ED71011FFBD0D137AFDB6AC574E9E100F61BA3DD44A8C05ECCE7E59D40A7B3E",
            "display": "foocoin",
            "symbol": "FOO",
            "ibc": {
                "source_channel": "channel-35",
                "dst_channel": "channel-1",
                "source_denom": "ufoocoin"
            },
            "logo_URIs": {
                "png": "https://raw.githubusercontent.com/cosmos/chain-registry/master/fubar/images/foo.png",
                "svg": ""
            },
            "coingecko_id": "foocoin-token",
            "keywords": [
                "osmosis-frontier"
            ],
            "pools": {
              "OSMO": 992
            }
        }
    ]
}
```
