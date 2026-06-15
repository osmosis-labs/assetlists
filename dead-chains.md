## ⚰️ Dead chain candidates

_Chains Osmosis lists an asset from, registered as live, whose every RPC + REST endpoint has failed for 7+ consecutive runs AND which status.cosmos.directory corroborates as dead. Candidates for a `source_chain_killed` flag and an upstream chain-registry `status: killed` PR. Verify before acting._

> **On the cosmos.directory signal:** it sources its chain and endpoint list from the cosmos chain-registry, then probes those endpoints. So a stale `lastSuccessAt` age IS an independent measurement (real probes against live endpoints), but a 404 / "not tracked" only means the chain isn't in the registry's monitored set (partly circular with the very registry change we're proposing), so treat 404-only corroboration as weak. The local 7-run streak is the independent half of the gate._

| Chain | Registry status | Signal | Consecutive runs | First seen | cosmos.directory |
|-------|-----------------|--------|------------------|-----------|------------------|
| starname | live | all_dead | 15 | 2026-06-03 | 713d since success |
| konstellation | live | all_dead | 15 | 2026-06-03 | 389d since success |
| rizon | live | all_dead | 15 | 2026-06-03 | 238d since success |
| galaxy | live | all_dead | 15 | 2026-06-03 | no endpoints listed |
| tgrade | live | all_dead | 15 | 2026-06-03 | 632d since success |
| echelon | live | all_dead | 15 | 2026-06-03 | 736d since success |
| odin | live | all_dead | 15 | 2026-06-03 | 128d since success |
| rebus | live | all_dead | 15 | 2026-06-03 | 15d since success |
| lambda | live | all_dead | 15 | 2026-06-03 | 720d since success |
| acrechain | live | all_dead | 15 | 2026-06-03 | 210d since success |
| imversed | live | all_dead | 15 | 2026-06-03 | no endpoints listed |
| migaloo | live | all_dead | 15 | 2026-06-03 | 206d since success |
| omniflixhub | live | all_dead | 15 | 2026-06-03 | 139d since success |
| bluzelle | live | all_dead | 15 | 2026-06-03 | 59d since success |
| gateway | live | all_dead | 15 | 2026-06-03 | 75d since success |
| sge | live | all_dead | 15 | 2026-06-03 | 280d since success |
| stafihub | live | all_dead | 15 | 2026-06-03 | 243d since success |
| qwoyn | live | all_dead | 15 | 2026-06-03 | 128d since success |
| scorum | live | all_dead | 15 | 2026-06-03 | 374d since success |
| pylons | live | all_dead | 15 | 2026-06-03 | 226d since success |
| conscious | live | all_dead | 15 | 2026-06-03 | 55d since success |
| furya | live | all_dead | 15 | 2026-06-03 | 361d since success |
| routerchain | live | all_dead | 15 | 2026-06-03 | 217d since success |
| lorenzo | live | all_dead | 15 | 2026-06-03 | 362d since success |
| synternet | live | all_dead | 15 | 2026-06-03 | 69d since success |
| aaronetwork | live | all_dead | 15 | 2026-06-03 | 232d since success |
| sidechain | live | all_dead | 15 | 2026-06-03 | 292d since success |
| manifest | live | all_dead | 15 | 2026-06-03 | 114d since success |
| intento | live | all_dead | 15 | 2026-06-03 | 112d since success |
| fandomchain | live | all_dead | 15 | 2026-06-03 | 94d since success |
| self | live | all_dead | 15 | 2026-06-03 | 235d since success |

<details><summary>⚠️ Probe mismatches (2) — failing Osmosis validation 7+ runs but ALIVE on cosmos.directory. Osmosis's endpoint set is likely the problem, not the chain.</summary>

| Chain | Consecutive runs | cosmos.directory |
|-------|------------------|------------------|
| arkh | 15 | 0d since success |
| nomic | 15 | 0d since success |

</details>

<details><summary>Unverifiable chains (zero testable endpoints, 1) — cannot confirm dead or alive</summary>

hippoprotocol (live)

</details>

---

## 🗓️ Possible planned shutdowns

_Governance proposals on listed chains matching shutdown language, filed within the last 62 days (older ones are skipped unless they name a concrete target date/height, so a shutdown filed early still shows). False positives are expected (a proposal may reject or merely discuss a shutdown). **Submitted** is the proposal filing date (how new this result is); **Target date / height** lists date/height strings lifted verbatim from the proposal text (unparsed — confirm before trusting). Verify, then a curator may set `planned_shutdown_date` on the zone_asset to drive the existing halt automation._

| Chain | Proposal | Submitted | Target date / height | Matched phrase | In title | Status | Title |
|-------|----------|-----------|----------------------|----------------|----------|--------|-------|
| source | #3 | 2024-04-22 | `June 2022` | `sunset` | yes | PASSED | Sunset the $SRCX Token and Merge into $SOURCE  |
| osmosis | #1007 | 2026-04-09 | `March 11, 2026` | `sunset` | no | PASSED | Integration and Migration of Osmosis into the Cosmos Hub |
| coreum | #37 | 2026-03-18 | `March 1, 2026`<br>`March 3, 2026`<br>`March 14, 2026`<br>`February 2026` | `shut down` | no | REJECTED | Increase Security Inflation to 10% |
| akash | #315 | 2026-01-27 | `December 2024`<br>`November 2025`<br>`1/20/2026` | `sunset` | no | PASSED | PIP3.5 — GPU Capacity Maintenance via Provider Incentive Program |
| elys | #89 | 2025-11-11 | `December 18th, 2025` | `shutdown` | no | PASSED | Reduce ELYS Inflation to Zero |
| akash | #302 | 2025-08-26 | `July 2026`<br>`January 2027`<br>`January 2026`<br>`June 2027` | `sunset` | no | REJECTED | Akash Adoption Lab |
| mantrachain | #17 | 2025-08-20 | `August 18, 2020`<br>`January 15, 2026` | `sunset` | no | PASSED | OM Homecoming: Establishing MANTRA Chain as OM's Native Foundation |
| bandchain | #11 | 2023-04-11 | `April 27, 2023` | `end of life` | no | PASSED | BCIP-11: Upgrade to v2.5 |

