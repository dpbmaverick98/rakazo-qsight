# Surface area reduction plan

Status: proposal only, 2026-11-16. This PR changes one document; it authorizes no implementation, migration or deployment.
Recommend **A: consolidate the agent plane into vendor-one**, using a temporary B-shaped compatibility boundary; consider C only after parity, and D only as a local test harness.
The target is two maintained source authorities: Rakazo for conversation/presentation and Vendor One for product/agent semantics, with independently versioned releases.

## Evidence and measurement

Verified facts below are source observations, not deployment or usage claims. All later phases and target paths are proposals.
Fetched each requested repository's `origin/main` and inspected `git archive` snapshots, leaving their working trees untouched.
Citations use `R`, `A`, `P` plus repository-relative path and line at these immutable revisions:

| Prefix | Repository | origin/main commit |
| --- | --- | --- |
| R | rakazo-qsight | `720d47e9e9b5e569ec326557ccff0c918196acf5` |
| A | vendor-one-agentic | `de84122bd80c19417e7e54ea0a45369ae6aa36a0` |
| P | vendor-one | `c7bd601a6c842dcc0988e26e899d878c1303bc94` |

Research read: R `docs/agent-ui-qsight-actions-research.md:1`; P `docs/simplification-audit.md:1`.
R has no `docs/simplification-audit.md` in this snapshot; the available audit is in P.
Those reports cite older branches: current A already includes saved intake decisions/readiness and existing package references (A `server/mcp_pilot.py:312`, `:365`).
P now wires the publication publisher into the app (P `server/app.py:120`); wiring does not establish a working Rakazo publication journey.
No existing Graphify graph was available; direct source comparison supplies evidence without adding generated artifacts to this doc-only change.

Counts are all tracked regular files exported by `git archive`; LOC means physical lines including blanks/comments in `.py`, `.ts`, `.tsx`, `.sql`, including tests/migrations.
These are reproducible scope measurements, not executable LOC or promised deletion budgets; other languages, lockfiles and assets remain in file totals.

| Repository | Files | Selected source files | Selected source LOC |
| --- | ---: | ---: | ---: |
| R | 5,546 | 4,574 | 1,089,558 |
| A | 734 | 266 | 42,257 |
| P | 684 | 247 | 39,646 |

Compared same-relative-path bytes in A/P, without normalization; “identical” is stronger than similar responsibilities.

| Directory | Common files | Byte-identical | Interpretation |
| --- | ---: | ---: | --- |
| server | 44 | 34 (3,503 lines) | Duplicated product implementation, including migration files in recursive count |
| explorer | 311 | 310 (77,615 lines, all file types) | Duplicated frontend/assets/lockfile; not 77k lines of application logic |
| tests | 70 | 70 (12,734 lines) | Duplicate test maintenance; independent producer/consumer roles still matter |
| contracts | 29 | 28 (2,776 lines) | Shared contracts duplicated; manifests intentionally differ |
| flows | 35 | 31 | Product pipeline duplication plus four divergent files |
| parser_service | 2 | 1 | Shared parser footprint with one divergent implementation |

Divergent common server files: `app.py`, `config.py`, `folder_imports.py`, `geocoding.py`, `intake.py`, `migrate.py`, `portfolio.py`, `projects.py`, `task_inspector.py`, `worker.py`.
Divergent flows are `flows/__init__.py`, `flows/commercial/providers.py`, `position.py`, `investigation.py`; parser divergence is `parser_service/app.py`.
Do not overwrite these wholesale; compare semantics and tests before choosing P authority. Explorer divergence is `explorer/src/next/ProjectDashboard.tsx`.
Both apps mount the same six product router families: portfolio/projects/commercial/intake/work_setup/folder_imports (A `server/app.py:123`; P `server/app.py:114`).
Their decorator counts are respectively 12/10/18/7/5/5, **57 routes per repo**; overlapping surfaces do not prove identical handler behavior.
Genuinely separate: R chat persistence/jobs and tool policy; A bearer grants/agent projections; P product session routes and trusted publication admission.

### Transports, seams and durable state

A has 16 decorated agent HTTP routes plus one registered preview route (A `server/agent_api.py:18`, `:85`–`:444`).
A also has 22 MCP tools (A `server/mcp_pilot.py:404`); R allows 20, excluding rename/delete (R `packages/core/src/plugin-catalog.ts:4`).
Overlap includes client/location/building/project setup and intake reading/correction; representations, errors and replay namespaces differ.
MCP also offers `create_work_package`, `list_open_intakes`, `search_documents`, package invoice/change/issue reads without equivalent dedicated agent HTTP routes.
Product session routes are not substitutes for scoped agent routes. Preview bytes and MCP evidence metadata/links are separate capabilities.
MCP dispatches in-process into route functions through `endpoints()` (A `server/mcp_pilot.py:145`); it is not already a remote thin proxy.
R uses HTTP for hierarchy/intake and provisions MCP separately (R `packages/adapters/src/qsight-hierarchy.ts:69`, `:507`).
Keep `stageProjectIntake` and durable `project.intake.stage` jobs (R `packages/adapters/src/project-intake-staging.ts:30`; `background-job-handlers.ts:151`).
They coordinate chat attachments and receipts, not a duplicate commercial ledger; removing the worker would lose recovery semantics.

A `contracts/seams.json:33`–`:183` declares seven seams: task-payload 1.0.0, provider-chat-completions 1.2.0, parser-parse 1.2.0,
agent-hierarchy 2.2.0, agent-project-commercial 1.1.0, agent-operations 1.0.0, agent-intake 2.0.0.
P `contracts/seams.json:1` declares the first three plus publication-http 1.1.0: **eight unique seam IDs**, eleven manifest entries across A/P.
Keep all eight semantic contracts initially; retire duplicate manifest ownership after consolidation, not the actual parser/provider/task boundaries.
Retire MCP-specific discovery/tool/config surface only after consumer migration; no separately registered MCP seam ID exists to delete.
External fixture conformance is explicitly not actual Rakazo execution (A `contracts/seams.json:110`, `:199`).
Cross-repo changes require schema, fixtures, producer and actual consumer tests plus coordinated version bumps; no one-sided seam edits.

A has 27 SQL migrations, P 25; 24 shared full filenames are byte-identical.
Both have paired `0014_change_order_source_cascade.sql`/`0014_work_package_archive.sql` and `0015_building_location.sql`/`0015_durable_investigations.sql`.
A additionally pairs `0016_agent_tokens.sql` with `0016_package_synthesis.sql`; A-only `0023_agent_operations.sql`, `0024_agent_scaffold_scope.sql` differ from P-only `0025_publication_admissions.sql`.
Full filenames/checksums, not numeric prefixes alone, identify history (A/P `server/migrate.py:16`, `:38`); preserve every applied name and byte.
R's Prisma history (`packages/db/prisma/migrations`) is a distinct chat database lineage, never merged with the product runner.
No database was inspected: identical source histories do not establish identical applied histories or that A/P share a database.

### Deployment/config inventory

A/P each contain a byte-identical `docker-compose.local.yml:1`: seven services (postgres, storage, create-bucket, app, worker, migrate, liteparse).
Same explicit project/network/volume names can collide if both are launched; this is configuration evidence, not proof either is running.
Each has `Dockerfile:1`, `Dockerfile.liteparse:1`, `architecture/compose.yaml:1`, `fly.claim-review.toml:1`, `scripts/deploy-fly.sh:1`.
Fly declares app/worker/parser process groups and a migration release command (`fly.claim-review.toml:8`–`:15`); architecture compose is a separate modeling config.
A adds `Dockerfile.mcp-pilot:1`, a standalone uvicorn MCP image on port 8003; it does not appear as an eighth service in the local compose.
R has six compose YAML files under `infra/compose`, plus preview Fly, Railway and updater Dockerfiles/configuration.
R production compose declares eight services: postgres/pitr/migrate/api/worker/web/updater/caddy (`infra/compose/docker-compose.prod.yml:306`–`:733`).
These definitions are alternatives/overlays and process roles, not a verified count of deployed machines or applications.
Config consumer examples: R `QSIGHT_BASE_URL`, `QSIGHT_AGENT_TOKEN`, `QSIGHT_SPACE_ID` (`qsight-hierarchy.ts:69`) and `QSIGHT_MCP_ENDPOINT` (`:507`).
Keep public URL/link config while links exist (A `agent_api.py:21`; `mcp_pilot.py:160`); remove only config whose last consumer is retired.

## Options and decision

| Option | Benefit | Cost / constraint | Decision |
| --- | --- | --- | --- |
| A: agent plane in P; R thin client | One product implementation/history; agent changes tested with authority in one PR | Reconcile divergent modules, grants and releases; preserve public facade contracts | Recommended destination |
| B: separate thin BFF/proxy | Independent facade releases; narrower A checkout | New network/auth hop; still three repos/builds; needs versioned internal API, never direct DB sharing by assumption | Transitional only if endpoint compatibility requires it |
| C: keep all, retire MCP after HTTP parity | Removes protocol/image/config/catalog duplication | Leaves copied product core; current parity absent; generic MCP ecosystem remains useful | Later optional reduction, insufficient alone |
| D: one deployment unit/compose | Easier reproducible test startup and provenance | Couples failures/releases; cannot erase worker/parser/database isolation or auth | One local harness first, no production decision |

A reduces the largest verified duplication; C targets transport glue but leaves 310 copied explorer files and a second product implementation.
Keep R public and vendor-neutral outside its adapters; never vendor private product source, credentials, customer fixtures or private operational URLs into it.
Move agent modules into P only after owner confirms source/license/access constraints; do not assume the product repository may become public.
R UI can release faster against additive versioned contracts; P ships product and agent semantics together. Pin tested producer/consumer revisions in a compatibility matrix.
During transition, freeze new product work in A except compatibility fixes; avoid dual-writing state or maintaining two independently evolving product authorities.
Co-location does not merge product session, owner setup bearer, project scaffold/read bearer and service publication credentials.
Rollback is an application/endpoint selection with compatible schema, never reverse migrations or automatic cross-database cutover.

## Staged implementation proposal

Each phase requires a separate reviewed change set. Entry/exit are source/test gates; operational changes require a later explicit deployment authorization.
No phase blocks ongoing intake work on the current transport. Baseline failing checks remain visible; never delete features/tests to obtain green.

### Phase 1 — one bounded duplicate removal (smallest first PR)

Scope: in A add `server/agent_links.py:validated_public_root`; use it from `agent_api.public_link` and `mcp_pilot.link`.
Remove the duplicated environment lookup/URL-validation branch at A `agent_api.py:22`–`:27` and `mcp_pilot.py:161`–`:164`; leave path/query assembly in each wrapper.
Entry: capture existing valid/invalid root behavior, including different HTTPException/ValueError mappings; no seam or invariant change required.
Tests/gates: unit table for scheme/credentials/query/fragment, escaped IDs and trailing slash; existing agent HTTP/MCP tests; seam check and catalog gate.
DB gate: no SQL, runner or database access changed; e2e smoke existing stage → read → correct flow in an isolated harness when available.
Exit: two root-validation implementations become one, zero endpoint/tool/catalog removals, unchanged wire results/errors; record net LOC rather than promise savings.
Rollback: revert this helper PR; intake continues unchanged. Do not combine it with auth, DTO or config redesign.

### Phase 2 — converge authority and migration provenance

Scope: reconcile the ten divergent server files, four flows and parser difference against P; catalog callers and every tool's scope/error/audit/replay behavior.
Entry: owner selects canonical data authority and provides sanitized applied full-name/checksum inventories for each actual environment.
Tests/gates: P/A unit suites; all eight seam fixture suites and actual R adapter tests; disposable DB fresh install plus upgrades from both recorded histories.
Exit: reviewed file-by-file reconciliation map, no unexplained migration checksum/unknown-history failures; parity matrix identifies every supported consumer.
Include DB concurrency/replay, revoked/foreign-project, stale review, generation/hash fences and publication/change approval negative tests; e2e intake remains usable.
Allocate future migration prefixes centrally; any repair is additive and separately reviewed. Do not renumber 0014/0015/0016 or reapply copied migrations blindly.
Rollback: keep current source/runtime selection; no database changes are authorized by this inventory phase.

### Phase 3 — move agent plane beside product authority

Scope: port A `agent_api.py`, `agent_tokens.py`, `agent_operations.py`, `agent_preview.py`, `agent_debug.py`, `mcp_pilot.py`, shared link helper and their tests into P.
Preserve A-only migration files verbatim in a reviewed union; keep P publication modules and 0025; adapt app wiring rather than copying A `app.py` over P.
Transfer the four agent seam definitions/fixtures/tests into P's manifest; keep publication-http and three internal/external seams there.
Entry: phase 2 reconciliation/DB gates green; public-repo/license check complete; old R consumers pass against the candidate P build.
Tests/gates: unit, all seam producers/consumers, actual R adapters, disposable union-history DB verification, concurrent operations/revocation and intake/publication e2e.
Exit: one product source builds both facades; preserve endpoints/tool names/scopes/audit/replay keys, including `mcp:` package receipts.
Only then retire A's copied `explorer`, `flows`, product `server` modules and duplicate tests/builds; retain archival tags/history and any temporary compatibility entrypoint.
Rollback: retain pinned A artifact and supported endpoint selection; verify its runner accepts the union history before declaring rollback viable.
An old A runner rejects unknown P migrations: if incompatible, roll forward with the compatibility build, never point it blindly at the evolved DB.

### Phase 4 — one semantic implementation, then optional HTTP-only agent transport

Scope: replace MCP route-name lookup (`endpoints`, command maps) with explicit shared authorized read/command functions in P; reuse them from HTTP wrappers.
Add dedicated HTTP equivalents for the supported 20-tool R catalog, including open-intake recovery, package creation and bounded commercial/evidence metadata reads.
Entry: phase 3 authority stable; explicit matrix covers shapes, scopes, validation, errors, audit, idempotency and trusted-write policy; owner identifies non-R MCP clients.
Tests/gates: shared-function unit tests; versioned schemas/fixtures plus real R consumer tests; disposable DB replay/revoke/isolation; both-transport e2e stage/read/correct/create.
Exit: actual R PM tool execution uses approved HTTP adapter calls with the same approval policy; all supported consumers migrated and deprecation window accepted.
Then delete `mcp_pilot.py`, `Dockerfile.mcp-pilot`, MCP-only tests/config/docs and R's Vendor One MCP provisioning/catalog dependency together; preserve generic MCP support.
Keep agent-hierarchy/commercial/operations/intake and publication-http seams: retiring a protocol does not retire semantic authority contracts.
Rollback: keep last compatible MCP artifact/config during deprecation; restore it without schema rollback if HTTP parity fails. No proven parity means keep thin MCP.

### Phase 5 — one reproducible local integration harness

Scope: consolidate A/P duplicate local compose ownership in P; add one pinned-revision test entrypoint joining R API/web/worker to P app/worker/parser.
Use unique test project/network/volume names, separate DBs and explicit auth/service configuration; one command need not mean one container or one database.
Entry: canonical source and compatibility matrix established; no dependence on unmanaged working-tree edits or ambient secrets.
Tests/gates: compose render/config validation, unit/startup checks, seams, disposable DB readiness/upgrades, full synthetic intake and owner-publication e2e including failure/retry.
Exit: one documented local startup/teardown path and build provenance; measure commands, independently built product copies and transport configs before/after.
Rollback: preserve prior local harness command; remove only new disposable resources. Never tear down working volumes or change production topology here.
Production consolidation remains an owner decision after observed scaling/failure/release evidence, backup recovery and a separately approved rollout/rollback plan.

## Boundaries that must not change

Human publication remains a distinct authenticated approval; bearer MCP/HTTP access and Space membership do not prove consent (A `docs/agent-plane-mcp-pilot.md:93`).
P `server/intake.py:324` publishes saved review; P `server/package_context.py:354` binds commercial change approval to impact. Agents cannot approve money or bypass either boundary.
Keep tenant/project authorization, per-call revocation, immutable source identity, audit, receipts, source hashes/generations and stale-write fences.
Keep R right rail read-only, writes through PM approval, ID authority/display fallbacks, persisted key contracts and no data polling (R `docs/agentic-ui-invariants.md:16`).
Product remains independently usable; parsing/extraction/investigation and worker leases are domain support, not disposable chat glue.
Keep migration names/bytes, historical receipts/tasks and standalone product routes. No destructive DB work, code changes, migrations or deployment in this PR.

## Owner risks and open questions

Verified source duplication does not prove unused routes, equal databases, operational provenance or safe deletion; traffic, queues and applied histories were not inspected.
Owner: which build/commit serves each endpoint, and are A/P isolated environments or competing writers? Supply sanitized provenance before any runtime cutover.
Owner: which external MCP clients require support, what deprecation window is acceptable, and must those clients retain MCP after R migrates?
Owner: may agent source/tests move into P under existing licenses/access rules, and who owns coordinated contract releases across the public fork boundary?
Owner: what release latency is acceptable for agent-only fixes, and who signs off auth/receipt parity and old-artifact DB compatibility?
Publication source exists, but complete Rakazo card/session/admission and delegated-member authority are not established here; gate owner-only e2e separately.
Estimated savings exclude needed authorization/tests and divergent semantics; measure deleted maintained copies after each phase, not a speculative percentage.
If implementation requires an invariant or seam change, stop that slice and propose it explicitly with both sides and versioning; this plan does not waive that rule.

## If we only do three things — one-page decision brief

1. **Unify one duplicate now:** shared public-root validation in A, preserving wrappers/errors and current intake/MCP behavior. One focused PR, two validators → one.
   Require unit plus existing facade/seam checks; revert alone if behavior differs. This yields a measured reduction without waiting for publication or transport parity.
2. **Make P the sole product/agent source:** reconcile divergent files and full migration histories, port narrow agent modules/contracts/tests, then retire A's copied product tree.
   Keep R a public thin adapter/client with independent UI releases; keep product/session/project/service credentials separate and product standalone use intact.
   Require disposable DB upgrade/replay/isolation gates and real R intake e2e before source retirement; compatible pinned artifacts define rollback.
3. **Reduce runtime choices only with evidence:** complete HTTP coverage and migrate actual PM consumers before removing the Vendor One MCP image/config/catalog surface.
   Keep semantic seams, generic MCP, workers/parser and audit. Use one local pinned integration harness; defer production topology to separate approval.
Success means fewer maintained product copies, validators, protocol adapters and startup paths, with unchanged human approval, isolation and recovery contracts.
This document records source evidence and proposed gates only; it makes no claim of deployed readiness, actual traffic parity or safe operational cutover.

Validation for this documentation-only PR: `corepack pnpm checks` passed 57/57; `git diff --check` passed.
No runtime, database, seam execution or deployment tests were run for this plan; their required future gates are specified above.
