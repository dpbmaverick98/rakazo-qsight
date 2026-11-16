# UI invariants and intake-flow test checklist

Purpose: earliest manual test of the Rakazo agent UI against
[agentic-ui-invariants.md](agentic-ui-invariants.md) and the PM intake flow.
This is a test script, not a claim that every item already passes. Mark each
row Pass / Fail / Blocked and attach a screenshot for failures.

## Before you start

- [ ] Dev stack is the build you intend to test (record branch/commit).
- [ ] You are signed in as a Space owner/admin who can bind a client.
- [ ] The project manager was **created** after the `read+scaffold` change.
      Re-running provisioning for an existing manager reuses its managed credential
      (`apps/api/src/project-manager.ts`), so it does **not** upgrade an older token;
      create a new project/manager for testing if the current one predates the change.
- [ ] The API worker has `QSIGHT_*` base URL/token settings, or staging will fail
      with a typed unavailable error (that is itself a check).
- [ ] Use a disposable project; do not test on working commercial data.

## A. Selection and hierarchy (INV-UI-01, 02, 13, 14)

1. [ ] The sidebar lists clients; each client expands/collapses and never opens a
   generic client chat.
2. [ ] A client with no building shows an explicit empty hierarchy, not a fake
   project.
3. [ ] The client 3-dot menu offers New building, New project, and delete only
   when allowed.
4. [ ] New project with multiple buildings asks for a building; with one building
   it is preselected. Creating a building first and continuing works.
5. [ ] Selecting a manager selects client + building + project together; middle
   chat and right rail switch together.
6. [ ] The same manager never appears under two buildings/projects after refresh.
7. [ ] An assigned manager reads `{Project} - PM`; the setup manager becomes
   permanent and keeps its history (INV-UI-13).
8. [ ] A building is visible with no manager; the right rail shows building
   identity but no project tabs/claims.

## B. Right rail (INV-UI-03, 04, 05, 06, 11, 12)

9. [ ] Default tabs are Project space then Claims. No empty Sub vendors tab before
   a selection.
10. [ ] No create/edit/delete/upload/publish/approve controls anywhere in the rail.
11. [ ] No outbound record links. Vendor One is not opened from inside the rail.
12. [ ] Project space: large client name, pastel static map with one marker and
    attribution, building icon + one name, address only if different.
13. [ ] The map does not pan/zoom; keyboard/touch zoom and controls are absent.
14. [ ] The selected project is expanded; other projects at the building are
    collapsed but selectable, and clicking one does not change the active manager.
15. [ ] Claims shows only the selected project's claims and claim-level Proposed,
    Breakdown, Invoices and remaining/position figures.
16. [ ] Selecting a sub vendor opens/activates the Sub vendors tab for that claim +
    sub vendor; the PM context records claim/sub vendor selection.
17. [ ] Sub vendors shows Proposal/Breakdown/Invoices file groups with role, amount
    when known, and status. Clicking a file opens a read-only preview tab.
18. [ ] Closing the preview returns to Sub vendors on the same selection.
19. [ ] No raw storage keys, signed URLs, document text or UUIDs are shown.
20. [ ] Narrow layout collapses the rail without changing the selection model.

## C. Explicit states and copy (INV-UI-07, 08, 09, 10)

21. [ ] No manager selected: left lists clients, middle shows select-a-manager,
    right is closed/empty with no project tabs.
22. [ ] Loading a manager shows deterministic skeletons; another manager's data
    never flashes.
23. [ ] QSight unavailable shows a plain unavailable state with retry; last known
    client/building identity is kept but no numbers are invented.
24. [ ] Map failure leaves building/project navigation usable and shows a neutral
    placeholder, not a broken container.
25. [ ] Stale binding/removed project shows a recoverable unavailable state, not
    another client's data.
26. [ ] Unknown tab/artifact kind is inert; no raw HTML or JSON is rendered.
27. [ ] Copy uses client, building, project, claim, sub vendor, work package,
    proposal, breakdown, invoice, change order; no tool names/IDs/provider names.
28. [ ] Creating a building/project/claim from chat updates the rail without a
    manual reload and without stealing the active tab.

## D. Intake flow (the first thing to test)

Use one PDF plus one folder (two or three files).

1. [ ] Drop/send the files in the selected PM chat. The message appears and the
   chat shows the staging note ("being staged").
2. [ ] Staging succeeds: one bot receipt appears with "Staged N file(s) for
   review". Open the message/context (or the PM follow-up) and confirm the
   receipt carries `intakeId`, `intakeRevision`, `projectId`, `fileCount`.
   - No upload URL, storage key, source bytes, token or per-file payload is
     visible in the message or UI state.
3. [ ] Re-send/reload/reconnect: the receipt is the same message (no duplicate),
   and the PM can still name the intake id.
4. [ ] The files appear in QSight as an **open** intake; nothing is published.
5. [ ] The PM reads the proposals: role/function, claim/sub vendor/work, currency,
   readiness. Ask "what did you stage?" and confirm it names this intake and its
   files, not another project's.
6. [ ] Ambiguity: make the PM ask a clarifying question for an uncertain role or
   placement. Answer it. The PM applies one correction via one approval, then
   reports it as **staged**, not published.
7. [ ] Re-read the intake (`get_intake`): the saved decision reflects the
   correction and `review_revision` increased; the original proposal is still
   distinguishable.
8. [ ] In QSight's review UI, the same saved decision is present. Nothing was
   published or approved by the chat.
9. [ ] Change order check: upload a change-order-looking document; the PM asks
   whether it is already approved, accepts "printed approval is evidence only",
   and says publication would leave it draft.
10. [ ] Failure check: temporarily break the worker QSight setting; send a file.
    The chat shows a typed staging failure with a retry/recovery hint, no
    fabricated "staged" success and no duplicate intake on retry.
11. [ ] Limit check (expected current bridge): 11 files or >48 MiB per file or
    >64 MiB total is rejected clearly; the folder path is flattened in the
    staged filename. Record whether this is acceptable for the test project.

## E. Boundaries (do not mark pass if any is violated)

- [ ] No chat/tool path publishes or approves; writes use one explicit approval.
- [ ] If corrections/package creation fail with permission denied, stop and confirm the
      manager token has `read+scaffold`; a pre-change manager is a blocked test, not a UI bug.
- [ ] Publication remains a human action in QSight (trusted card not built yet).
- [ ] No cross-project/cross-client data in tabs, receipts, tool results or logs.
- [ ] Existing PMs are not silently upgraded; reprovisioning is explicit.

## Known gaps to record, not fail

- The trusted publication card in chat is not built; publication is still a
  QSight-owner action.
- Space-member approval is not enabled; owner-only publication is the current
  boundary.
- The chat bridge accepts 10 files / 48 MiB each / 64 MiB total and flattens
  folder paths; QSight itself accepts 500 / 2 GiB.
- Free-text clarification notes are not carried into QSight's saved review;
  corrections are structured fields today.
- No push signal from QSight into the rail; the rail re-reads on focus/signals.

## Evidence to capture

For each failure: step number, expected vs actual, screenshot, browser console/API
response if visible, project/intake id if safe to share, and whether it reproduces
after a hard refresh.
