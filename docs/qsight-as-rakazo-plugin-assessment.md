# QSight as a Rakazo/DSH plugin: assessment

Yes for packaging and exploratory analysis; no for replacing trusted commercial processing with prompts and raw SQL.
A plugin can make QSight simpler to run and faster to present, while retaining a small authoritative service.
Removing that service makes the prototype smaller but moves correctness, security, audit and migration work into a less constrained agent.
Recommend **B**, with a read-only experiment first; do not adopt A for authoritative project or financial records.
This is source analysis and a proposal, not a deployment, compatibility certification or authorization to change an invariant.

## Evidence and verification scope

Inspected fetched `origin/main` archives on 2026-11-16, without changing the other repositories' working trees:

| Prefix | Repository / immutable snapshot |
| --- | --- |
| R | rakazo-qsight `95e0c63bb6e8e0b854fcdb0b0aba3f360c3c5c30` |
| A | vendor-one-agentic `65fe359afcad4d0f8b47c275a2be189b23da5d37` |
| P | vendor-one `c7bd601a6c842dcc0988e26e899d878c1303bc94` |
| D | Installed DSH archive, package documentation; local bundled evidence, no Git provenance established |

Citations are `prefix path:line`; line numbers refer to these snapshots, not earlier research branches.
D paths are relative to `dsh/node_modules/@deepseek-ai/` inside the supplied app.asar location.
The requested archive subdirectory is not an OS directory; selected members were read into temporary research files.
No archive content, private operational URL, customer fixture or credential is included here.
No Graphify graph existed; direct source inspection supplies the evidence without generated repository artifacts.
Read R `docs/agent-ui-qsight-actions-research.md:1` and `docs/surface-area-reduction-plan.md:1` as prior research, rechecking current source.
P `architecture/README.md:3` identifies `architecture/workspace.dsl` as the reviewed model; diagrams are design evidence, not live topology.

## What actually moves

Today Rakazo coordinates chat and presentation; QSight owns project records and evidence (R `docs/agentic-ui-invariants.md:36`).
The current direction is web → fork API → adapter → agent API; R's adapter stages intake over HTTP and provisions MCP separately
(R `packages/adapters/src/qsight-hierarchy.ts:190`, `:476`, `:507`). A supplies HTTP routes plus MCP dispatch, not just storage
(A `server/agent_api.py:18`; `server/mcp_pilot.py:151`, `:173`).

| Category | Current responsibility | Under full replacement A |
| --- | --- | --- |
| Processing | Byte verification, parser/OCR, classification, role-specific extraction, validation | Runtime tools and prompts must recreate these steps |
| Processing | Ledger materialization, reconciliation, issue refresh, investigation and coverage | SQL plus agent orchestration must implement domain semantics |
| Data | Source objects, preserved Markdown, extracted facts, versions, tasks, evidence and audit | Postgres alone needs an explicit binary/object-storage and retention design |
| Authority | Owner/project authorization, source identity, command replay, stale-write rejection | MCP gateway/database policy must enforce these independently of prompts |
| Authority | Human publication, exact-impact approval, deterministic commercial reference | Cannot safely become a model instruction or arbitrary SQL mutation |
| Presentation | PM conversation, selected project, read-only third panel | Good fit for plugin rendering of versioned saved analysis |

These are separate contracts: moving processing does not transfer human authority, and storing JSON does not validate its meaning.
P intake separates staged work from publication (`server/intake.py:425`, `:581`, `:716`); the ledger is materialized after review
(P `flows/commercial/pipeline.py`, indexed by `docs/invariants.md:48`). SQL can host deterministic rules, but then they are maintained domain code, not prompts only.

### Runtime and plugin feasibility: verified versus proposed

Verified: R has an `AgentRuntime` adapter interface (`packages/adapter-kit/src/interfaces.ts:384`) and runtime registry slot
(`packages/adapter-kit/src/registry.ts:22`). Bot templates install instructions/skills/routines (`docs/bots-and-chats.md:18`).
However, Pi executes in API/worker processes, separately from computer environments (`docs/computer-runtime.md:3`, `:13`).
A per-bot computer/session is not proof of a separately isolated application server or database tenant.
An app runtime template with pinned tools, model, limits and project scope is a **proposal**, not a verified turnkey template facility.

Verified: D has typed React slots with registration lifetimes (`dsh/docs/subsystems/slots.md:5`, `:19`).
Its right sidebar exposes a tab-type registry, body/title seats and per-session persisted layout
(D `dsh-client-ui-sidebar-right/README.md:12`, `:76`, `:83`). This supports a QSight tab conceptually.
D's optional PTC execution seam is distinct from its agent loop; its isolation descriptor does not claim security
(D `dsh/docs/subsystems/ptc-runtime.md:5`, `:214`). None of these facts establishes tenant isolation.
R's marketplace plugins wrap hosted HTTPS MCP and skills; local execution/editor hooks are unsupported
(R `docs/build-a-plugin.md:3`, `:11`, `:144`). That manifest is not a DSH React panel package.
A DSH panel therefore needs a host-specific integration/compatibility spike; “Rakazo as-is” is not yet proven for this UI.
R's existing rail plan already studies the Harness pattern (`docs/right-rail-tabs.md:33`); it is not evidence that all planned behavior ships.

## Three choices

Scores: 1 = hardest/most additional work, 5 = easiest/strongest fit for trusted QSight behavior.
These are architectural judgments, not measurements. B assumes retained enforcement and tested adapters; C means the inspected source split.
A means raw SQL access and prompts only, without quietly adding back a validating domain service.

| Axis | A: runtime + raw Postgres MCP | B: plugin + thin authority boundary | C: current three repos |
| --- | --- | --- | --- |
| Deployment units | 4: host/runtime + MCP + DB + source storage; fewer domain processes | 3: host + facade/domain worker/parser + DB/storage | 2: R plus A/P overlapping builds and process roles |
| Maintained surface area | 4 initially; 1 after trust parity work | 4: one product implementation, narrow facade | 2: duplicate product/facade surface |
| Tenant isolation | 1: broad SQL bypass risk | 4: scoped commands/reads retained | 3: owner/project checks; not general tenant RBAC |
| Deterministic money | 1: model chooses accounting semantics | 4: canonical ledger/rules retained | 4: existing rules with documented limits |
| Evidence/citations | 1: query result is not provenance | 4: saved artifacts and validators | 4: retained history and citation validation |
| Approvals | 1: SQL can bypass approval state | 4: authenticated commands retained | 3: product boundary exists; chat publication incomplete |
| Audit | 1: transcript/SQL log insufficient | 4: domain events + receipts | 4: domain audit exists; integration still needs proof |
| Migrations | 1: agent/schema coupling uncontrolled | 3: one owned lineage after reconciliation | 2: divergent A/P histories plus R chat DB |
| Offline/retry | 1: session resume is not command replay | 4: durable tasks, leases, receipts | 3: durable work across several boundaries |
| Time to test | 5 for demo; 1 for trusted parity | 4 for read-only pilot; 3 for consolidation | 2: cross-repo coordination and fixtures |
| Lock-in / portability | 2: prompt/model and DSH coupling | 4: portable domain API; host-specific renderer | 3: versioned seams, duplicated implementation |

Deployment scores count logical responsibilities, not machines: a plugin still executes somewhere and source bytes still need storage.
P local compose includes DB, storage/bootstrap, app, worker, migrate and parser (`docker-compose.local.yml:1`).
R has separate API/worker/web and database roles (`infra/compose/docker-compose.prod.yml:306`). No running services were counted.
Prior duplication/migration inventory and consolidation gates are in R `docs/surface-area-reduction-plan.md:25`.
B can reduce independently maintained services by moving A's facade beside P authority; “thin” describes the boundary, not deletion of the domain core.
Deployment and feature velocity improve through fewer builds and a reusable renderer; correctness/security/audit improve only if enforcement survives.
Migration is initially harder in B; A avoids source migration only by accepting lost semantics, or defers a larger rebuild of those semantics.

## Hard problems A does not remove

Each row identifies current enforcement or an explicit limit; none claims the current system is perfect.

| Problem | Current source evidence | Requirement if processing moves |
| --- | --- | --- |
| DB credentials / arbitrary SQL | A `server/agent_tokens.py:18`, `:37` uses hashed, revocable scoped bearer grants; MCP `server/mcp_pilot.py:173` checks resource access | Keep DB secrets in gateway, never model context; separate read role, deny DDL/writes and privileged functions |
| Tenant/row isolation | A MCP `server/mcp_pilot.py:173` checks token project and owner; P `docs/invariants.md:72` explicitly says single admin, not tenant RBAC | Trusted scope injection plus DB grants/RLS or isolated projections; test pool reuse, joins and foreign IDs; never rely on model WHERE clauses |
| Deterministic commercial rules | P `docs/invariants.md:47`–`:52`; `flows/commercial/money.py:1`, ledger pipeline and position reconciliation | Preserve cents/roles/duplicates/reversals/reference selection; Decimal alone is insufficient; SQL sums do not choose accounting meaning |
| Evidence provenance | P `docs/invariants.md:35`–`:38`; `server/intake.py:456`, `:531` verifies bytes/citations | Persist source hashes, pages/excerpts, artifact versions and inspected dependencies alongside each conclusion |
| Approval boundary | P `server/intake.py:324`, `:716`; `server/package_context.py:69`; `docs/invariants.md:14`–`:17` | Separate authenticated human intent, exact reviewed versions and replay-safe command; no SQL approval by bot |
| Reproducible extraction | P `server/intake.py:489`, `:517` binds classification/extraction keys to source/context/model/schema; `docs/invariants.md:36` | Save parse output, schema/model/config, selected role and extraction; reproducible inputs do not promise identical model output |
| Schema migrations | P `server/migrate.py:16`, `:38` full filenames/checksums and advisory lock; R prior plan inventories A/P divergence | One owner, additive versioning, disposable upgrade tests; agent must not evolve schema opportunistically |
| Audit | P `server/intake.py:636` records actor/action; `server/package_context.py:111`; `server/publication_admission.py:37` stores admission state | Domain before/after, actor, version, intent and receipt; chat logs alone cannot prove authorization or replay outcome |
| Prompt injection | P `docs/invariants.md:57`–`:58`; `flows/commercial/investigation_graph.py:315` treats source text as untrusted; staged worker cannot publish | DB/tool permissions enforce capability separation even when document content instructs the model to write or exfiltrate |
| Concurrency | P `server/intake.py:430`, `:442` generation/revision/live-lease fences; `docs/invariants.md:27`–`:30` | Preserve lock/version/attempt checks; two bots and retries cannot overwrite newer decisions; no universal exactly-once claim |
| Cost / latency | P `flows/commercial/investigation_graph.py:190`, `:225` bounds turns/tool calls; `flows/commercial/investigation.py:180` page budget | Bound query duration/rows/bytes and model work; measure against cached saved extraction, not just first-demo speed |
| Retention | P `docs/invariants.md:38`–`:39` distinguishes retained history/outbox from incomplete remote cleanup | Specify replica, source, transcript, snapshot and backup lifetimes; no claim that deleting a DB row erases every copy |

Read-only SQL still leaks data or exhausts resources if credentials, functions, joins or result limits are too broad.
MCP is transport, not isolation or approval. Current MCP authorization does not prove human consent (A `docs/agent-plane-mcp-pilot.md:93`).
Current extraction/citation checks have OCR/visual accuracy limits; zero issues is not completed clean coverage (P `docs/invariants.md:50`, `:57`).

## Where the proposal is good

A third-panel plugin can render saved findings, evidence and explicit coverage without rebuilding conversation, identity and navigation.
A per-bot analysis template can standardize instructions, tools, budgets and synthetic fixtures while reusing Rakazo orchestration.
A read projection/materialized view can make one query store pleasant to explore without giving agents canonical write authority.
It can precompute canonical ledger totals and expose explicit source/version links, keeping exploratory queries cheap and inspectable.
Consolidating duplicated A/P implementation and deployment configuration is a real simplification independent of removing commercial safeguards.
One logical query store does not require merging R chat tables, product migrations or storage credentials.
Keep web → fork API → adapter → scoped product boundary; a panel must not start calling product databases directly.

## Small hybrid experiment: proposed, no writes authorized

Use synthetic fixtures first, then only an explicitly approved data scope; preserve QSight as the baseline and sole canonical writer.
Export a versioned, read-only project projection or use a scoped API behind MCP; include canonical IDs, ledger totals, source versions and coverage.
Prefer named query tools with typed parameters; if SQL is tested, enforce a dedicated read role, project isolation and resource caps outside the model.
Create a bot template with only these tools, pinned model/config and bounded work; no shell route to writer credentials or alternate network escape.
Save analysis as a separate non-authoritative artifact with query/tool trace, input watermark, model/template version, findings and citations.
A DSH tab renders that saved artifact; loading it does not rerun analysis. Show stale/unavailable/forbidden distinctly and preserve chat access.
Use R's adapter chain for a Rakazo-hosted variant. Verify DSH slot packaging separately before choosing the production host.
Refresh on server signal, focus or explicit retry; no data polling. Read-only offline viewing must label the snapshot watermark.
The rail offers no publish/approve/edit action; any later business write returns to the PM conversation and separately authenticated approval.

| Metric / gate | Proposed pass criterion / kill criterion |
| --- | --- |
| Setup time | Fresh synthetic environment ≤30 minutes after prerequisites; stop scope expansion if repeat setup needs undocumented manual fixes |
| Time to first issue | Compare identical fixture sets with baseline; target ≤baseline end-to-end time, report p50/p95 and failed runs |
| Correctness | All seeded critical issues found, no false authoritative money/approval claims; report precision/recall against reviewed baseline, including baseline errors |
| Money/evidence | Canonical totals match exactly; every asserted finding has a valid source/version citation; any mismatch blocks authoritative use |
| Isolation | Zero foreign-project rows/artifacts across direct IDs, joins, prompt injection, revoked tokens and reused connections; any leak kills pilot |
| Retry/concurrency | Forced disconnect, duplicate invocation and source replacement never mutate canonical data; stale artifacts visibly fail freshness checks |
| Cost/latency | Record model tokens, calls, SQL time and bytes per fixture; >2× baseline cost without measured review-time benefit stops expansion |
| Host feasibility | Demonstrate install/uninstall, session switching, saved artifact restore and unavailable states; unsupported host API blocks panel rollout |

These thresholds are proposed acceptance criteria, not measured results; owner chooses the evaluation corpus and budget before implementation.
If the spike requires a seam or invariant change, stop and propose the coordinated versioned change separately.

## Recommendation, residual unknowns and owner decisions

Choose B as the destination: plugin presentation and reusable runtime configuration, one product authority with a thin scoped facade.
Keep human publish/approve, deterministic money, immutable/versioned evidence, domain audit, explicit coverage and owner/project scope.
Keep parser/extraction/investigation support and durable retry where needed; processes may consolidate without converting safeguards to prompts.
C remains the working source baseline while the read-only experiment tests actual savings; A is suitable only for disposable exploratory analysis.
No runtime, schema, token, contract, feature or deployment changes are made by this assessment.

Owner decisions: DSH-hosted product versus Rakazo-hosted panel; supported host versions/licensing/distribution; required standalone QSight journeys.
Decide acceptable tenant model, who can approve for an owner, retention obligations and which actions ever leave read-only analysis.
Verify actual endpoint/build provenance, applied migration histories, active MCP consumers, worker capacity and backup/restore before consolidation.
Unknown: real setup/cost/latency, tenant workload, replica freshness and host compatibility; these were not measured or deployed here.
Trusted publication modules exist in P; a complete Rakazo human-card/admission/delegation journey is not established by source wiring alone
(R `docs/agent-ui-qsight-actions-research.md:31`; P `server/publication_admission.py:37`).
The simpler trustworthy architecture is fewer maintained copies and narrower tools, with commercial authority preserved outside the model.

Validation: documentation-only; `corepack pnpm checks` passed 57/57 and `git diff --check` passed.
No runtime/integration/DB/deployment tests were run; experiment gates above remain proposed work.
