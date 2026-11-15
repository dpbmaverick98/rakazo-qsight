import { expect, it } from "vitest";
import { clientSetupInstructions } from "./client-setup.prompt.js";
import { projectManagerInstructions } from "./project-manager.prompt.js";

// Reviewed prompt artifacts: changes require reviewing the full instructions, not keyword grading.
it("records setup and project instructions for location confirmation review", () => {
  expect(clientSetupInstructions({ id: "example", name: "Example Client" })).toMatchSnapshot();
  expect(
    projectManagerInstructions({ id: "roof", name: "Roof survey" }, "Example Client"),
  ).toMatchSnapshot();
});
