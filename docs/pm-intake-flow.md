# Project-manager intake flow

Status: agreed product flow and proposed transport. Implementation is not complete;
this document records decisions stated by the owner on 2026-11-16 and the seam
changes they require. QSight/Vendor One remains the authority for documents,
claims, money and approvals. Rakazo is the conversation and presentation layer.

## Decisions

- Project-manager creation is the Rakazo entry point for claims and sub vendors.
  The QSight UI/API keep their own creation paths; they are not blocked.
- A work package is the creation unit: claim + sub vendor + empty package. There is
  no claim-only object.
- A folder upload is one intake with many staged files; the package mapping is
  confirmed by a human. One document is an intake with one file.
- A human publishes from a trusted review card in the PM chat. The model never
  publishes, approves, edits money or grants authority.
- Change orders use the same upload path; the PM asks whether the order is already
  approved and QSight remains the approval authority.
- Space members may approve in principle. QSight currently authorizes its owner
  email only, so member approval needs an explicit broker/receipt design before it
  is enabled.

## Flow

1. The human drops one file or a folder in the PM chat. Rakazo keeps the bytes as
   chat artifacts; the PM replies that it will review them and asks no destructive
   questions yet.
2. The Rakazo API calls the QSight agent intake route for the bound project and
   receives one intake id, one staged-file id per file, and short-lived presigned
   upload URLs. Artifact bytes never travel through model text.
3. Rakazo uploads the bytes to those URLs, then calls the completion route per
   file. QSight verifies size and source identity and enqueues parsing,
   classification and extraction. Nothing is published or approved.
4. The PM reads intake status and proposals through the agent read route and turns
   the proposal into a review card: what each document is, the proposed claim/sub
   vendor/package placement, currency and parties, plus questions for anything
   ambiguous. Reads and preparation are pre-trusted; no write approval is asked
   for them.
5. The human confirms or corrects in the card. The PM sends the staged decisions
   back; QSight increments the interpretation revision, discards stale derivations
   and re-runs the affected work. Uncertain results stay uncertain; the PM lists
   them instead of guessing.
6. The human publishes from the trusted card. QSight materializes the selected
   destinations, documents and recorded facts. Publication does not approve change
   orders and does not mark review as complete.
7. QSight signals the change; the rail and the PM conversation refresh from the
   authoritative read. No polling.

## Authority and scopes

- The project-manager token is project-bound and currently carries `read` plus
  `scaffold`. `scaffold` is widened by this flow to mean "prepare": create an empty
  work package, stage intake files, and save staged review decisions for its own
  project. It never authorizes publication, approval, money edits, rename, delete,
  hierarchy creation, or location preparation.
- Intake reads use the same project-bound token. The agent routes re-check the
  token's project, the project's owner and the binding on every call, and return
  only that project's intakes.
- Publication requires a human approval receipt minted by the Rakazo server from a
  real user action, bound to actor, Space, project, binding revision, intake
  revision, selected destinations and payload hashes. The model cannot mint or
  reuse it. Whether QSight accepts a Rakazo member as the approver or keeps the
  owner-email boundary is an open security decision; until it is recorded, publish
  stays owner-level.

## Seam changes

- New versioned `agent-intake` contract in the agent plane: request/response schemas
  and fixtures for create, upload completion, status/review read, and review save.
  Producer tests in the agent plane, consumer tests in the fork adapter, both
  isolated against the fixtures.
- Extend the project-manager token docs and tests: `scaffold` includes intake
  staging and staged review save; publication and approval remain outside it.
- No changes to the existing intake/publish command semantics. The agent routes
  call the same reservation, completion, review and publish code paths; they do not
  create a second document store or bypass revision checks.

## Limits and failure behavior

- Reuse existing intake bounds: 500 files / 2 GiB per intake, per-file size limits,
  content-type checks, image and OCR caps. Report the exact bound in the UI rather
  than failing silently.
- Idempotency: one intake key per send; retries reuse it. A changed payload with the
  same key conflicts; inspect before retrying.
- Staging completion is one durable bot message per send, keyed by
  `project.intake.stage:<idempotencyKey>` within the thread. Its text is
  "Staged N file(s) for review"; the existing send-time staging note remains.
  The text block's existing `inspectionContext` contains JSON of the form
  `{ "intakeReceipt": { "intakeId": "…", "intakeRevision": 1, "projectId": "…", "fileCount": 2 } }`.
  This fixed-field receipt uses the create/replay response's intake revision;
  it is a staging snapshot, not a claim that parsing or review has completed.
  No upload URLs, storage keys, source bytes, tokens or per-file payloads are stored
  in the receipt. The upstream response supplies no staging timestamp, so none is
  invented.
- Recovery: message blocks and the matching event commit together under the thread
  lock. A replay finds the same nonce and leaves that message and context intact,
  including after a missed realtime notification. A retry before commit reuses the
  upstream intake idempotency key. The normal thread history read restores the
  receipt into model context, so the PM can read that intake by id without relying
  on the newest-20 `list_open_intakes` window. Read current status/revision before
  preparing subsequent decisions; the receipt does not grant write authority.
- Partial uploads: completion is per file; failed or missing uploads stay visible
  and retryable. A folder send is not "done" until every file is complete or
  explicitly removed.
- Cancel and source retention follow the existing intake behavior; no new cleanup
  promise is implied.
- Duplicate documents and revisions keep their current QSight rules; the PM asks
  about possible duplicates instead of replacing files.

## Slices

1. Agent intake routes: create (files manifest + presigned URLs), complete, status
   and review read, review save. Contract, fixtures, producer tests, scope checks.
2. Fork adapter and API bridge: artifact bytes to presigned URLs, completion, status
   read, typed errors; no UI yet.
3. PM review cards and the conversation instructions (one question at a time, no
   writes without an approval card).
4. Trusted publish card and receipt; owner-level boundary first, member approver
   only after the security decision lands.
5. Change-order upload question and approved-state read.
6. Rail/auto-refresh wiring for intake and publication signals; screenshots and
   keyboard review.

## Non-goals

- The model publishing, approving, editing money or acting as the owner by name.
- A second document store, a background bridge service, or a model-side OCR path.
- Claim-only records, silent package creation on publish, or automatic duplicate
  replacement.
