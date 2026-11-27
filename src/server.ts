import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { manifestSchema } from "../vendor/kit/src/index.ts";
import { registry } from "./registry.ts";
import { createBoard } from "./providers/tasks.ts";
import { createNotebook } from "./providers/memory.ts";
import { registerSkills } from "./providers/skills.ts";

export async function listen(port: number) {
  const manifest = manifestSchema.parse(
    JSON.parse(
      readFileSync(new URL("../plugin.json", import.meta.url), "utf8"),
    ),
  );
  const registerTasks = createBoard();
  const actors = new Map(
    ["alice", "bob"].map((id) => [
      "Bearer demo-" + id,
      { id, notebook: createNotebook() },
    ]),
  );
  const app = createMcpExpressApp();
  app.post("/mcp", async (req, res) => {
    const actor = actors.get(req.headers.authorization ?? "");
    if (!actor) {
      res.sendStatus(401);
      return;
    }
    const server = new McpServer({ name: manifest.source, version: "1.0.0" });
    const add = registry(server, manifest.toolPrefix ?? "");
    if (manifest.capabilities.includes("tasks")) registerTasks(add, actor.id);
    if (manifest.capabilities.includes("skills")) registerSkills(add, server);
    if (manifest.capabilities.includes("memory"))
      actor.notebook(add, "demo-chat");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const http = createServer(app);
  http.listen(port, "127.0.0.1");
  await once(http, "listening");
  return http;
}
