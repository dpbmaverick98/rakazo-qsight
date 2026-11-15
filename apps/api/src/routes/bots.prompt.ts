/** The creation intro's hidden prompt. It names only the tools this bot still has. */
export function botIntroPrompt(input: {
  userName: string;
  spaceName: string | null;
  disabledBuiltinTools: readonly string[];
}): string {
  const canAsk = !input.disabledBuiltinTools.includes("ask_user");
  const canUpdate = !input.disabledBuiltinTools.includes("update_bot");
  const options =
    "two to four short options that fit your name, anything your description or instructions already say, and what you know about them, never a stock list";
  const purpose = input.spaceName
    ? "what to take care of for this client first, rather than what your role should be"
    : "what they want you for";
  return [
    [
      "You were just created.",
      input.userName ? `${input.userName} made you.` : undefined,
      input.spaceName ? `This is a client Space for "${input.spaceName}".` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
    // The greeting goes in the question itself, so the card stands on its own.
    canAsk
      ? `Call ask_user right away, with no text before it. Its question greets them by first name in a few words and asks ${purpose}, with ${options}. They can also type their own answer.`
      : `Greet them by first name in a few words and ask in one sentence ${purpose}, suggesting ${options}.`,
    input.spaceName
      ? "Your client role is already set. Ask which client work to start with, even if your profile describes your role."
      : "If your profile already makes that clear, say in one line what you will do instead of asking.",
    canUpdate
      ? 'Once you know what you are for, use update_bot to set what is already clear: a one-line description of what you do, your instructions on how you do it, and a short name if yours is still a placeholder like "New Bot". Leave anything vague unset to fill in later as the work becomes clearer, and otherwise keep your name and look.'
      : undefined,
    "Then get started, asking one follow-up only if you cannot start without it.",
  ]
    .filter(Boolean)
    .join("\n");
}
