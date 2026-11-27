import { tools } from "../../vendor/kit/src/index.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registry } from "../registry.ts";
import { createNotebook } from "./memory.ts";

test("a duplicate proposal preserves the note and distinct chats count once each", async (t) => {
  const notebook = createNotebook();
  async function connect(chat: string) {
    const info = { name: "test", version: "1" };
    const server = new McpServer(info);
    notebook(registry(server, ""), chat);
    const [left, right] = InMemoryTransport.createLinkedPair();
    const client = new Client(info);
    await server.connect(left);
    await client.connect(right);
    t.after(() => client.close());
    return (op: string, args: Record<string, string>) =>
      client.callTool({ name: "banneret_memory_" + op, arguments: args });
  }
  const first = await connect("one");
  const second = await connect("two");
  const proposal = {
    key: "test",
    text: "original",
    source: "test",
    scope: "project",
    kind: "reference",
  };
  assert.ok(!(await first("propose", proposal)).isError);
  assert.equal(
    (await second("propose", { ...proposal, text: "replacement" })).isError,
    true,
  );
  for (const chat of [first, second, first]) await chat("use", { key: "test" });
  const result = await second("read", { key: "test" });
  assert.deepEqual(
    JSON.parse(
      tools.banneret_memory_read.output.parse(result.structuredContent).data,
    ),
    { ...proposal, trust: "proposed", useCount: 2 },
  );
});
