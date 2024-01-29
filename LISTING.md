# Rules for Token Listings

## Osmosis Chain
 - Completely permissionless

## Osmosis Zone App

### Prerequisites
 - Asset, origin chain, and required IBC connection are registered to the Cosmos Chain Registry
 - At least one integrated wallet supports the origin chain, asset
   - (Note: native wallet support is not required as long as some chain suggestion or addChain method works)
 - A transfer/bridge interface exists for non-standard asset transfers

### Listing as Experimental Asset (pseudo-permissionless)
 - Nearly all assets are accepted, except those that are:
   - Deceptive, (cannot imitate other assets or copyrighted material via name, symbol, or logo),
   - Shows signs of being a scam, or the team showing nefarious behaviour, (e.g., evidence of rug-pull or pump-n-dump), or
   - Lack an associated identity (may be pseudonymous)
     - Asset listing PRs from brand new GitHub accounts will be rejected; the PR must have contribution from a GitHub account with a significant (and public) contribution history.

### Upgrade Asset to Verified Status (permissioned)
Verified status is granted if the token or project meets any of the following criteria:
 - Governance Approval, via any of the following:
   - Permissioned contract(s), or
   - Osmosis' Liquidity Mining incentive allocation to any pool containing the asset
     - (Note: This includes the External Incentive Matching program)
 - Collaboration, via any of the following:
   - Token is of a project built on Osmosis chain, or
   - Token is of a project funded by Osmosis Grants Program, or
   - Token is launched via StreamSwap stream on Osmosis, or
   - Project team is an Osmocon sponsor (Silver+)
 - Significance, via any of the following:
   - Has a dedicated CoinGecko or CoinMarketCap page with a top 1000 Market Capitalization rank
   - Is available for trade on any of the following 'major' centralized exchanges:
     - Binance, Coinbase, Kraken, Bybit, KuCoin, OKX, Bitstamp, Bitfinex, Gate.io, Huobi Global 
 - Project Legitimacy, meeting ALL of the following (only applies for the primary token of the project):
   - Brand presence: A well-designed project website or well-curated content on content platforms; e.g., a blog, Medium, YouTube, X, etc., and
   - Community presence: Active community channels/following on X, Discord, Telegram, Reddit, etc., and
   - Developer presence: GitHub organization with active development on open-source repository(s).
     - (Note: Merely forking a chain or registering a token does not qualify as 'active development')
    
#### Notify about Verified Status Upgrade
To notifiy the maintainers of the Osmosis Zone App about an unverified asset qualifying (or potentially qualifying) for Verified status, please submit to [this form](https://forms.clickup.com/37420681/f/13nzm9-26193/E9AX59RR07HUBRABBP).

Note that although many qualifying requirements are objective and clear, some requirements, particularly those listed under 'Legitimacy', are more qualitative and can be challenging for the reviewing team to determine with confidence. Thus, it should be known that assets that only potentially qualify via the 'Legitimacy' requirements are not guaranteed to become Verified on the Osmosis app.

### Downgrade Asset from Verified status
 - Explicitly voted out by Osmosis Governance
 - Decommissioning or delegitimization of the asset or its native chain
