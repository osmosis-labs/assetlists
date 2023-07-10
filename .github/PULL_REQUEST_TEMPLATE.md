## Description

<!-- Please specify added token and its corresponding chain. (recommended one token at a time) -->
<!-- E.g., Adding chain: Bar  -->
<!-- E.g., Adding token: FOO from chain Bar  -->
<!-- E.g., See FOO/OSMO Pool 1000 -->

## Checklist

<!-- The following checklist can be ticked after Creating the PR -->

### Adding Chains

If adding a new chain, please ensure the following:
- [ ] Add chain object to bottom of zone_chains.json
- [ ] RPC and REST do not have any CORS blocking of the Osmosis domain.
- [ ] RCP node has WSS enabled.
- [ ] Chain is registered to the [Cosmos Chain Registry](https://github.com/cosmos/chain-registry).
  - [ ] Chain's registration has `staking` defined, with at least one `staking_token` denom specified.
  - [ ] Chain's registration has `fees` defined; at least one fee token has low, average, and high gas prices defined.

### Adding Assets

If adding a new asset, please ensure the following:
- [ ] Add to bottom of zone_assets.json
- [ ] `osmosis_main` defaults to `false` (or else cite the listing rule that justifies enlisting to the Main app)
- [ ] The IBC channel referenced in `path` has been registered to the Chain Registry.

### Validation Testing

If adding a new asset, the **Deposit** and **Withdraw** functions (and the link to the transaction on the foreign chain's block explorer) for the asset must be validated before listing. Please specify whether the Osmosis assetlists repo maintainers [x]or the submitting team shall validate: (choose one)
- [ ] Submitting team to validate--a preview link is requested in the comments of this PR. The submitting team will provide evidence of success of the Deposit and Withdraw functions from the Preview Frontend. (screenshot + tx url)

OR
- [ ] Osmosis assetlists repo maintainers to validate--testers will need a small amount of tokens to validate. In which case:
  - [ ] Validaters can buy a small amount of this asset from Pool ID: {PROVIDE POOL ID}.

### On-chain liquidity

If adding a new asset, please provide the plan for on-chain liquidity of the asset: (choose one)
- [ ] The submitting team will ensure a pool will be created soon. Please hold off until further communication, which will notify of the Pool ID.

OR
- [ ] A preview link is requested for the submitting team to be able to create a pool using the Osmosis Frontend.

OR
- [ ] The token is, or will be, going through a StreamSwap stream; thus, the token should be listed without requiring on-chain liquidity. A Pool ID will be provided in this PR following the stream's completion once the team has had a chance to create a pool using the earned funds.

OR
- [ ] Other--<elaborate>

## Related Issues

<!-- Add any special context, if necessary -->
