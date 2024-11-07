# Rules for Asset Listings

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
   - Are deceptive(--cannot imitate other assets via name, symbol, or logo),
   - Lack an associated identity (may be pseudonymous)
     - The submitting GitHub account should have a significant (and public) contribution history visible on their GitHub profile.
       - Asset listing PRs from brand new GitHub accounts generally will not be accepted, unless another GitHub account with a significant history leaves a supportive comment on the PR.


### Upgrade Asset to Verified Status (permissioned)

#### Qualification Criteria
 - Nearly all assets can become Verified once validation has been completed and the requirements have been met, except those that show signs of being a scam, or the team showing nefarious behaviour(, e.g., evidence of rug-pull, pump-n-dump, or an extremely small user distribution)
 - Constituents of Alloyed Assets automatically qualify.

#### Requirements

Registered Asset Metadata at the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry):
 - All standard required values: Name, Symbol, Base, Display, Type_asset (sdk.coin vs cw20 vs erc20 vs ...), etc.
 - A meaningful `description`.
 - A detailed `extended_description` further explaining the function of the asset and/or describing the project it represents, and `socials`, including `website` and `twitter`.
   - Not required for 'Memecoins'--must be categorized as "meme"
   - Not required for variant or derivative assets, but the origin asset must have this defined
     - e.g., not required for USDT.eth.axl, but is required for the original USDT
 - Logo Image has a square Aspect Ratio and < 250 KB file size

Accessible liquidity of the asset on Osmosis:
 - There must exist at least one pool containing the asset on the Osmosis chain, where:
   - there is at least $1000-worth (USD) of each asset provided as liquidity,
   - there is a (+ and -) 2% depth of $50 (~$5k of full range liquidity), and
   - a bid/offer of $50-worth (USD) of any asset would quote at least $49 of any other asset
     - This must work for all asset pairs in the pool
     - This would be impossible for pools with a swap fee (or spread) >=2%, which would require special consideration

Asset appearance and functionality must be validated by Osmosis Zone maintainers. This includes:
 - Verifying the asset's details (name, [ticker] symbol, logo, description, socials) can be seen on Osmosis Zone
 - Verifying that the asset has a price on Osmosis Zone
 - It is possible to trade the asset on Osmosis Zone
 - It is possible to Withdraw and Deposit the asset to/from the source chain via Osmosis Zone (or redirects to an interface that can) 
   - For transfers triggered from Osmosis Zone:
     - IBC transfers must resolve without errors (watch out for CORS blocking), and
     - The RPC endpoint has WSS enabled so it can communicate the transfer status back to Osmosis Zone without the user having to refresh the page.
   - For Deposits triggered from Osmosis Zone:
     - The transaction URL opens the correct transaction page on a working block explorer for the counterparty chain.
     - The Chain Suggestion (the method that adds the chain to a wallet like Keplr or Leap) provides correct and sufficent data to complete all standard wallet actions for the counterparty chain (includes the asset as a currency, provides all fee currencies and rate options, can query chain state and initiate transactions, etc.)
   - For transfers from an external interface,
     - The override URL(s) redirect users to the correct interface, including appropriate URL parameters where possible (to pre-select the asset and the 'from' and 'to' network).


#### Notify about Verified Status Upgrade
To propose that an asset should be upgraded to Verified status, please submit a Pull Requiest to this repository:
 - The PR should update the asset's `"osmosis_verified"` property value to `true` in the [zone_assets](https://github.com/osmosis-labs/assetlists/blob/main/osmosis-1/osmosis.zone_assets.json) file.
 - Add `listing_date_time_utc`, which is used to record when (UTC time) an asset is fully Verified on Osmosis Zone.
   - e.g., `"listing_date_time_utc": "2024-01-24T10:58:00Z",`
 - In the Descrption or Conversation of the Pull Request, please provide the Pool ID of a liquidity pool that meets the requirements specified above (needed for validation)



### Full Integration for Best Experience (recommended)

Osmosis Frontend aims to foster a polished and complete user experience when users intereact with an asset. This is best provided when the asset has all metadata registered correctly and thoroughly, as well as be recognized by key external interfaces, and have sufficient and efficient liquidity on Osmosis.

Registered Asset Metadata at the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry):
 - The correct `coingecko_id`:
   - Verify its inclusion via [CoinGecko's Coins List API (v3)](https://api.coingecko.com/api/v3/coins/list)
   - Use the `id` value--NOT symbol or name
 - High Quality Logo Image:
   - Image resolution at least 200x200 (should look crisp, with no compression artifacts, and no unintentional blur)
   - Image adequately contrasts against Osmosis Zone's background colour
   - Any opaque image content would fit entirely within an imaginary circle inscribed within the square file shape
     - That is, the logo image should not have content in the corners of the file. Some exceptions may apply, though they are intentional and rare.
     - For example, note how the unicorn's horn does not exit the boundary of the imaginary inscribed circle. This example follows these guidelines:
       
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
 - At least $10k USD-worth of liquidity on Osmosis DEX
 - At least one pool of type: Supercharged Liquidity(CL), Stableswap, Transmuter/Alloyed Asset, or Astroport PCL.
   - Note that this requirement is NOT met by an instance of the Weighted ('xyk') pool type, which are less strategic for traders and liquidity providers than other pool types.
   - Note that although Supercharged Liquidity is the recommended pool type for most assets, this type of pool cannot be created via the Osmosis Zone frontend interface.
   - See the [Pool Setup Guide](https://docs.osmosis.zone/overview/integrate/pool-setup) for instructions on setting up a Liquidity Pool on Osmosis.

    

### Downgrade Asset from Verified status
 - Decommissioning or delegitimization of the asset or its native chain (e.g., UST during the Terra [Classic] collapse)
