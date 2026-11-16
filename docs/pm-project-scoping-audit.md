# Project-manager project scoping audit

Audited 2026-11-16; source and local tests only. No deployment claim or runtime changes.
Creation verdict: **Pass with gaps**. The normal flow creates/reuses one active PM per
project per Space, with its own credential and assignment; this is not global uniqueness.
Runtime isolation verdict: **Pass with gaps** for project-ID isolation. No direct
foreign-project read/write bypass was found in the enumerated agent routes/tools.
The broader claim of continuing Space/client isolation after moves is **not proven**:
tokens bind owner + project, not the originating Space, client, or binding revision.

## Evidence baseline

All citations below are `repository-relative file:line` at these fetched main commits:

- **F** = rakazo-qsight `720d47e9e` (fork UI/API).
- **A** = vendor-one-agentic `de84122` (agent API, tokens, MCP).
- **P** = vendor-one `c7bd601` (product authority).

Named working checkouts lagged main; isolated temporary checkouts were used.
Existing user changes were untouched. No Graphify graph was available in these
audit checkouts; findings are direct source/test inspection, not graph evidence.
“Covered” below means assertions exist; execution results are recorded separately.

## Evidence table

| Guarantee | Enforcement point | Test evidence | Status |
| --- | --- | --- | --- |
| Requested project belongs to bound hierarchy | F `apps/api/src/project-manager.ts:51–68`; `space-client-binding.ts:54–65` | F `project-manager.test.ts:330` rejects unavailable project before mint; `:474` ignores input names | Covered |
| Authenticated, authorized Space actor; revision fence | F `space-client-binding.ts:15–25,40–49`; `project-manager.ts:106–123` repeats checks under lock | F `project-manager.test.ts:388,425,486,496`: no session, foreign member PM, missing membership/binding, stale revision, ordinary member denied | Covered; no live RLS proof |
| One PM identity, correct name and scope | F `project-manager.ts:179–193,233–264`: `pm:<id>`, `{project.name} - PM`, inheritance/cross-Space off | F `project-manager.test.ts:256,311,398`: exact name/key, one create, same IDs, simulated concurrent winner | Covered; concurrency mocked |
| Database duplicate fence | F `packages/db/prisma/schema.prisma:1058`; `packages/db/src/repos.ts:595–635`: unique Space/spawn key, reuse winner | F `project-manager.test.ts:398` simulates repository winner | Source + unit; archived path gap |
| Setup/building promotion retains conversation | F `project-manager.ts:115–121,179–217,233–243` validates old key, changes same bot | F `project-manager.test.ts:506,588,702,739,761,783,794`: history, chosen project, one promotion/greeting, automatic guard, rollback | Covered |
| Only one explicit scoped assignment; other bots unchanged | F `project-manager.ts:124–177,218–230`: reject shared/cross-Space/other-bot server, replace target bot assignments | F `project-manager.test.ts:256,311,412,436,506`: exact assignment, unrelated assignment/bot preserved | Covered; two-project pair gap |
| Explicit trust retained within current catalog | F `packages/core/src/plugin-catalog.ts:39–53`; F `project-manager.ts:218–228` reads prior scoped assignment | F `packages/core/src/mcp.test.ts:106` checks default read/write separation, not saved custom trust | Source-only for preservation |
| No inherited owner/allBots tools | F `project-manager.ts:69–87,183`; `packages/adapters/src/mcp-connector.ts:467–490,685–709` checks inheritance at discovery and call | F `project-manager.test.ts:455`; `mcp-connector.test.ts:3726` rejects direct inherited-owner calls | Covered; rollout/name caveat |
| Stable server identity; project-bound mint response | F `packages/adapters/src/qsight-hierarchy.ts:470–514`: validates project ID, slug `pm-` + first 60 hex SHA-256 characters | F `qsight-hierarchy.test.ts:197,231` asserts slug format and name-independent identity; `:443` malformed mint cleanup | Covered; hash is truncated, not full 64 hex |
| Mint requires owner write and stores read + scaffold | A `server/agent_api.py:199–228`; `server/agent_tokens.py:18–27` stores project ID and bearer hash | A `tests/test_agent_hierarchy.py:120–139` asserts DB project/scopes, foreign owner/project mint denial | DB test inspected, unrun |
| MCP foreign project/package denied | A `server/mcp_pilot.py:175–186,438–471`: live grant, project comparison, owner lookup, package ancestry | A `tests/test_mcp_pilot.py:223,262,586`: scaffold foreign-project denial; wrong-parent package/document denial | DB tests inspected, unrun |
| HTTP hierarchy/commercial/preview scoped | A `server/agent_api.py:168–188,232–271,320–359`; `server/agent_preview.py:36–62` | A `test_agent_hierarchy.py:96,141`; `test_agent_project_commercial.py:42`; `test_agent_preview.py:68,84` | DB tests inspected, unrun |
| Intake create/read/complete/review scoped | A `server/agent_api.py:379–456`; `server/intake.py:145–170`: intake project, owner, destination ancestry | A `tests/test_agent_intake.py:79,113,137,151`: foreign project, owner-level tokens, cross-project completion denied | DB tests inspected, unrun |
| Fork inspection cannot attach foreign descendants to PM | F `apps/api/src/commercial-inspection.ts:34–63,85–93`; `hierarchy.ts:433–484` fences preview/commercial reads | F `commercial-inspection.test.ts:135,149,171,186`: foreign IDs, wrong parents, stale binding, unscoped bots rejected | Covered |
| Attached credential retired before fork deletion | F `apps/api/src/hierarchy.ts:401–407`; `retire-project.ts:25–96`: disable, archive, revoke, clear secret | F `retire-project.test.ts:44,75`; `hierarchy.test.ts:476–520`: target only, shared refusal, retire before delete, failure stops delete | Covered; detached connection gap |

## Runtime route/tool inventory

A `server/mcp_pilot.py:404–427` enumerates 22 tools. All calls refresh the grant
at `:438`; reads require read, scaffolding requires scaffold/write, other writes
require write (`:445–461`). Minted PMs cannot create clients/buildings/projects,
rename/delete projects, or prepare locations; allowedTools alone grants no authority.
`create_work_package` and `update_intake_file` are permitted scoped scaffolding.
The first uses project checks plus transactional package creation (`:361–369`);
the second resolves the intake and validates destination package (`:189–216,467–471`).

Client/building/project lists filter the live principal's project (`:269–288`);
open-intake/get-intake/document-evidence reads resolve their actual project
before returning (`:307–348`). Remaining summary/package/issue/document/invoice/
change-order reads pass project/package ancestry checks (`:349–400`). Snapshot
assembly follows selected project → claims → vendors → packages, not owner-wide
aggregation (A `server/projects.py:291–325`; commercial query `agent_api.py:342–347`).

HTTP inventory: A `agent_api.py:85–164` location/hierarchy creation routes reject
project-bound grants via `owner_grant`/`write_grant` (`:53–82`); token revoke/mint
are owner-only (`:192–228`); clients/hierarchy/commercial and four intake routes
are covered above. Document preview independently checks project + project/client
owner before issuing bytes (`agent_preview.py:49–60`). Product routes use the
product admin actor, not a PM bearer (P `server/projects.py:378–438`). Fork user
navigation may show all projects in its bound client; it is not a PM-token endpoint.
No audited endpoint was found returning a different project merely from a supplied ID.

## Findings and smallest follow-ups

1. **High — project move retains old Space access (lifecycle risk).** P
   `server/projects.py:411–430` permits an owned project to change building;
   A `server/projects.py:444–463` likewise updates ancestry without token revocation.
   A `agent_tokens.py:37–45` authenticates only token liveness; MCP `project_access`
   checks project ID + owner, not original client/Space. Moving the same project
   to another owned client's building therefore leaves the original PM authorized.
   This is cross-client exposure through a stale PM, not a demonstrated foreign-ID bypass.
   Smallest fix: revoke project grants on ancestry changes and require explicit
   reprovisioning; test old MCP and HTTP grants after move. A `test_agent_hierarchy.py:96`
   tests changed owner/null ancestry, not move to another valid same-owner client.

2. **Medium — detached credential cleanup is missing on main.** F
   `retire-project.ts:29–34` discovers servers only through current assignments;
   detached managed servers/secrets survive retirement. Attached servers remain as
   disabled rows after secrets are cleared (`:81–96`), potentially obstructing
   binding changes (`space-client-binding.ts:84–99`). Fork [PR #33](https://github.com/dpbmaverick98/rakazo-qsight/pull/33)
   is OPEN at audit time; its stable-key discovery/removal is not merged evidence.
   Smallest fix: review/land that focused repair with detached/no-bot tests.
   Actual upstream project deletion removes agent token rows by FK CASCADE
   (A `server/migrations/0016_agent_tokens.sql:5`), so retained credentials are not
   reusable after successful deletion; interrupted retirement remains a risk.

3. **Medium — archive/recreate is not a clean one-manager lifecycle.** Generic
   archive retains credentials, assignments and spawn key (F
   `packages/adapters/src/child-bots.ts:301–358`). Repository create frees an archived
   key and inserts a new bot (`packages/db/src/repos.ts:619–635`), but provisioning
   rejects a server still assigned to the old bot (`project-manager.ts:149–160`).
   Thus recreation can conflict; a detached old credential can remain live.
   No project archive state/automatic revocation was found; package archive is different.
   Smallest fix: explicit managed-PM archive/reprovision policy and regression covering
   archived PM, old token, old assignment, retry and restore; retain conversations.

4. **Medium — legacy rolling-worker guard relies on display names.** F
   `project-manager.ts:71–79` identifies owner allBots servers by name prefixes.
   A renamed owner server escapes that guard; old workers ignoring inheritance
   could expose owner-wide tools. Current connector checks inheritance, so this
   is a mixed-version risk, not a bypass shown on current code. Smallest fix:
   gate legacy workers or identify owner authority by durable metadata, with rename tests.

5. **Low — display names still gate hierarchy parsing.** F
   `packages/adapters/src/qsight-hierarchy.ts:49–61` requires nonempty client/project
   names; missing display data rejects valid identities. Building names have a fallback
   (`:615–617`), but no-address fallback is “Building,” not “Address missing.”
   Same-name projects use distinct ID-derived slugs; unproven legacy name matches
   conflict rather than adopt (`project-manager.ts:125–169`). Smallest fix: tolerate
   null/empty display names with explicit fallbacks and test two same-name projects;
   coordinate any seam/schema change separately. No name-based project authorization found.

6. **Low — assertion gaps limit the exact claim.** Add focused cases for two
   distinct projects with identical names, saved explicit trustedTools on retry,
   real concurrent provisioning/promotion, archived PMs, and owner/ancestry changes
   across every route family. Current tests simulate races; uniqueness is per Space,
   so two Spaces can each hold a PM for the same project. No global singleton is promised.

## Named assertion anchors

- F `project-manager.test.ts:256`, “mints only server-side, encrypts credentials, attaches only the scoped server and returns no token”: exact bot name/key, inheritance false, exact assignment, no bearer in response.
- F `project-manager.test.ts:311`, “reuses scoped credentials and IDs, and repairs an older PM's assignments”: create called once, one server/secret/PM assignment, other bot assignment retained.
- F `project-manager.test.ts:398`, “repairs the spawn-key winner when another request creates it first”: same winner/server IDs and one assignment; mocked concurrency.
- F `project-manager.test.ts:506`, “promotes the same setup PM, preserves its conversation identity/history, and removes its owner connection”: same setup ID/thread, history retained, unrelated PM unchanged.
- F `mcp-connector.test.ts:3726`, “discovers only explicit assignments and rejects direct calls to an inherited owner server”: inheritance-disabled discovery/call denial.
- A `tests/test_agent_hierarchy.py:120`, `test_manager_token_requires_owner_write_and_is_project_scoped`: persisted `project_id=p`, scopes exactly read/scaffold, other-owner mint denied.
- A `tests/test_mcp_pilot.py:223,262`, `test_scaffold_token_creates_only_empty_packages` / `test_cross_owner_project_and_parent_reference_denials`: foreign project 403, wrong-parent package 404, only bound project listed.
- A `tests/test_agent_intake.py:151`, `test_cross_project_completion_is_denied`: foreign intake completion denied; `tests/test_agent_preview.py:68`, `test_authorization`: foreign token/document access denied.

## Validation and residual limits

- `corepack pnpm checks`: PASS, 57 tests.
- `corepack pnpm exec vitest run apps/api/src/project-manager.test.ts apps/api/src/retire-project.test.ts apps/api/src/hierarchy.test.ts apps/api/src/commercial-inspection.test.ts packages/adapters/src/qsight-hierarchy.test.ts packages/core/src/mcp.test.ts packages/adapters/src/mcp-connector.test.ts`: PASS, 7 files / 317 tests.
- Agent fixture-only command: `PYTHONPATH=/private/tmp/mcp-only:/private/tmp/seams-extra:/private/tmp/pm-agent-audit /Users/dpbmaverick98/bobthebuilder/vendor-one/.venv/bin/python -m unittest tests.seams.test_agent_intake_producer tests.seams.test_agent_intake_consumer`: PASS, 18 tests; no DB/runtime proof.
- `git diff --check` and `git diff --cached --check`: PASS.
- Setup: locked install required `--config.engine-strict=false` on available Node 25.2.1; scripts ignored. Initial focused run passed 78 tests but four suites could not load the missing Prisma client; after `corepack pnpm --filter @rakazo/db generate`, the full focused command passed. Root `db:generate` initially failed because bare `pnpm` was absent from PATH; direct filtered command succeeded after cache permission access. No database was contacted.
- Agent/product DB suites were inspected, not run: `tests/postgres.py:12–34`
  migrates/truncates; no disposable database identity was established for this audit.
- No live MCP/HTTP integration, deployed worker versions, production binding/RLS,
  external storage capability expiry, token inventory, or migrated FK state verified.
  No claim of complete race freedom or permanent isolation after manual configuration
  changes: the audit establishes the provisioning path and enumerated authorization checks.
