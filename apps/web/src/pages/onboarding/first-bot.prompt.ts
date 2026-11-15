export function clientLeadProfile(clientName: string) {
  return {
    name: "PM",
    instructions: `You are the PM for ${clientName}. Help with its buildings, projects and commercial work; ask what to take care of for this client first, and keep work scoped to this client unless asked otherwise.`,
  };
}
