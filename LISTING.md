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
 - Nearly all assets are accepted, except those that:
   - Have no liquidity on Osmosis,
   - Are deceptive(--cannot imitate other assets or copyrighted material via name, symbol, or logo),
   - Show signs of being a scam, or the team showing nefarious behaviour(, e.g., evidence of rug-pull or pump-n-dump), or
   - Lack an associated identity (may be pseudonymous)
     - The submitting GitHub account should have a significant (and public) contribution history visible on their GitHub profile.
     - Asset listing PRs from brand new GitHub accounts generally will not be accepted, unless another GitHub account with a significant history leaves a supportive comment on the PR.

### Upgrade Asset to Verified Status (permissioned)

#### Requirements

Osmosis Frontend aims to foster a polished and complete user experience when users intereact with any 'verified' asset. This requires that the asset has all metadata registered correctly and thoroughly, as well as be recognized by key external interfaces, and have sufficient and efficient liquidity on Osmosis.

Registered Asset Metadata at the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry):
 - All standard required values: Name, Symbol, Display decimals/exponent, Type_asset (sdk.coin vs cw20 vs erc20 vs ...), etc.
 - A detailed `description`.
 - A detailed `extended_description`, if applicable.
 - Associated `socials`, including `website` and `twitter` where applicable.
 - The correct `coingecko_id`:
   - Verify its inclusion via [CoinGecko's Coins List API (v3)](https://api.coingecko.com/api/v3/coins/list)
   - Use the `id` value--NOT symbol or name
 - Logo Image (high quality):
   - File has perfectly square Aspect Ratio
   - File size < 250 KB
   - Image resolution at least 200x200 (should look crisp, with no compression artifacts, and no blur)
   - Any opaque image content could fit entirely within an imaginary circle inscribed within the square file shape
     - That is, the logo image should not have content in the corners of the file. Some exceptions may apply, though they are intentional and rare.
     - For example, note how the unicorn's horn does not exit the boundary of the imaginary inscribed circle. This is acceptable:
       ![image](https://github.com/JeremyParish69/assetlists/assets/95667791/67498167-aac2-4974-a9c6-0c645d07d90e)

Integrations with Key Apps:
 - Recognition by key Block Explorers:
   - Mintscan (Assets are added at [Cosmostation's Chainlist](https://github.com/cosmostation/chainlist/blob/main/chain/osmosis/assets.json))
   - Celatone (Assets are added at [Celatone's Data Repository](https://github.com/alleslabs/aldus/blob/main/data/assets.json))
 - Recognition by key Data Aggregators:
   - CoinGecko (See: [How to list new Cryptocurrencies on CoinGecko](https://support.coingecko.com/hc/en-us/articles/7291312302617-How-to-list-new-cryptocurrencies-on-CoinGecko))
     - Has Price, Supply, and Market Capitzalization Data
     - Includes Osmosis Market(s)
       - I.E., Osmosis Pools containing the asset should be discoverable from the asset's CoinGecko page. E.G.:
         ![image](https://github.com/JeremyParish69/assetlists/assets/95667791/34ea402b-1a0f-4e43-9bfc-b750c9ab9430)


Liquidity on Osmosis:
 - At least $10k USD of liquidity on Osmosis DEX
 - At least one pool of type: Supercharged Liquidity(CL), Stableswap, Transmuter/Alloyed Asset, or Astroport PCL.
   - Note that this requirement is NOT met by an instance of the Weighted ('xyk') pool type, which are less strategic for traders and liquidity providers than other pool types.
   - Note that although Supercharged Liquidity is the recommended pool type for most assets, this type of pool cannot be created via the Osmosis Zone frontend interface.
   - See the [Pool Setup Guide](https://docs.osmosis.zone/overview/integrate/pool-setup) for instructions on setting up a Liquidity Pool on Osmosis.

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
