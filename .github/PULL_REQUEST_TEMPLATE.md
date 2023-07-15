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

  Note:
   - Chain's registration must have `staking` defined, with at least one `staking_token` denom specified.
   - Chain's registration must have `fees` defined; at least one fee token has low, average, and high gas prices defined.
- [ ] Add chain to bottom of `zone_chains.json`

  Note:
   - RPC and REST must not have any CORS blocking of the Osmosis domain.
   - RCP node must have WSS enabled.

### Adding Assets

<!-- If NOT adding a new asset, please remove this 'Adding Chains' section. -->
If adding a new asset, please ensure the following:
- [ ] Asset is registered to the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry).
- [ ] Add asset to bottom of `zone_assets.json`.

  Note:
   - The IBC channel referenced in `path` must be registered to the Chain Registry.
   - `osmosis_main` defaults to `false` (or else cite the listing rule that justifies enlisting to the Main app)

### Validation Testing

If adding or updating a chain or asset, the changes must be validated from the updated build of the Osmosis Frontend. Please specify who shall validate:
- [ ] Osmosis assetlists repo maintainers are to validate--testers will need a small amount of tokens to validate. In which case:
  - [ ] Validaters can buy a small amount of this asset from Pool ID: {PROVIDE POOL ID}.

OTHERWISE
- [ ] Submitting team are to validate--a preview link is requested in the comments of this PR. The submitting team will provide evidence of success of the Deposit and Withdraw functions from the Preview Frontend. (screenshot + tx url)

### On-chain liquidity

If adding a new asset, please provide the plan for on-chain liquidity of the asset: (choose one)
- [ ] The submitting team will ensure a pool will be created soon. Please hold off until further communication, which will notify of the Pool ID. (Please set the PR's status to Draft until the pool has been created)

OR
- [ ] A preview link is requested for the submitting team to be able to create a pool using the Osmosis Frontend.

OR
- [ ] The token is, or will be, going through a StreamSwap stream; thus, the token should be listed without requiring on-chain liquidity. A Pool ID will be provided in this PR following the stream's completion once the team has had a chance to create a pool using the earned funds.


<!-- Add any special context, if necessary -->
