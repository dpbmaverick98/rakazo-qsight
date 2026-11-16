/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public, origin-restricted map key, embedded by Vite at build time. */
  readonly VITE_GEOAPIFY_API_KEY?: string;
  readonly VITE_DEFAULT_UI_LOCALE?: string;
  /** Build id (`YYYYMMDDHHMMSS`) of a production build; empty on the dev server. */
  readonly RAKAZO_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.po" {
  export const messages: Record<string, unknown>;
}
