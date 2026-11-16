# Trusted publication from the PM chat

Status: proposed; no runtime changes or deployment. **Verified** means inspected source, not production
behavior. All other sections propose behavior, including routes and wire fields. Graphify evidence was absent;
this design uses source inspection.

## Verified baseline

- [Agreed flow](pm-intake-flow.md#authority-and-scopes): prepare in chat, publish by human card; Space member
  approval is accepted in principle, not yet authorized. Publication records documents/facts; it neither
  approves changes nor completes review.
- [Chat invariant §3](agentic-ui-invariants.md#3-middle-chat) and [boundary
  §8](agentic-ui-invariants.md#8-security-and-boundaries) require explicit writes, coherent project context,
  and no credentials in chat or UI state.
- [Binding access](../apps/api/src/space-client-binding.ts#L15) checks membership; binding management
  additionally requires owner/admin. [Hierarchy](hierarchy.md#L12) does not grant publication permission.
  Canonical binding IDs, never Space names, select the external client.
  [Inspection](../apps/api/src/commercial-inspection.ts#L28) resolves selection server-side and rechecks it
  under locks (#L78).
- The requested `apps/api/src/project-intake.ts` is absent on this base. Staging is [adapter
  code](../packages/adapters/src/project-intake-staging.ts#L25); [thread
  send](../apps/api/src/routes/threads.ts#L181) enqueues attachment staging. Neither is approval evidence;
  existing send replay keys must not become publish keys.
- External source references below use repository-relative paths, with no private origins. Agent-plane
  snapshot: `25cc11ba75118c9e2977a825a835570efe6a010f`; product snapshot:
  `fd9cc1bb395af54d7ada9e367f4edc63124e9ea0`. Agent plane `docs/agent-intake.md:8–28`,
  `contracts/agent-intake/` and `contracts/seams.json`: **agent-intake v1.0.0**, in review, freezes
  create/view/completion, not review requests or publication. `server/agent_api.py:366–456` checks project
  tokens and exposes staging/read/review save, no publish route. `server/agent_tokens.py:18–45` stores hashed
  read/write/scaffold grants.
- Product `server/intake.py:108–112,320–372,704–710`: publish takes intake/review revisions and selected file
  IDs; owner-authorized session, idempotency receipt, context check, package/file locks, facts readiness and
  saved decisions precede materialization. `server/work_setup.py:58–86` hashes commands and stores results.
  `docs/invariants.md` (Security and ownership; Providers and untrusted content) and `AGENTS.md` preserve
  owner resolution, human authority and untrusted sources. An owner-scoped service token is not proof that its
  caller is that human.

## Proposal: authority and options

Threats: injected documents/model output, forged cards, guessed IDs, cross-Space selection, stolen/replayed
receipts, changed bytes/reviews/destinations, double clicks, concurrent QSight edits, lost responses and
revoked membership. Trust the session service, fork API signer, configured verifier and product transaction;
compromise of those or the human's authenticated browser is outside this boundary. No protocol can prove
physical intent against a compromised browser.

| Option | Authority and member mapping | Audit/replay | Failures and operating cost |
| --- | --- | --- | --- |
| (a) Receipt-consuming agent-plane route | Separate server identity plus signed human intent; QSight explicitly delegates a binding to member subjects | QSight records actor and consumes receipt atomically with publication | New verifier, key rotation and delegation policy; fail closed on skew/revocation/unavailability |
| (b) Fork broker with owner write token; internal receipt | Broad owner power in broker; a member would act through owner authority unless QSight changes policy | Internal click ledger plus product command key; QSight otherwise sees owner only | Less protocol work but larger credential blast radius; broker bugs can publish without verifiable human provenance |
| (c) QSight-hosted publish UI/redirect | QSight login and existing owner check; members need QSight accounts/roles | Existing product receipt; signed return state only correlates navigation | Lowest new authority cost, extra login/navigation; abandoned/expired redirects and edits require re-review; not publication inside chat |

Recommend (a): product verification enforces the human boundary, rather than trusting the broker's use of a
broadly writable owner credential. Do not ship (b) as a shortcut. Use (c) as an explicit owner-only fallback
until (a)'s gates pass. Member publication needs QSight-owner authorization of a particular issuer, canonical
client/Space binding and policy version; membership alone is insufficient. Start with `owner-v1`:
authenticated, verified owner-account mapping maintained by QSight, never a browser/model-supplied email or
string equality to a display name. `space-member-v1` is a later policy gate, recording the real member as
approver and the delegating owner separately. This is publication permission, not financial approval.

## Proposal: exact receipt and consumption

Use compact JWS, Ed25519 only: protected header exactly
`{"alg":"EdDSA","kid":"<configured-key-id>","typ":"rakazo-publish+jws"}`. Payload has exactly these fields
(unknown fields rejected):

| Field | Type / meaning |
| --- | --- |
| `v`, `iss`, `aud`, `action` | `1`, configured stable issuer ID, configured product-instance ID, `intake.publish` |
| `jti`, `operation_id` | Independent random UUIDs; receipt identity and human-click operation identity |
| `iat`, `exp` | Integer Unix seconds; `exp = iat + 120`; at most 30 seconds clock skew |
| `actor` | `{subject: string, space_id: string, membership_revision: integer, policy: "owner-v1" or "space-member-v1", delegation_id: string}` |
| `binding` | `{id: string, revision: integer, client_id: string, building_id: string, project_id: string}` |
| `thread_id`, `bot_id`, `intake_id` | Nonempty canonical IDs resolved by fork API |
| `intake_revision`, `review_revision` | Integers ≥1 and ≥0 respectively |
| `context_fingerprint`, `payload_sha256` | Lowercase 64-hex SHA-256 values |

All IDs are bounded to 200 UTF-8 bytes. Receipt integers are nonnegative safe JSON integers; duplicate keys, floats, invalid UTF-8
and receipt nulls are rejected. Payload and protected header use RFC 8785 JCS UTF-8, unpadded base64url; verify
signature over the JWS signing input. No Unicode normalization or coercion; compare opaque IDs byte-for-byte.
`payload_sha256 = SHA256(JCS(snapshot))`. Snapshot v1 has exactly `{v:1,
publish:{expected_revision,expected_review_revision,file_ids}, review, files, destinations,
context_fingerprint}`: `review` is the full saved review JSON; `files` is sorted by ID and contains each
selected file's `{id,generation, interpretation_revision,source_sha256,facts_sha256}`; `destinations` is
sorted by file ID and contains `{file_id,decision,group,package_revision_id}` (`group` is null for direct
package assignments; package revision is null only for explicitly new destinations). `decision` and `group`
are the saved review entries. `facts_sha256` hashes JCS of the saved role-specific extraction artifact;
`file_ids` is a sorted unique nonempty list. Freeze those artifact schemas in the seam; missing
source/facts/revision fences block publication. QSight produces the snapshot/digest from locked authoritative
rows; the fork stores and displays that snapshot, and QSight recomputes it before any side effect.

Private signing keys live only in fork API secret custody, separate from PM/tool credentials; product holds
pinned public keys, issuer/audience and delegation policy. No HMAC: shared verifier secrets would let the
consumer mint approvals. No remote key URL from a receipt. Rotate with explicit key IDs and overlap through
maximum receipt lifetime; disabled keys cannot authorize new consumption. Never log JWS.
Receipts, signing access and broker credentials never reach model tools, prompts, artifacts or browser state.
No publish tool is registered; generic tool approval and model network execution cannot access these routes.

1. Fork session-only `GET /api/project-intakes/{id}/publish-card` resolves the PM thread/binding/ancestry and
   authoritative snapshot. Persist an actor-bound card nonce and digest; GET never mints approval. Model
   content cannot instantiate it.
2. `POST /api/project-intakes/{id}/publish` accepts only `{card_id, nonce}` with trusted Origin/CSRF
   protection and authenticated session; no agent credentials. Re-read snapshot and membership, compare
   displayed digest, then lock Space, membership, binding and bot for admission as in inspection. Atomically
   consume nonce, persist one operation and mint receipt in fork API. Repeated identical clicks return that
   operation; new inputs require a new card and human click.
3. Server-only `POST /api/v2/agent/intakes/{id}/publish` takes `{receipt, snapshot}` and `Idempotency-Key:
   operation_id`, using a separate broker credential with only receipt submission authority. Reject all
   existing PM read/scaffold/write tokens. Verify signature/claims, project ownership and delegated actor
   policy, then ask fork `POST /api/internal/publish-operations/{operation_id}/admit` to confirm the
   operation, receipt digest and current binding/membership. Authenticate callbacks with pinned service
   identity, not a receipt-controlled URL. Outage/revocation fails closed. Admission is the authorization
   linearization point: later revocation does not undo an admitted command. Persist its timestamp/version in
   QSight audit.
4. In one product transaction, serialize by intake and unique `(iss,jti)` and `(iss,operation_id)`; check
   snapshot hash and current fences, invoke existing `publish_review` as the resolved resource owner while
   auditing the distinct human, and store consumption/result. Rollback leaves no consumption or partial
   publish. Concurrent identical requests return the same result; changed digest/key is 409. This wrapper must
   not bypass readiness, destination or existing revision checks.
5. Exact authenticated retries may retrieve a committed result after expiry (and without reauthorizing a new
   effect); an expired unconsumed receipt fails. Timeout means unknown: use session-only fork `GET
   /api/publish-operations/{operation_id}` and broker-only agent `GET
   /api/v2/agent/publish-operations/{operation_id}` (both enforce actor/binding access), or retry the same
   bytes/key; never mint replacement authority automatically. Work starts directly after durable fork
   admission; use the existing durable backup pattern, not a new queue service.

QSight records issuer/key ID, receipt digest and claims, admission evidence, delegating owner, actual actor
subject, policy version, canonical binding/context, snapshot/hash, command key, prior/result revisions,
created document/package IDs, consumption time and outcome in the publication transaction. Record sanitized
failed attempts separately; no signed URLs, credentials, source bytes or chat text. Retain consumption
tombstones/results for the product audit lifetime; key retirement must not erase history. Fork records
matching operation/actor/card digest and outcome.

## Proposal: interaction and seam rollout

The trusted card is server-authored state rendered by shared web/Electron UI, never model HTML or
model-provided action parameters. Show authoritative file selection, full destination path, roles,
currency/parties and unresolved questions. One explicit `Publish` confirmation in that card is the business
approval; disable during save, processing, invalid selection, missing policy/access, pending command or stale
state. Keyboard and assistive technology receive the same confirmation and pending/result state. No publish
control in the right rail. Mobile initially offers authenticated QSight review navigation only; no generic
tool-approval fallback.

PM may describe staged proposals and ask for corrections; it cannot treat “yes” in chat, a tool approval or
its own message as publication consent. Before success it may say “Ready to review”; after authoritative
success it may say “Published”. Lost responses stay pending/unknown. QSight edits to review, sources, facts,
destination or package revisions invalidate the card/digest; refresh and require a fresh click, never silently
rebase approval. Signals and reconnect/focus re-reads refresh cards through the existing live stream, without
polling. QSight-side publication appears as authoritative state, not as a fabricated chat approval.

1. **Policy/seam PR:** approve owner mapping and delegation semantics first. Keep agent-intake v1.0.0 bytes
   compatible; propose v1.1.0 for additive review-request, snapshot and receipt/publish/status schemas and
   synthetic fixtures, registered in `contracts/seams.json`. Breaking existing envelopes require v2.0.0.
   Specify all nested artifact fields, JCS vectors and error envelopes before implementation.
2. **Product/agent PR:** receipt verifier, broker-only credential, admission callback, atomic
   audit/consumption and existing publisher reuse. Producer tests in
   `tests/seams/test_agent_intake_producer.py`; independent consumer fixtures in
   `tests/seams/test_agent_intake_consumer.py`, sockets blocked. Disposable DB tests cover races, rollback,
   changed bytes/facts, foreign project, replay and lost reply.
3. **Fork API/adapter PR:** shared provider-neutral receipt/card contracts in `packages/contracts`, external
   translation in adapter only; session routes, signer, operation recovery and narrow content-free signals.
   Consumer tests in `packages/adapters/src/qsight-project-intake.test.ts` validate frozen fixtures; API tests
   cover forged actors/cards, CSRF, binding changes and membership removal.
4. **UI PR:** trusted card, disabled/stale/recovery states and PM instructions in prompt files; CI chat
   journey/screenshots plus keyboard and declutter review. Verify malicious model cards and every PM
   credential cannot publish. Run fork `pnpm checks`; upstream seam/catalog gates and both isolated sides must
   pass before enabling. Unknown protocol/key/policy versions fail closed; deploy verifier first, then
   producer, keeping publication unavailable on older peers.

Wire errors: 400 `invalid_receipt`/`unsupported_version`; 401 `unauthenticated`; 403
`actor_forbidden`/`receipt_required`/`delegation_revoked`; 404 `not_found` for inaccessible resources; 409
`binding_stale`/`revision_stale`/`context_changed`/ `payload_changed`/`key_conflict`; 410 `receipt_expired`;
422 `not_ready`/ `destination_incomplete`; 503 `authority_unavailable`. Return typed safe errors; 409/410
require review and new click, 503 retries only the existing operation.

Non-goals: implementing this design here, deployment, financial/change approval, marking review complete,
broad member RBAC, automatic publication, new document storage, cleanup guarantees, hierarchy changes or
general-purpose approval receipts.
