import { Button } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useMatch } from "react-router-dom";
import { replaceComposerDraft } from "../../lib/composer-draft";

/** A draft only: the person reviews and sends the request in their active chat. */
export function HierarchyHandoff({ text, children }: { text: string; children: ReactNode }) {
  const match = useMatch("/app/:botId");
  if (!match) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        replaceComposerDraft(`bot:${match.params.botId}`, text, []);
        document
          .querySelector<HTMLTextAreaElement>('textarea[name="chat-message"]:not(:disabled)')
          ?.focus();
      }}
    >
      {children}
    </Button>
  );
}
