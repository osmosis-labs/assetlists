# Rules for Token Listings

## Osmosis Chain
 - Completely permissionless

## Osmosis Zone
### Listing as Verified Asset (permissioned):
 - Explicitly voted in by Osmosis Governance (just a signalling proposal--no parameter changes),
 - Implicitly, by Osmosis Governance approving allocation of Osmosis' Liquidity Mining incentives to a pool containing the asset,
   - (Note: This includes the External Incentive Matching program, which allocates a subset of the Incentives)
 - Token is of a project built on Osmosis chain (because all contracts are permissioned by governance),
 - Token is of a project funded by Osmosis Grants Program (OGP is a trusted agent, funded by Osmosis Governance), or
 - Top 200 Market Capitalization on CoinGecko or CoinMarketCap (because these tokens bring substantial value to Osmosis)
### Downgrade Asset from Verified status:
 - Explicitly voted out by Osmosis Governance,
 - Decommissioning or delegitimization of the asset or its native chain
### Listing as Unverified Asset (pseudo-permissionless):
 - Asset is registered to the Cosmos Chain Registry
 - Origin chain is registered to the Cosmos Chain Registry
   - IBC connection between origin chain and Osmosis is registed to the Cosmos Chain Registry
 - At least one integrated wallet supports the origin chain and asset
   - (Note: native wallet support is not required as long as some chain suggestion or addChain method works)
 - Nearly all assets are accepted, except those that are:
   - Deceptive, (cannot imitate other assets or copyrighted material via name, symbol, or logo),
   - Shows signs of being a scam, or the team showing nefarious behaviour, (e.g., evidence of rug-pull or pump-n-dump), or
   - Lack an associated identity (may be pseudonymous)
     - A GitHub account with a long (>1 year) and active (>= avg. 5 contributions per month) history, with having contributed to at least one other repository that is relevant to cryptocurrencies, must, either: submit the PR listing the asset, or indicate their association to it on that PR.
