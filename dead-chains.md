## ⚰️ Dead chain candidates

_Chains Osmosis lists an asset from, registered as live, whose every RPC + REST endpoint has failed for 7+ consecutive runs AND which status.cosmos.directory corroborates as dead. Candidates for a `source_chain_killed` flag and an upstream chain-registry `status: killed` PR. Verify before acting._

> **On the cosmos.directory signal:** it sources its chain and endpoint list from the cosmos chain-registry, then probes those endpoints. So a stale `lastSuccessAt` age IS an independent measurement (real probes against live endpoints), but a 404 / "not tracked" only means the chain isn't in the registry's monitored set (partly circular with the very registry change we're proposing), so treat 404-only corroboration as weak. The local 7-run streak is the independent half of the gate._

_Candidate list publishes on the weekly corroborated run. 0 chain(s) currently at or past the 7-run streak, pending corroboration._

<details><summary>Unverifiable chains (zero testable endpoints, 1) — cannot confirm dead or alive</summary>

hippoprotocol (live)

</details>

---

## 🗓️ Possible planned shutdowns

_Skipped this run (governance-proposal scan runs weekly to bound CI cost and external load)._

