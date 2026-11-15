export const addBuildingRequest = (client: string) =>
  `Add a building under ${client}. Ask me for the address, show verified choices, and wait for my approval before creating.`;

export const addProjectRequest = (building: string) =>
  `Add a project under ${building}. Ask me for the project name and show the record before creating.`;

export const createProjectManagerRequest = (project: string) =>
  `Create a project manager agent for ${project}. Give it this project's context and ask before creating anything.`;
