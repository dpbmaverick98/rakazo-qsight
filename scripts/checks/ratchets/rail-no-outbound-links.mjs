export const message =
  "The rail is read-only and must not link out; render the record inside the rail and keep Vendor One navigation outside it.";

export const include = [
  "apps/web/src/pages/shell/{hierarchy-rail,project-commercial,commercial-inspection,document-preview}.tsx",
];

export const pattern =
  /\b(?:target\s*=\s*(?:\{\s*)?["'`]_blank["'`]|href\s*=\s*(?:\{\s*)?["'`](?:https?:)?\/\/)/g;
