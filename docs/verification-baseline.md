# Verification baseline

This is the compact public-safe evidence map for the `0.2.0` source candidate. The complete private engineering record and local raw logs are intentionally not exported.

| Baseline | Evidence |
|---|---|
| Accepted private checkpoint | `6d2de8b5e8af054885446d4b33e01e047fcd45d0`; C1 preserves the Work-approved 028R3 exact 28-path candidate; private save is not public-source approval |
| Current documentation revision | 029 product story and documentation sync; final commit identity is recorded outside its own commit |
| Approved public source commit | `none`; must be separately supplied as an exact 40-hex SHA equal to live HEAD |
| 028R3 private source-equivalent-contained | 351 passed; 0 failed; 0 skipped |
| 028/R1/R2/R3 focused matrix | 29 passed; 0 failed; 0 skipped |
| 028R3 review export A | 322 passed; 0 failed; 0 skipped |
| 028R3 review export B | 322 passed; 0 failed; 0 skipped |
| Browser/DOM on macOS | 2 passed; 0 failed; 2 Windows-only checks skipped as not applicable |
| Executable health observation | 1,475 actual probes; production 15,000 ms timeout unchanged; 0 timeout or abnormal signal |
| Production builds | Management center and `foundation-events` passed on the frozen source-equivalent surface |
| Static audits | Documentation, publication, dependency, offline, UI, production surface, mutation entrypoint and candidate boundary commands completed; publication findings remain |
| AI-callable operations | Exactly `Foundation:inspect`, `Foundation:request-plan`, `Foundation:open-manager`, `Foundation:status` |
| Real-user / Windows / distribution | Still pending; no claim of acceptance |

The 028R3 rows are historical evidence accepted before C1, not tests newly rerun for the 029 documentation revision. They distinguish the private source-equivalent-contained surface from each actual export tree. macOS browser skips do not satisfy Windows acceptance.

029 proves all non-documentation runtime and contract paths byte/type/mode/hash-identical to C1, runs proportionate documentation/publication/focused/parser checks, visually reviews rendered Markdown, and creates fresh review A/B exports. After C2, a second fresh A/B pair bound to current HEAD becomes the current handoff evidence; its receipts and final GitHub state live in the private ignored 029 save receipt rather than inside this self-referential commit.

Generated provenance/inventory/receipts use strict schema `2.0.0`. Formal records and contract come from exact approved Git commit objects and are independently re-derived during verification. Review binding is null, sourceCommit equals current HEAD, and publicationEligible remains false.

Exports live under `.tmp/public-export/<run-id>/tree`. Verification rejects unknown schema fields, malformed/noncanonical records, missing/extra paths, symlinks, unsupported types, mode/hash changes and privacy findings. Pair verification requires distinct runs. Sync planning also requires a commit-derived trusted historical public baseline; absent or unproven baseline remains a manual conflict with no automatic overwrite/deletion proposal. Receipt hashes are integrity identities, not signatures or approval.
