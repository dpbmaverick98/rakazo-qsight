# AGENTS.md

Read [docs/agentic-ui-invariants.md](docs/agentic-ui-invariants.md) before any UI change.

## Make small precise edits

- Change only the lines the stated problem needs. No refactors, renames, reformatting, restructures or drive-by cleanup.
- One concern per change. Separate concern, separate PR.
- Never delete a user-visible feature, screen, route, bot, field or test to make a check pass. Removing something is its own change with explicit approval.
- Never weaken or delete a failing test. Fix the cause; if the test encodes a real contract, change the contract on both sides first.
- Display data is not identity. Names (client, building, project, claim, sub vendor, file) are display only; IDs are authority. Never require a display field to parse a record: accept null/empty with a fallback (name, then address, then an explicit "Address missing" state), and keep identity fields strict.
- Persisted keys are contracts. Panel/tab/layout/sessionStorage key formats and spawn-key formats are read elsewhere; change a format only with a versioned reader and an old-state fallback.
- The right rail is read-only. No create, edit, delete, upload, publish or approve there; writes go through the project-manager conversation with approval.
- No polling for data. Read once; re-read on the server signal, window focus or retry. No `refetchInterval` or timers.
- One direction of knowledge: web → fork API → adapter → Vendor One agent API. The UI does not call the backend directly and does not parse spawn keys, DB columns, tool names or upstream JSON.
- A contract change is cross-repo: schema, fixture, producer and consumer tests and a version bump in the same change set. Additive and optional first; breaking changes coordinated. Never ship one side and assume the other.
- Keep failures honest: disabled, personal, binding missing, binding stale, forbidden, unavailable and empty stay distinct. Never turn one into an empty state, another client's data, or a fallback screen.
- Never commit secrets, `.env` values, real customer data or private URLs. The repository is public.
- Run the focused tests and `pnpm checks`; report the commands and results you actually ran.
- If the fix requires a seam or invariant change, say so and stop; do not hide it inside the edit.
