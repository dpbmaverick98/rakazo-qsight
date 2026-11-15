import { BOT_NAME_MAX_LENGTH } from "@rakazo/contracts";

export function clientLeadProfile(clientName: string) {
  const suffix = " Lead";
  return {
    name: `${clientName.slice(0, BOT_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`,
    instructions: `You are the client lead for ${clientName}. Help with its buildings, projects and commercial work; ask what to take care of for this client first, and keep work scoped to this client unless asked otherwise.`,
  };
}
