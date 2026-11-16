export const message =
  "The right rail is read-only; move creation, upload, publish and approval to the chat or Vendor One. Only navigation, expansion and tab switching belong here.";

export const include = [
  "apps/web/src/pages/shell/{hierarchy-rail,project-commercial,commercial-inspection,document-preview}.tsx",
];

export const pattern =
  /<(?:form|input|textarea|select)\b|\bcontentEditable\b|\brole\s*=\s*(?:\{\s*)?["'`](?:textbox|combobox)["'`]/g;
