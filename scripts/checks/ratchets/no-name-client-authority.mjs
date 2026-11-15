export const message =
  "Resolve external hierarchy authority through SpaceClientBinding IDs; Space names are display data only.";
export const include = [
  "apps/api/src/{hierarchy,project-manager,space-client-binding}.ts",
  "packages/adapters/src/qsight-hierarchy.ts",
];
export const pattern = /spaceClientName|source\.read\(space\.name|["']client_name["']/g;
