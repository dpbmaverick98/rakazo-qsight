# Right rail tabs

Status: proposed design; documentation only. Scope: Rakazo web and its Electron
host, including the management hierarchy. No native mobile stage, deployment,
provider integration, new renderer, or competing stage implementation in this pass.

## Evidence and recommendation

Use one tab strip and one active stage inside the existing resizable right region.
Hierarchy is the first, pinned default tab. Files, commercial tables, summaries,
and timelines are typed content in the same stage infrastructure, opened only when
needed. Preserve existing system panels through that infrastructure. Remove the
current hierarchy-above-details split when tabs land; do not add a third navigator.

Research inputs, pinned for reproducibility:

- `origin/main` at `e2596664a64ccdce7ab32944db2d858a1e591e2b`: `Panel` and scoped
  layout storage in `apps/web/src/lib/right-panel-state.ts`, `use-right-panel.ts`,
  and `ShellSidePanel` in `apps/web/src/pages/shell/side-panel.tsx`.
- Artifact seam PR #22, `origin/feat/artifact-stage-seam` at
  `169372e02ca9db4fe7588186b4b5a8df854ba838`: shared `StageArtifact`, exact
  kind/version registry, document-list renderer, history selector, fallback, and
  dev fixture. Its `publishStage` always selects `artifact-stage`; changing chats
  clears its in-memory history. It intentionally persists no stage payloads and
  has no real agent publication endpoint. See [artifact seam](artifact-stage.md)
  after that branch merges.
- `feat/live-hierarchy-stage`: inspected its uncommitted working diff against the
  same main commit. `hierarchy-refresh.ts` coalesces invalidations after completed
  tools, terminal run events, and waiting-for-input events in both bot and group
  streams. The hierarchy contains building addresses, a lazy map, projects,
  commercial/package selection, and PM actions. This is a moving input, not an
  immutable merge candidate; inspect its final committed diff again before coding.
- Installed Harness runtime package reports `0.2.2-rc.1`. Inspected archive members
  `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/{README.md,lib/client.js}`,
  the equivalent `sidebar-files` and `sidebar-documentpreview` members, plus
  `dsh-tool-present` and `dsh-client-ui-deliverables`. Read selected members into
  a temporary research directory; the installed archive and unpacked resources
  were not modified. The unpacked-resource file search found no separate UI source
  outside dependencies. No proprietary source or resource copy belongs in this repo.

### Harness pattern: observed in bundled code, not a live UI walkthrough

The bundle documents and implements one right-side docking surface per session,
with a tab-type registry and separate tab identity/navigation/lifetime. It saves
layout, selection, and resource identities in validated local storage; resource
contents and connections belong to the providers. Undo history is memory-only.
Tabs can retain visited bodies across switching without eagerly mounting every
body. Its top edge is the tab strip, including collapse controls, rather than a
second panel header. Files navigation delegates placement to its containing tab:
a file browser can open a new preview, while a preview can navigate in place.
Document previews have a separate extension/renderer registry, reinforcing that
tab placement and content interpretation are different responsibilities.
Deliverable declarations record file references rather than copying file bodies.

Borrow session isolation, explicit open versus navigate/update, one strip, stable
identity, validated restore, and renderer-owned resource reads. Treat conversation
output as a producer of stage references, not something to parse for tab commands.
The user's report that the stage evolves with conversation is consistent with
these seams, but this research does **not** establish live automatic-focus timing,
agent tab commands, or current hosted Web UI behavior. No live session was opened,
no authenticated content captured, and no visual or accessibility audit was run.

Avoid importing its docking kit, split tree, floating windows, layout undo log,
plugin discovery, guide page, host filesystem addresses, or its general HTML
preview policy. The latter exceeds this metadata-only seam. Rakazo needs one stage,
not a desktop workspace manager. Unlike Harness's initially collapsed default,
show Hierarchy first for an eligible bound client scope. Keep unbound Spaces usable:
retain existing system controls, without manufacturing a client or showing a
permanent unavailable Hierarchy tab.

## State, transitions, and focus

One controller owns `{ layoutVersion, tabs, activeTabId, collapsed }` per existing
`user + Space + bot/group + target` chat key. This deliberately follows today's
conversation scope, not an agent run. `tabs` is ordered; Hierarchy has stable ID
`system:hierarchy`, always index zero when eligible, cannot close or move. All other
tabs can close, reorder, and reopen. Collapse hides the region without closing tabs.
A missing preference selects Hierarchy when eligible; otherwise use today's closed
system-panel default. A saved collapsed preference wins over new data.

| Intent | State transition | Selection and keyboard focus |
| --- | --- | --- |
| Enter chat | Restore validated scoped layout; reconcile eligible tabs | Restore selection; leave composer/navigation focus alone |
| User opens resource/system panel | Reveal matching tab or append one; expand rail | Select it; place focus on tab trigger, unless an existing explicit action targets a form field |
| Agent explicitly opens resource | Idempotently reveal/create in its owning chat | Select and expand only in the foreground owning chat; keep DOM focus in composer/input |
| Producer updates resource | Replace same artifact ID with a higher revision | Never select, expand, reorder, scroll, or recreate a closed tab |
| User switches tab | Set active ID | Normal tab keyboard behavior; preserve content selection/scroll |
| Close inactive tab | Remove tab, release its resources | Keep active ID and focus |
| Close active tab | Remove; select left neighbor, otherwise Hierarchy/first eligible tab | Focus surviving trigger if focus was in removed content; never steal outside focus |
| Reorder | Move non-pinned ID in ordered list | Active ID unchanged; focused trigger retained |
| Collapse / reopen | Change visibility only | Collapse returns rail-owned focus to opener; reopen restores active tab |
| Permission/binding loss | Invalidate protected data and remove ineligible tabs | Choose eligible neighbor; never retain stale protected body |

Distinguish selected content from DOM keyboard focus. An agent may explicitly
change the visible stage without interrupting typing. Passive PM completion,
refresh, reconnect, snapshot replay, and artifact revision updates never select a
tab. An agent update must name a tab/resource; resolve “active tab” at authorized
command acceptance, never later after a user switches. Updating another tab needs
an explicit target. A late completion from chat A must not publish into chat B.

An explicit open has a unique command ID and captured chat ID. Consume its reveal
once in that foreground chat. Replayed events only refresh data; they do not reopen
closed tabs. Background-chat opens are available in that chat's resource switcher,
but neither navigate the user there nor select a tab on later entry. If a user
switches/closes/collapses after a command was accepted and before it arrives,
preserve that newer local intent: compare a captured local interaction generation.
No wall-clock race arbitration. Store the consumed command cursor with the layout;
on first restore establish a snapshot baseline rather than replaying old opens.

Use existing `Tabs` primitives from `packages/ui-web/src/components/ui/tabs.tsx`.
Support arrows, Home/End, visible focus, named close controls outside tab buttons,
and a menu action to move left/right so drag is never required. Pointer drag may
follow later. Overflow goes to one tab switcher; never shrink close/collapse
controls out of reach. Keep short labels, semantic tokens, ink/gray selection,
and no persistent stage explainer or duplicate title above the content. At narrow
web widths reuse the existing responsive panel behavior and verify chat access.
Do not invent a second mobile navigation system.

### History and lifecycle

Open tabs are not artifact versions and are not transcript history. The strip and
its overflow menu replace PR #22's open-artifact history selector; do not show both.
Keep a bounded resource switcher for reopening known authorized artifacts, including
closed ones. Updates retain identity and order; they do not append another tab or
another history item. Explicit version history is deferred until a real producer
supplies immutable versions. Closing a tab never deletes a document.

Renderer data lives in authorized queries keyed by resource and scope. Persist
selection/scroll or unsaved edits in the existing resource owner where needed;
do not promise that an unmounted form preserves a draft. First slice keeps the
existing BotSettings subtree and navigation behavior intact. Later extraction must
verify dirty-form behavior. Stop computer input, preview effects, and other costly
visible-only activity when hidden; closing cancels tab-owned requests. Collapsing
is not resource deletion. Do not keep all chats' computers or maps mounted.

## Versioned seam

Extend PR #22, do not fork its descriptor or registry. Proposed shapes below are
contracts to implement in the next stack, not a new schema committed by this note:

```ts
// Local layout v2; references only, no artifact payload or title cache.
type StageTab =
  | { id: string; source: "system"; panel: NonNullable<Panel>; routineId?: string }
  | { id: string; source: "hierarchy" }
  | { id: string; source: "artifact"; artifactId: string };
// StageArtifact from PR #22 remains { id, kind, schemaVersion, title, subtitle?, payload }.
// Persisted publication wraps it with authorized chat scope and monotonic revision.
// Open/update intent is separate: { commandId, chat, artifactId, operation, revision }.
```

The local `Panel` union is transitional: do not export UI settings panels as agent
capabilities. Contract schemas for resource publication and allowed intents live
in `packages/contracts/src/artifact-stage.ts`; frontend layout/system-panel types
stay in `apps/web/src/lib/right-panel-state.ts`. Only the consumer can create system
or Hierarchy tabs; agent producers can reference registered artifact capabilities.
Routine and group settings keep their exact entity targets. Create-group and
import-agent remain ephemeral system stages, excluded from durable restore.
Hierarchy data continues through its existing validated contract and RPC; its tab
holds no copied tree. Files/Documents initially means the existing `document-list:1`
metadata renderer, not a new file explorer or a new document type.

`ArtifactStageContent` remains the rendering boundary. Registered exact
`kind:schemaVersion` pairs validate their payload before invoking a renderer.
Hierarchy and system content are trusted application components with scoped props,
not arbitrary serialized JSX. Future `commercial-table`, `project-summary`, and
`timeline` descriptors carry entity IDs and bounded view options; renderers read
canonical data. Extract `CommercialSelection` only when its producer lands; do not
serialize table cells or project descriptions into layout storage.

Producer: authenticated backend service/tool, validating chat membership, Space
scope, resource access, size, and supported producer schema before committing a
descriptor. Consumer: web shell/Electron, validating the envelope again, selecting
an exact renderer, and independently authorizing each read through normal RPC.
Use the canonical `SpaceClientBinding` ID for hierarchy authority; names never bind
clients. Recheck permissions at command execution and content retrieval.

Three versions are independent: layout version (local preferences), artifact
`schemaVersion` (payload interpretation), and resource revision (freshness/order).
Update only a matching resource at a greater revision; equal replay is a no-op,
older revisions cannot roll back content. Changing kind/version is an explicit
replacement requiring validation, not a guessed payload conversion. Breaking
payload changes require a new version and old-reader fallback; additive changes
must respect the existing strict schemas. Register old/new renderers during rollout
when both must work. Never select a renderer by title, provider ID, or payload sniff.

Unknown kinds/versions keep their tab identity and show PR #22's fixed unsupported
fallback; never print JSON or unknown payload fields. Known-but-invalid payloads
show unavailable content, isolated from other tabs. Invalid outer envelopes are
rejected before publication/restore. A deleted reference shows unavailable content
without cached title/body; a revoked scope removes its protected tabs entirely.

### Persistence and live transport

First slice: local layout preferences under a new v2 scoped key, plus in-memory
validated artifacts per chat. Reload remembers tab references and active selection;
Hierarchy/system content rehydrates normally. A dev-fixture artifact reference with
no durable source shows unavailable after reload. Be explicit that this slice does
not deliver persistent agent artifacts or cross-device layout sync.

Next slice: store canonical descriptors and revisions on the server alongside the
owning chat, separate from existing file-byte storage in `apps/api/src/artifacts.ts`.
Snapshot RPC returns current authorized metadata and command cursor. Commit the
publication before sending a content-free signal on the existing narrow live
notification topic; re-read through RPC. Reconnect and window focus catch up through
normal reads. No second stream, payload-bearing notification, timed refresh, or
polling fallback. Use existing publish retries/stream failure behavior. The PM
hierarchy refresh remains an invalidation path, never a tab-open producer.

Local layout remains per device/window; server artifact access does not imply
server-authoritative user focus. Start with last saved layout on reload; do not
live-synchronize selections between windows. Persist no payload, file bytes,
credentials, document text, or unsaved forms in layout preferences. Clear scoped
in-memory data on logout/scope loss and follow existing account cleanup for keys.

## Reconcile and merge

Recommended order: merge PR #22, then the finalized live-hierarchy branch, then
rebase the tabs slice onto both. The two prerequisite branches can land in the
opposite order if needed; tabs must start from their combined result. Do not cherry
pick their implementations into this design branch.

Expected shared edits are `apps/web/src/pages/Shell.tsx` and
`apps/web/src/pages/shell/side-panel.tsx`. Resolve by retaining artifact props and
renderer dispatch from #22, and current hierarchy scope/query/retry/PM behavior
from the hierarchy branch. Afterward deliberately replace the stacked hierarchy
layout with one selected tab body. Preserve lazy map loading, canonical hierarchy
selection, PM actions, and both bot/group refresh paths. `use-right-panel.ts` and
`right-panel-state.ts` must have one owner after integration: no parallel stage
state plus independently selecting Panel state.

Before merging hierarchy, remove its observed `refetchInterval` five-second retry
for empty/error data. It violates the no-client-polling rule. Verify initial read,
stream reconnect, window focus, and committed hierarchy-change signals cover empty
to populated state, including changes from another chat/session. Completed-tool
invalidation alone cannot cover external writes. Also inspect its final handling
of 401 retries and stale protected data: authorization failures must not preserve
previous-client data or retry as ordinary availability recovery. These are merge
conditions to resolve in that branch, not changes made during this research pass.

For local migration, only adopt a v1 preference when no v2 key exists. Convert a
saved durable panel into a system tab after Hierarchy, retaining routineId and
existing deep-link precedence. Saved `panel:null` maps to collapsed=true; a missing
key uses the new default. Missing routine falls back to Routines after its list
loads, just as today. Never restore ephemeral forms or PR #22's transient stage
payloads. Invalid v2 data resets only that chat to a safe default; a future layout
version is ignored and left intact. Leave v1 keys intact for old clients/rollback;
v2 writes do not rewrite them. Storage denial leaves the current in-memory session
usable. No DB migration is needed for the first slice. Later descriptor tables are
additive and optional for old API/workers; do not change existing event shapes or
file storage semantics to require the new consumer. Mobile retains attachments and
existing hierarchy workflows; it receives no executable stage command.

## Concrete stack and acceptance tests

All test names below are proposed additions unless identified as existing. Keep
these PRs separate; no speculative renderers or new dependency in the first slice.

### 1. Minimal immediately landable slice: one tabbed shell

After both prerequisites merge, implement local scoped layout, pinned Hierarchy,
open/select/close/reorder via menu, and existing system/artifact rendering. Keep
`publishStage` as a compatibility wrapper for the dev fixture that explicitly opens
artifacts; distinguish passive updates internally. No real agent endpoint yet.

Exact files:

- Extend `apps/web/src/lib/right-panel-state.ts` and `.test.ts` with v2 validation,
  migration and pure transitions. Add cases `defaults to pinned hierarchy in a bound
  scope`, `restores closed v1 state without reopening`, `migrates routine target`,
  `rejects duplicate tab IDs and invalid active IDs`, `ignores future layout versions`,
  `closing active tab selects its left neighbor`, and `cannot move hierarchy`.
- Update `apps/web/src/pages/shell/use-right-panel.ts`; add
  `use-right-panel.test.tsx`: `restores tabs independently for bot and group chats`,
  `late updates stay in their captured chat`, `passive updates do not reveal a closed
  tab`, `explicit open reveals once`, and `user selection wins over a late open`.
  Extend the existing storage-unavailable test to cover layout writes.
- Add `apps/web/src/pages/shell/stage-tabs.tsx` and `stage-tabs.test.tsx` for the strip,
  overflow and keyboard/menu interactions. Cases: `switches by keyboard`, `close
  returns focus to surviving trigger`, `agent reveal preserves composer focus`,
  `moves a tab without drag`, and `overflow keeps the active tab reachable`.
- Update `apps/web/src/pages/shell/side-panel.tsx`, `side-panel.test.tsx`,
  `artifact-stage.tsx`, `artifact-stage.test.tsx`, and `apps/web/src/pages/Shell.tsx`.
  Reuse `ArtifactStageContent`; remove duplicate stage header/history controls in
  the tabbed host. Cases: `renders one stage body`, `system panels remain reachable`,
  `unknown kind and version render only fallback`, and `hidden computer cannot
  receive input`. Preserve BotSettings' internal tabs for this slice rather than
  duplicating their forms; extract them only in a later focused PR if needed.
- Update `apps/web/src/pages/shell/artifact-stage.fixture.ts` and existing
  `apps/web/e2e/fixtures/artifact-stage.tsx`; do not add a shared runner or fake service.
  Update `apps/web/e2e/artifact-stage.spec.ts`'s existing `artifact stage switches
  history and closes` to `artifact tabs switch close reorder and restore`.
  Update `apps/web/e2e/hierarchy.spec.ts`'s existing `client hierarchy shares the right
  region with chat details` to `hierarchy is the default tab beside chat`.
  Cover narrow width, long labels, keyboard close, reload, and a passive refresh
  while another tab is selected. Preserve `hierarchy-rail.test.tsx`,
  `project-commercial.test.tsx`, and `use-thread-sync.test.tsx` coverage from the
  prerequisite branch; tab selection must not reset PM data.

This is the recommended first slice: useful default Hierarchy plus reversible
user-controlled tabs, built from merged renderers. Its explicit limitation is that
artifact persistence and production agent publication await slice 2. Do not claim
that the dev fixture is an agent integration.

### 2. Durable artifacts and explicit agent intent

Extend `packages/contracts/src/artifact-stage.ts`, `artifact-stage.test.ts`,
`rpc.ts`, and `index.ts`; add `apps/api/src/stage-artifacts.ts` and
`stage-artifacts.postgres.test.ts`, register authorized methods in
`apps/api/src/routes/threads.ts`, and add an additive descriptor model in
`packages/db/prisma/schema.prisma` with its ordinary generated migration. Confirm
final route and notification composition against merged main before editing.
Add the tool definition in `apps/api/src/stage-artifacts.tool-definition.ts` and
keep execution/authorization in the service; update nearby prompt files only if
instructions are necessary. Wire snapshot reconciliation in
`apps/web/src/pages/shell/use-thread-sync.ts` and the one right-panel controller.

Tests: `publication cannot cross Space or chat scope`, `binding requires current
owner or admin`, `duplicate command is idempotent`, `older revision cannot overwrite`,
`commit signals a metadata re-read`, `reconnect catches a missed signal`, `replay
never reopens a user-closed tab`, and `background chat cannot change foreground
selection`. Add deterministic offline tool/service tests and Postgres authorization
coverage. Require the same safe fallback contract under an older consumer.

### 3. Real resource tabs, one producer at a time

Start with Files/Documents backed by existing artifact IDs; extend the registry
and its tests in `apps/web/src/pages/shell/artifact-stage.tsx` and `.test.tsx` only
when authorized metadata retrieval exists. Then extract a commercial renderer from
`apps/web/src/pages/shell/project-commercial.tsx`, preserving its query and
`project-commercial.test.tsx`. Add schemas and contract tests in
`packages/contracts/src/artifact-stage.ts` for each actual payload. Summaries and
timelines are later independent PRs with real producers, not empty tabs added now.
Each must test resource deletion/revocation, passive revision updates, and
cross-chat isolation. File preview/download remains on existing authorized paths;
no generic HTML renderer or desktop host-file opener is part of this stack.

Verification for implementation PRs: focused Vitest files above, appropriate type
checks, Biome, and `pnpm checks` before pushing. Let CI run web/Electron E2E; do not
launch focus-stealing Electron tests locally. Embed the relevant CI screenshots in
UI PR descriptions. Review actual screenshots with
[ux-declutter](../.agents/skills/ux-declutter/SKILL.md), including empty, loaded,
overflow, unsupported and narrow states; perform keyboard, zoom and screen-reader
smoke checks. Quote any new visible copy and justify why it must be visible in the
PR description. This documentation pass has no rendered UI to screenshot.

## Security, limits, and unresolved decisions

Carry forward #22's 160-character labels, 50-document list limit, and 20-artifact
bound. Propose at most 20 total open tabs including Hierarchy/system tabs, 20 recent
resource references, 16 KiB per descriptor, 128 KiB per snapshot, and maximum JSON
depth 8. These are proposed admission limits to test, not existing guarantees:
#22's `z.json()` alone does not bound unknown payload size/depth or exclude secrets.
At capacity, reject an agent open without changing focus or evicting user tabs;
return a structured limit result. User opens offer closing a tab; updates to an
existing tab remain allowed within payload limits. Page larger metadata lists.

Use per-kind allowlists at the producer boundary. Never accept arbitrary JSON from
an agent just because the envelope parses; unknown payloads are retained only from
trusted, bounded versioned producers for forward compatibility. Do not log payloads
on validation failure. IDs and titles are untrusted plain text; do not render
Markdown, URLs, HTML, commands, credentials, hidden instructions, or document bodies
from descriptors. Content access is separately authorized; possession of a tab ID
or artifact ID grants nothing. Cap local storage reads before JSON parsing. Keep
external services optional and their SDK/configuration inside adapters. No new
vendor name enters product contracts, routes, copy, or settings.

Risks and decisions still requiring product/implementation review:

- Scope: today's key is bot/group, not an individual run. If multiple independent
  chats per bot become real, migrate to canonical chat IDs before promising isolation.
- Cross-device tab sync is deferred; confirm local preferences are sufficient.
  Durable resources and access checks still belong on the server.
- Agent reveal is allowed only for an explicit validated open; confirm this visible
  change while retaining composer focus matches expected behavior. Ordinary PM
  writes must remain update-only.
- Hierarchy eligibility depends on a real canonical binding. Binding removal,
  external writes, empty-to-populated recovery and authorization errors are the
  highest-risk integration cases; review the final hierarchy branch again.
- Existing nested BotSettings tabs are a deliberate first-slice compromise. Removing
  that second-level navigation requires a focused form/lifecycle extraction, not
  a parallel copy of its settings forms.
- Dirty forms and computer sessions have real lifecycle costs. Establish existing
  close/save behavior before migrating any of them to independent long-lived tabs.
- A reload can restore a reference before its resource loads. Keep an unavailable
  or loading body without silently changing selection; explicit authorization loss
  is the exception. Never fill the gap with cached sensitive content.
- No live Harness walkthrough or proposed Rakazo screenshot was available in this
  pass. Bundled implementation supports the architectural comparison; interaction
  quality and final density still need rendered verification during slice 1.
