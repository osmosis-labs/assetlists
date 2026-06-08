## ⚰️ Dead chain candidates

_Chains Osmosis lists an asset from, registered as live, whose every RPC + REST endpoint has failed for 7+ consecutive runs AND which status.cosmos.directory corroborates as dead. Candidates for a `source_chain_killed` flag and an upstream chain-registry `status: killed` PR. Verify before acting._

> **On the cosmos.directory signal:** it sources its chain and endpoint list from the cosmos chain-registry, then probes those endpoints. So a stale `lastSuccessAt` age IS an independent measurement (real probes against live endpoints), but a 404 / "not tracked" only means the chain isn't in the registry's monitored set (partly circular with the very registry change we're proposing), so treat 404-only corroboration as weak. The local 7-run streak is the independent half of the gate._

| Chain | Registry status | Signal | Consecutive runs | First seen | cosmos.directory |
|-------|-----------------|--------|------------------|-----------|------------------|
| starname | live | all_dead | 7 | 2026-06-03 | 706d since success |
| konstellation | live | all_dead | 7 | 2026-06-03 | 382d since success |
| rizon | live | all_dead | 7 | 2026-06-03 | 231d since success |
| galaxy | live | all_dead | 7 | 2026-06-03 | no endpoints listed |
| tgrade | live | all_dead | 7 | 2026-06-03 | 625d since success |
| echelon | live | all_dead | 7 | 2026-06-03 | 729d since success |
| odin | live | all_dead | 7 | 2026-06-03 | 121d since success |
| lambda | live | all_dead | 7 | 2026-06-03 | 713d since success |
| acrechain | live | all_dead | 7 | 2026-06-03 | 203d since success |
| imversed | live | all_dead | 7 | 2026-06-03 | no endpoints listed |
| migaloo | live | all_dead | 7 | 2026-06-03 | 199d since success |
| omniflixhub | live | all_dead | 7 | 2026-06-03 | 132d since success |
| bluzelle | live | all_dead | 7 | 2026-06-03 | 52d since success |
| gateway | live | all_dead | 7 | 2026-06-03 | 68d since success |
| sge | live | all_dead | 7 | 2026-06-03 | 273d since success |
| stafihub | live | all_dead | 7 | 2026-06-03 | 236d since success |
| qwoyn | live | all_dead | 7 | 2026-06-03 | 121d since success |
| scorum | live | all_dead | 7 | 2026-06-03 | 367d since success |
| pylons | live | all_dead | 7 | 2026-06-03 | 219d since success |
| conscious | live | all_dead | 7 | 2026-06-03 | 48d since success |
| furya | live | all_dead | 7 | 2026-06-03 | 354d since success |
| routerchain | live | all_dead | 7 | 2026-06-03 | 210d since success |
| lorenzo | live | all_dead | 7 | 2026-06-03 | 355d since success |
| synternet | live | all_dead | 7 | 2026-06-03 | 62d since success |
| aaronetwork | live | all_dead | 7 | 2026-06-03 | 225d since success |
| sidechain | live | all_dead | 7 | 2026-06-03 | 285d since success |
| manifest | live | all_dead | 7 | 2026-06-03 | 107d since success |
| intento | live | all_dead | 7 | 2026-06-03 | 105d since success |
| fandomchain | live | all_dead | 7 | 2026-06-03 | 87d since success |
| self | live | all_dead | 7 | 2026-06-03 | 228d since success |

<details><summary>⚠️ Probe mismatches (3) — failing Osmosis validation 7+ runs but ALIVE on cosmos.directory. Osmosis's endpoint set is likely the problem, not the chain.</summary>

| Chain | Consecutive runs | cosmos.directory |
|-------|------------------|------------------|
| rebus | 7 | 8d since success |
| arkh | 7 | 0d since success |
| nomic | 7 | 0d since success |

</details>

<details><summary>Unverifiable chains (zero testable endpoints, 1) — cannot confirm dead or alive</summary>

hippoprotocol (live)

</details>

---

## 🗓️ Possible planned shutdowns

_Governance proposals on listed chains matching shutdown language. False positives are expected (a proposal may reject or merely discuss a shutdown). Verify, then a curator may set `planned_shutdown_date` on the zone_asset to drive the existing halt automation._

| Chain | Proposal | Matched phrase | In title | Status | Title |
|-------|----------|----------------|----------|--------|-------|
| agoric | #112 | `sunset` | yes | PROPOSAL_STATUS_PASSED | [Inter Protocol Sunset] Liquidate the reserve module account |
| agoric | #102 | `sunset` | yes | PROPOSAL_STATUS_PASSED | [Inter Protocol Sunset] Invite DCF to liquidate the reserve |
| pundix | #8 | `chain sunset` | yes | PROPOSAL_STATUS_PASSED | PundiXChain Sunset and Full Migration to Ethereum |
| source | #3 | `sunset` | yes | PROPOSAL_STATUS_PASSED | Sunset the $SRCX Token and Merge into $SOURCE  |
| akash | #315 | `sunset` | no | PROPOSAL_STATUS_PASSED | PIP3.5 — GPU Capacity Maintenance via Provider Incentive Program |
| akash | #302 | `sunset` | no | PROPOSAL_STATUS_REJECTED | Akash Adoption Lab |
| bandchain | #11 | `end of life` | no | PROPOSAL_STATUS_PASSED | BCIP-11: Upgrade to v2.5 |
| coreum | #37 | `shut down` | no | PROPOSAL_STATUS_REJECTED | Increase Security Inflation to 10% |
| cosmoshub | #1014 | `sunset` | no | PROPOSAL_STATUS_PASSED | [Correct Owner Address] Migrate Stride to opt-in PSS |
| cosmoshub | #1013 | `sunset` | no | PROPOSAL_STATUS_REJECTED | Migrate Stride to opt-in PSS |
| cosmoshub | #1012 | `sunset` | no | PROPOSAL_STATUS_REJECTED | Migrate Stride to opt-in PSS |
| elys | #97 | `shutdown` | no | PROPOSAL_STATUS_PASSED | v6.10.0 Upgrade |
| elys | #96 | `shut down` | no | PROPOSAL_STATUS_PASSED | v6.9.0 Upgrade |
| elys | #95 | `shut down` | no | PROPOSAL_STATUS_REJECTED | v6.9.0 Upgrade |
| elys | #89 | `shutdown` | no | PROPOSAL_STATUS_PASSED | Reduce ELYS Inflation to Zero |
| mantrachain | #17 | `sunset` | no | PROPOSAL_STATUS_PASSED | OM Homecoming: Establishing MANTRA Chain as OM's Native Foundation |
| mirage | #62 | `shutdown` | no | PROPOSAL_STATUS_PASSED | Upgrade: v1.10.3-sdk-bloat |
| nolus | #306 | `shutdown` | no | PROPOSAL_STATUS_PASSED | Smart Contract Migration to v0.8.16 |
| osmosis | #1007 | `sunset` | no | PROPOSAL_STATUS_PASSED | Integration and Migration of Osmosis into the Cosmos Hub |
| persistence | #145 | `end-of-life` | no | PROPOSAL_STATUS_PASSED | PersistenceCore v13.0.0 |
| quicksilver | #62 | `chain sunset` | no | PROPOSAL_STATUS_PASSED |  Upgrade to v1.10.0 |

