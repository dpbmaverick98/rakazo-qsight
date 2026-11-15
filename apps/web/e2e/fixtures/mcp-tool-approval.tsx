import { I18nProvider } from "@lingui/react";
import { buildApprovalAskBlock } from "@rakazo/adapters/approval-ask";
import { createRoot } from "react-dom/client";
import { AskCard } from "../../src/components/AskCard";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import "../../src/styles.css";

const block = buildApprovalAskBlock(
  "fixture-effect",
  "mcp__example__create_building",
  {
    nickname: "North Tower",
    client_name: "Example Client",
    client_id: "fake-internal-client",
    verification_token: "fake-verification-token",
  },
  [],
);

if (block.kind !== "ask") throw new Error("Expected approval card");
void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <main className="mx-auto max-w-xl p-6">
        <AskCard
          block={block}
          canAnswer
          canDismiss={false}
          onAnswer={async () => undefined}
          onDismiss={async () => undefined}
        />
      </main>
    </I18nProvider>,
  );
});
