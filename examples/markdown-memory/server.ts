import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { manifestSchema } from "../../vendor/kit/src/index.ts";
import { registry } from "../../src/registry.ts";
import { openFolder } from "./store.ts";
import { z } from "zod";

export async function listen(port: number, folder: string, credentials: unknown) {
  const manifest = manifestSchema.parse(JSON.parse(
    readFileSync(new URL("./plugin.json", import.meta.url), "utf8"),
  ));
  const tokens = new Map(Object.entries(z.record(z.string().min(1), z.string().min(1)).parse(credentials)));
  const store = openFolder(folder);
  const app = createMcpExpressApp();
  app.post("/mcp", async (req, res) => {
    const key = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const chat = key && tokens.get(key);
    if (!chat) {
      res.sendStatus(401);
      return;
    }
    const server = new McpServer({ name: manifest.source, version: "1.0.0" });
    const add = registry(server, manifest.toolPrefix ?? "");
    const encode = (value: unknown) => ({ data: JSON.stringify(value) });
    add("banneret_memory_search", ({ query }) => encode(store.search(query)));
    add("banneret_memory_read", ({ key }) => encode(store.read(key)));
    add("banneret_memory_propose", input => encode(store.propose(input)));
    add("banneret_memory_use", ({ key }) => encode(store.use(key, chat)));
    add("banneret_memory_flag", ({ key, reason }) => encode(store.flag(key, reason)));
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
