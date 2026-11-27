import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { listen } from "./server.ts";

function url(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP socket");
  return `http://127.0.0.1:${address.port}`;
}

async function fakeLinear() {
  const users = { alice: { id: "A", displayName: "alice" }, bob: { id: "B", displayName: "bob" } };
  const state = { steal: false, comments: [] as string[] };
  const row = {
    id: "I1", title: "Check adapter", identifier: "ENG-1", url: "https://linear.app/test/issue/ENG-1",
    createdAt: "2026-01-01T00:00:00Z", completedAt: null, canceledAt: null,
    state: { type: "started", name: "In progress" }, team: { id: "ENG" },
    assignee: null as typeof users.alice | null,
  };
  const server = createServer(async (req, res) => {
    const viewer = req.headers.authorization === "fake-alice" ? users.alice :
      req.headers.authorization === "fake-bob" ? users.bob : null;
    if (!viewer || req.method !== "POST" || req.url !== "/graphql") {
      res.writeHead(403).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const { query, variables } = JSON.parse(body);
    const op = /^(?:query|mutation) (\w+)\(/.exec(query)?.[1];
    const page = (nodes: unknown[]) => variables.after === null
      ? { nodes: [], pageInfo: { hasNextPage: true, endCursor: "page2" } }
      : { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
    let data;
    if (op === "Teams") data = { teams: page([{ id: "ENG", name: "Engineering" }]) };
    if (op === "Issues" && variables.id === "ENG") data = { team: { issues: page([row]) } };
    if (variables.id === row.id) {
      if (op === "Issue") data = { issue: row };
      if (op === "Ownership") data = { issue: row, viewer };
      if (op === "Assign") {
        row.assignee = state.steal ? users.bob :
          Object.values(users).find((u) => u.id === variables.input.assigneeId) ?? null;
        data = { issueUpdate: { success: true } };
      }
    }
    if (op === "Comment" && variables.input.issueId === row.id) {
      state.comments.push(variables.input.body);
      data = { commentCreate: { success: true } };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data ? { data } : { errors: [{ message: "Unknown object" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, state, row, endpoint: url(server) + "/graphql" };
}

test("vendored checker exercises two users against the loopback Linear fixture", async (t) => {
  const fake = await fakeLinear();
  t.after(() => fake.server[Symbol.asyncDispose]());
  const plugin = await listen(0, fake.endpoint, "codex");
  t.after(() => plugin[Symbol.asyncDispose]());
  const { stdout } = await promisify(execFile)(process.execPath, [
    process.env.BANNERET_CHECKER ?? "vendor/kit/checker/cli.mjs",
    "--manifest", "examples/linear-tasks/plugin.json", "--task-id", "I1", "--url", url(plugin) + "/mcp", "--json",
  ], { env: { ...process.env, BANNERET_CHECK_TOKEN: "fake-alice", BANNERET_CHECK_PEER_TOKEN: "fake-bob" } });
  assert.equal(JSON.parse(stdout).passed, true);
  assert.deepEqual(fake.state.comments, ["claim: alice/codex", "release: handing_over"]);
  assert.equal(fake.row.assignee, null);
});

test("losing the verification read preserves the competing assignment and skips the comment", async (t) => {
  const fake = await fakeLinear();
  t.after(() => fake.server[Symbol.asyncDispose]());
  fake.state.steal = true;
  const plugin = await listen(0, fake.endpoint, "codex");
  t.after(() => plugin[Symbol.asyncDispose]());
  const client = new Client({ name: "test", version: "1" });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(url(plugin) + "/mcp"), {
    requestInit: { headers: { Authorization: "Bearer fake-alice" } },
  }));
  const result = await client.callTool({ name: "tasks_claim", arguments: { taskId: "I1" } });
  assert.deepEqual(result.structuredContent, { status: "conflict" });
  assert.equal(fake.row.assignee?.id, "B");
  assert.deepEqual(fake.state.comments, []);
});
