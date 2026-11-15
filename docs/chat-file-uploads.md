# Chat file uploads

Web and Electron composers accept multiple files or a folder (including nested folders),
from the attachment menu or by dropping them. Files upload individually; no ZIP is created.
Native mobile folder selection remains deferred; its existing picker is unchanged.

Supported document types include PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV and TXT.
Existing PNG, JPG/JPEG, WEBP, GIF, Markdown, HTML, JSON, ZIP, audio and MP4 support remains.
New Office uploads check the extension and MIME together with their container structure;
this is format validation, not malware scanning. Documents are never executed by the upload path.

The default limits remain 10 MiB per file and four attachments per message. The composer
uses the limits advertised by its server; the configurable count has a hard ceiling of 100.
Oversized, unsupported and excess files are skipped with a notice. Static images may shrink
before upload, as before. An upload failure keeps the draft and attachments for retry.

A folder-relative path is stored in the artifact's `name` metadata, including the selected
folder name, and shown in the pending list, chat message and agent file metadata. It must
be at most 255 characters, with no absolute paths, backslashes, colons, control characters,
empty components or dot/dot-dot components. Workspace destinations remain artifact-ID-based
paths such as `attachments/<artifact-id>.docx`; display paths never become write destinations.

## QSight ingestion boundary

Chat uploads create chat artifacts and follow the normal run attachment/tool pipeline.
They do not publish documents into QSight's project document library, start extraction,
or create a folder-import session. QSight's intake/folder-import workflow separately handles
planning, target projects, document publication and completion. A configured integration or
an explicit import through that workflow is still required for those effects. Attaching a
proposal to chat alone is not evidence that it has been ingested into QSight.
