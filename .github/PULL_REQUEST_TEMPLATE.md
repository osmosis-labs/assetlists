## Description

<!-- Please specify added token and its corresponding chain. (recommended one token at a time) -->
<!-- E.g., Adding chain: Bar  -->
<!-- E.g., Adding token: FOO from chain Bar  -->
<!-- E.g., See FOO/OSMO Pool 1000 -->

## Checklist

<!-- The following checklist can be ticked after Creating the PR -->

### Adding Chains

<!-- If NOT adding a new chain, please remove this 'Adding Chains' section. -->
If adding a new chain, please ensure the following:
- [ ] Chain is registered to the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry).
   - Chain's registration must have `staking` defined, with at least one `staking_token` denom specified.
   - Chain's registration must have `fees` defined; at least one fee token has low, average, and high gas prices defined.
- [ ] Add chain to bottom of `zone_chains.json`
   - RPC and REST must not have any CORS blocking of the Osmosis domain.
   - RCP node must have WSS enabled.

### Adding Assets

<!-- If NOT adding a new asset, please remove this 'Adding Chains' section. -->
If adding a new asset, please ensure the following:
- [ ] Asset is registered to the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry).
   - The `description` and/or `extended_description` of the asset in the Chain Registry is informative.
- [ ] Add asset to bottom of `zone_assets.json`.
   - The IBC channel referenced in `path` must be registered to the Chain Registry.
   - `osmosis_unlisted` defaults to `true` (until the respesentation and transferring of the new asset has been validated)
   - Note that it is recommended to include an X (fka, Twitter) profile URL with each asset.

### On-chain liquidity

For each new asset, please provide the plan for on-chain liquidity of the asset: (choose one)
- [ ] Ready -- A liquidity pool has been created. The pool ID is: ______
- [ ] Soon -- A pool will be created. (See: [Pool Setup Guilde](https://docs.osmosis.zone/overview/integrate/pool-setup).)
  - [ ] (optional) A preview of the Osmosis Zone app with the new asset added is requested for creating the pool. (Supercharged Liquidity pools cannot be created via Osmosis Zone app)
- [ ] StreamSwap -- The token is, or will be, going through a StreamSwap stream; thus, the token should be listed without requiring on-chain liquidity. A Pool ID will be provided in this PR following the stream's completion once the team has had a chance to create a pool using the earned funds.
