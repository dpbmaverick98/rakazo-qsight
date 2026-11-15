# Artifact stage seam

The web shell (also hosted by Electron) accepts one active stage artifact and a
bounded history through `useRightPanel.publishStage`. Selection replaces only the
stage content; closing uses the existing panel action. Opening another panel does
not discard the history. Changing chats clears it. Stage payloads are never saved
in browser layout preferences.

The initial renderer accepts `document-list`, schema version 1: document IDs,
names, and version numbers only. Titles and names are plain React text, never
HTML, Markdown, links, file bodies, or commands. Unknown kinds and versions show a
fixed fallback without reading their payload. Only validated descriptors may be
published; unrecognized payloads must never be displayed by a generic JSON viewer.

## Try it

Run the web development server and open `/e2e/fixtures/artifact-stage.html`.
The dev fixture publishes fake document metadata and an unsupported artifact to
exercise switching and closing in the shared resizable panel. It is not an agent
publication endpoint.

## Next producer

Existing artifact persistence (`apps/api/src/artifacts.ts`) stores versioned file
bytes, and message attachment blocks reference their IDs. Neither stores typed
stage descriptors. This slice deliberately does not reinterpret file content as a
stage payload or add a new persistence path.

Next: persist authorized agent-published descriptors alongside messages, scope
history to its bot/group and Space, and signal committed changes through the
existing live stream. Reuse artifact IDs for document metadata without fetching
file bodies. That producer must validate metadata and exclude secrets and document
text before publication. Mobile receives no new message block in this slice and
continues to show its existing attachments; a native stage consumer is deferred
until real publication exists.
