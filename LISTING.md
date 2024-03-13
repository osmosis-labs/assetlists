# Rules for Token Listings

## Osmosis Chain
 - Completely permissionless

## Osmosis Zone App

### Prerequisites
 - Asset, origin chain, and required IBC connection are registered to the Cosmos Chain Registry
 - At least one integrated wallet supports the origin chain, asset
   - (Note: native wallet support is not required as long as some chain suggestion or addChain method works)
 - A transfer/bridge interface exists for non-standard asset transfers

### Listing as an Unverified Asset (pseudo-permissionless)
 - Nearly all assets are accepted, except those that are:
   - Deceptive, (cannot imitate other assets or copyrighted material via name, symbol, or logo),
   - Shows signs of being a scam, or the team showing nefarious behaviour, (e.g., evidence of rug-pull or pump-n-dump), or
   - Lack an associated identity (may be pseudonymous)
     - The submitting GitHub account should have a significant (and public) contribution history visible on their GitHub profile.
     - Asset listing PRs from brand new GitHub accounts generally will not be accepted, unless another GitHub account with a significant history leaves a supportive comment on the PR.

### Upgrade Asset to Verified Status (permissioned)

#### Requirements

Osmosis Frontend aims to require that asset metadata is registered correctly and thoroughly, as well as be recognized by key interfaces, and have sufficient liquidity.

Registered Asset Metadata (at the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry)):
 - All standard required values: Name, Symbol, Display decimals/exponent, Type_asset (sdk.coin vs cw20 vs erc20 vs ...), etc.
 - A detailed Description
 - A detailed Extended Description, if applicable.
 - Associated Socials, including Website and Twitter.
 - CoinGecko ID
 - Logo Image (high quality):
   - File has square Aspect Ratio
   - File size < 250 KB
   - Image resolution appears high (should look crisp, with no compression artifacts, and no blur)
   - Any opaque image content could fit entirely within an imaginary circle inscribed within the square file shape
     - That is, the logo image should not have content in the corners of the file
     - For example, note how the unicorn's horn does not exit the boundary of the imaginary inscribed circle. This is acceptable:
       ![image](https://github.com/JeremyParish69/assetlists/assets/95667791/03827e38-e6fd-49a0-9871-9ef3ff7de4f5)

Integrations:
 - Recognition by key Block Explorers:
   - Mintscan
   - Celatone (Assets are added at [Celatone's Data Repository](https://github.com/alleslabs/aldus/blob/main/data/assets.json))
 - Recognition by key Data Aggregators:
   - CoinGecko (See: [How to list new Cryptocurrencies on CoinGecko](https://support.coingecko.com/hc/en-us/articles/7291312302617-How-to-list-new-cryptocurrencies-on-CoinGecko))
     - Has Price, Supply, and Market Capitzalization Data
     - Includes Osmosis Market(s)
   - CoinMarketCap
 - Recognition by key Wallets:
   - Keplr
     - Chains suggestion is added to [Keplr's Chain Registry](https://github.com/chainapsis/keplr-chain-registry)

Liquidity:
 - At least $10k USD of liquidity on Osmosis DEX
 - At least one pool of type: Supercharged Liquidity(CL), Stableswap, Transmuter/Alloyed Asset, or Astroport PCL.
   - Note that although Supercharged Liquidity is the recommended pool type for most assets, this type of pool cannot be created via the Osmosis Zone frontend interface. 

#### Qualification Criteria

Verified status is granted if the token or project meets any of the following criteria:
 - Governance Approval, via any of the following:
   - Permissioned contract(s), or
   - Osmosis' Liquidity Mining incentive allocation to any pool containing the asset
     - (Note: This includes the External Incentive Matching program)
   - Note: Do NOT create a signalling proposal
 - Significance, via any of the following:
   - Has a top 1000 Market Capitalization rank on CoinGecko or CoinMarketCap
   - Is available for trade on any of the following 'major' centralized exchanges:
     - Binance, Coinbase, Kraken, Bybit, KuCoin, OKX, Bitstamp, Bitfinex, Gate.io, Huobi Global 
 - Project Legitimacy, meeting ALL of the following (only applies for the primary token of the project):
   - Brand presence: A well-designed project website or well-curated content on content platforms; e.g., a blog, Medium, YouTube, X, etc., and
   - Community presence: Active community channels/following on X, Discord, Telegram, Reddit, etc., and
   - Developer presence: GitHub organization with active development on open-source repository(s).
     - (Note: Merely forking a chain or registering a token does not qualify as 'active development')

    
#### Notify about Verified Status Upgrade
To propose that an asset should be upgraded to Verified status, please submit a Pull Requiest to this repository:
 - The PR should update the asset's `"osmosis_verified"` property value to `true` in the [zone_assets](https://github.com/osmosis-labs/assetlists/blob/main/osmosis-1/osmosis.zone_assets.json) file.
 - In the Descrption or Conversation of the PR, please provide evidence of the Qualifying Criteria

Note that although many qualifying requirements are objective and clear, some requirements, particularly those listed under 'Legitimacy', are more qualitative and inherently subjective, so it can be challenging for the reviewing team to determine with confidence. Thus, it should be known that assets that only potentially qualify via the 'Legitimacy' requirements are not guaranteed to become Verified on the Osmosis app.

### Downgrade Asset from Verified status
 - Decommissioning or delegitimization of the asset or its native chain (e.g., UST during the Terra [Classic] collapse)
