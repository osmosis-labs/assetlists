# Asset Lists

Asset Lists are inspired by the [Token Lists](https://tokenlists.org/) project on Ethereum which helps discoverability of ERC20 tokens by providing a mapping between erc20 contract addresses and their associated metadata.

Asset lists are a similar mechanism to allow frontends and other UIs to fetch metadata associated with Cosmos SDK denoms, especially for assets sent over IBC.

This standard is a work in progress.  You'll notice that the format of `assets` in the assetlist.json structure is a strict superset json representation of the [`banktypes.DenomMetadata`](https://docs.cosmos.network/master/architecture/adr-024-coin-metadata.html) from the Cosmos SDK.  This is purposefully done so that this standard may eventually be migrated into a Cosmos SDK module in the future, so it can be easily maintained on chain instead of on Github.

An assetlist json contains the following structure:

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
                "dest_channel": "channel-1"
            },
            "logo_URIs": {
                "png": "https://github.com/linkto/image.png",
                "svg": "https://stake.com/linkto/steak.svg"
            }
        },
        {
            "description": "Foocoin is the native token of the Foochain",
            "denom_units": [
                {
                    "denom": "ibc/6ED71011FFBD0D137AFDB6AC574E9E100F61BA3DD44A8C05ECCE7E59D40A7B3E",
                    "exponent": 0,
                    "aliases": ["afoocoin"]
                },
                {
                    "denom": "foocoin",
                    "exponent": 18,
                    "aliases": []
                }
            ],
            "base": "ibc/6ED71011FFBD0D137AFDB6AC574E9E100F61BA3DD44A8C05ECCE7E59D40A7B3E",
            "display": "foocoin",
            "symbol": "FOO",
            "ibc": {
                "source_channel": "channel-35",
                "dest_channel": "channel-1"
            },
            "logo_URIs": {
                "png": "ipfs://QmXfzKRvjZz3u5JRgC4v5mGVbm9ahrUiB4DgzHBsnWbTMM",
                "svg": ""
            }
        }
    ]
}
```
