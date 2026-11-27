import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { skillUri } from "../../vendor/kit/src/index.ts";
import type { Register } from "../registry.ts";

const skill = { name: "review", description: "Review a change" };
const text = `---
name: ${skill.name}
description: ${skill.description}
---
Read the diff and run the relevant tests.
`;

export function registerSkills(add: Register, server: McpServer) {
  add("skills_list", () => ({ skills: [skill] }));
  add("skills_get", ({ name }) => {
    if (name !== skill.name) throw new Error("Unknown skill");
    return { ...skill, text };
  });
  server.registerResource(
    skill.name,
    skillUri(skill.name),
    { mimeType: "text/markdown" },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
    }),
  );
}
