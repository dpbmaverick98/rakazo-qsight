-- Additive: old releases do not read or write this table. No automatic backfill.
CREATE TABLE "space_client_bindings" (
  "spaceId" TEXT PRIMARY KEY REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "externalClientId" TEXT NOT NULL UNIQUE,
  "clientName" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "space_client_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "space_client_bindings" FORCE ROW LEVEL SECURITY;
CREATE POLICY space_client_bindings_tenant ON "space_client_bindings"
  USING ("spaceId" = current_setting('app.space_id', true))
  WITH CHECK ("spaceId" = current_setting('app.space_id', true));
CREATE POLICY space_client_bindings_system ON "space_client_bindings"
  USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()));
GRANT SELECT, INSERT, UPDATE, DELETE ON "space_client_bindings" TO rakazo_app;
