import { createDb, runAsSystem } from "@rakazo/db";
import { qsightHierarchyFromEnv } from "../qsight-hierarchy.js";

// Operator-only; output contains opaque issuer IDs, never credentials or bearer hashes.
const [command, id, extra] = process.argv.slice(2);
if (command === "retained" && !id) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { prisma, pool } = createDb(url);
  try {
    const rows = await runAsSystem(
      "inventory managed credentials for operator reconciliation",
      () =>
        prisma.mcpServer.findMany({
          where: { managedCredentialId: { not: null } },
          select: { managedCredentialId: true },
        }),
    );
    for (const row of rows) process.stdout.write(`${row.managedCredentialId}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
} else if (command === "revoke" && id && !extra) {
  const source = qsightHierarchyFromEnv();
  if (!source) throw new Error("Hierarchy connection is required");
  await source.revokeManagerToken(id);
  process.stdout.write("Revocation completed.\n");
} else {
  process.stderr.write("Usage: qsight-manager-token.ts retained | revoke <token-id>\n");
  process.exitCode = 1;
}
