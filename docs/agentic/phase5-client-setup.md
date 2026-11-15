# Phase 5: narrow web and native client setup

This slice reuses the existing client setup and canonical navigation APIs. It adds no external endpoints, provider configuration, migrations, polling, or automatic chat deletion.

## Web and desktop

Below 1024 CSS pixels, the existing hierarchy rail opens in the shared accessible Sheet instead of occupying the chat panel. Each selected client starts open, including during loading. Escape and Hide dismiss it; the persistent Hierarchy trigger reopens it and receives restored focus. Opening a PM from the sheet closes it so the conversation is usable. Wide windows retain the existing rail. Loading, retryable errors, empty-client building setup, project creation and ready hierarchy use the same rail and API as before.

## Native

Add client asks only for a client name and calls `POST /api/agent-plane/clients`. It bypasses generic Space creation and account onboarding. Accepted setup selects the returned Space and opens Continue setup; missing setup tools remain recoverable by retrying the same canonical client. Session changes and leaving the creation screen suppress late navigation.

Continue setup is also in each non-Personal Space's native menu. It selects that explicit target Space before loading canonical navigation, follows the existing live stream, and rereads on focus/foreground. It offers the assigned setup PM or project PMs, with building/project context, a setup retry while an active setup assignment exists, and Archived chats even when hierarchy loading fails. A native Close control provides a route back to the inbox on cold links too.

**Native navigation limit:** this is a continuation screen, not a grouped building/project tree. There are no native structured building verification, Add building, Add project, or promotion controls in this slice. Use the existing web hierarchy for those structured actions. Native can open the existing PM conversation; this does not promise that every conversational setup step is available. No elevated connection, capability, or new orchestration is added. The setup API's `ready` status means its setup-tool connection is ready, not that a project is complete. Tool status is returned after creation/retry; navigation alone does not supply a durable tool-readiness status.

## Archive recovery

Existing archive/restore controls continue to cover setup PMs, project PMs, legacy bots and groups. Retrying client setup with an archived setup PM now returns a conflict directing the user to explicit restore. The creation conflict path preserves its unique setup key even during a concurrent retry. An archived promoted PM also prevents setup from being restarted with broad setup authority. Nothing is deleted or restored implicitly; restored chats keep their original identity and thread.

## Verification and limits

Focused offline tests cover native creation, canonical assignments, target/session isolation, continuation/retry, archive access through hierarchy failures, existing archive/restore flows, and concurrent archived-key preservation. The PostgreSQL setup regression checks archive/retry/restore and rejects restarting an archived promoted PM; it requires an explicitly configured test database.

The narrow-web E2E spec covers loading, errors/retry, empty-client setup, dismissal, focus restoration, composer typing and screenshots. Run it in the existing CI web suite. The existing native Compose screenshot flow now captures Add client and Continue setup; its seeded generic workspace can show the unavailable/recovery state, not an invented external-client fixture.

Native screenshots cannot be captured in the implementation environment because the simulator tooling is unavailable. Do not treat source review or DOM tests as native visual verification. Native building/project navigation and native visual verification remain explicit follow-up work.
