import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { manifestSchema } from "../../vendor/kit/src/index.ts";
import { registry } from "../../src/registry.ts";
import { registerTasks } from "./tasks.ts";

export async function listen(port: number, endpoint: string, agent: string) {
  const manifest = manifestSchema.parse(JSON.parse(
    readFileSync(new URL("./plugin.json", import.meta.url), "utf8"),
  ));
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agent)) throw new Error("Invalid agent label");
  const app = createMcpExpressApp();
  app.post("/mcp", async (req, res) => {
    const key = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!key) {
      res.sendStatus(401);
      return;
    }
    const server = new McpServer({ name: manifest.source, version: "1.0.0" });
    const add = registry(server, manifest.toolPrefix ?? "");
    registerTasks(add, endpoint, key, agent);
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
