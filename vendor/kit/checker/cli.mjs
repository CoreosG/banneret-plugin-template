import * as NodeFSP from "node:fs/promises";
import * as NodeUtil from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { manifestSchema } from "../src/index.ts";
import { check } from "./checks.mjs";

const usage = `node banneret-plugin-check.mjs --manifest FILE [--json] [--task-id ID] (--url URL | -- COMMAND [ARG ...])
For tasks, set BANNERET_CHECK_TOKEN and BANNERET_CHECK_PEER_TOKEN to distinct test credentials.
HTTP sends a bearer token. Stdio supplies PLUGIN_TOKEN to each process.`;

let json = false;
let report;
const connections = [];
try {
  const { values, positionals } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string" },
      url: { type: "string" },
      "task-id": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  json = values.json;
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  if (!values.manifest || Boolean(values.url) === Boolean(positionals.length))
    throw new Error(usage);
  const manifest = manifestSchema.parse(
    JSON.parse(await NodeFSP.readFile(values.manifest, "utf8")),
  );
  async function connect(token) {
    const transport = values.url
      ? new StreamableHTTPClientTransport(new URL(values.url), {
          requestInit: { headers: token ? { Authorization: "Bearer " + token } : {} },
        })
      : new StdioClientTransport({
          command: positionals[0],
          args: positionals.slice(1),
          env: token ? { PLUGIN_TOKEN: token } : {},
        });
    const client = new Client({ name: "banneret-plugin-check", version: "1" });
    connections.push({ client, transport });
    await client.connect(transport);
    return client;
  }
  const token = process.env.BANNERET_CHECK_TOKEN;
  const peerToken = process.env.BANNERET_CHECK_PEER_TOKEN;
  if (
    manifest.capabilities.includes("tasks") &&
    (!token || !peerToken || token === peerToken || !values["task-id"])
  )
    throw new Error(usage);
  const client = await connect(token);
  const peer = manifest.capabilities.includes("tasks") ? await connect(peerToken) : undefined;
  report = await check(manifest, client, { peer, taskId: values["task-id"] });
} catch (error) {
  report = { passed: false, checks: [{ name: "setup", status: "fail", hint: error.message }] };
} finally {
  await Promise.all(
    connections
      .map(async ({ client, transport }) => {
        try {
          if (transport.sessionId) await transport.terminateSession();
        } finally {
          await client.close();
        }
      })
      .map((p) =>
        p.catch((error) => {
          report.passed = false;
          report.checks.push({ name: "close session", status: "fail", hint: error.message });
        }),
      ),
  );
}
if (json) console.log(JSON.stringify(report));
else {
  for (const { name, status, hint } of report.checks)
    console.log(status.toUpperCase(), name, hint ?? "");
  console.log(report.passed ? "PASS" : "FAIL");
}
process.exitCode = report.passed ? 0 : 1;
