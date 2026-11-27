import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { openFolder } from "./store.ts";
import { listen } from "./server.ts";

const fixture = readFileSync(new URL("./fixtures/note-deploy.md", import.meta.url), "utf8");
const proposal = { key: "deploy", scope: "project", kind: "reference", source: "Team handbook",
  text: "Run checks.\n\n## Details\nKeep the log.\n" } as const;

function folder(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "markdown-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("matches the ME4 export, including body whitespace and index", t => {
  const dir = folder(t);
  const store = openFolder(dir, () => 123);
  store.propose(proposal);
  assert.throws(() => store.propose({ ...proposal, text: "replacement" }));
  assert.equal(readFileSync(join(dir, "note-deploy.md"), "utf8"), fixture);
  assert.equal(readFileSync(join(dir, "MEMORY.md"), "utf8"),
    "# Memory\n\n<!-- Banneret index -->\n- [note-deploy.md](note-deploy.md)");
  assert.equal(store.search("KEEP THE LOG")[0].text, proposal.text);
  assert.equal(store.use("deploy", "one").useCount, 1);
  const reopened = openFolder(dir);
  assert.equal(reopened.use("deploy", "one").useCount, 1);
  assert.equal(reopened.use("deploy", "two").useCount, 2);
});

test("keeps personal notes outside every tool and the index", t => {
  const dir = folder(t);
  writeFileSync(join(dir, "note-deploy.md"), fixture.replace("scope: project", "scope: personal"));
  const store = openFolder(dir);
  assert.throws(() => store.propose({ ...proposal, key: "private", scope: "personal" }));
  assert.throws(() => store.read("deploy"));
  assert.throws(() => store.use("deploy", "one"));
  assert.throws(() => store.flag("deploy", "dispute"));
  assert.deepEqual(store.search("deploy"), []);
  assert.doesNotMatch(readFileSync(join(dir, "MEMORY.md"), "utf8"), /deploy/);
});

test("derives Hub trust from dates, human review and distinct uses", t => {
  const dir = folder(t);
  const file = join(dir, "note-deploy.md");
  const confirmed = fixture.replace("confirmedAt: null", "confirmedAt: 123").replace("useCount: 0", "useCount: 3");
  writeFileSync(file, confirmed);
  let days = 0;
  const store = openFolder(dir, () => 123 + days * 86400000);
  for (const [age, trust] of [[29, "confirmed"], [30, "trusted"], [45, "stale"], [90, "archived"]] as const) {
    days = age;
    assert.equal(store.read("deploy").trust, trust);
  }
  writeFileSync(file, confirmed.replace("pinned: 0", "pinned: 1"));
  assert.equal(store.read("deploy").trust, "pinned");
  assert.equal(store.flag("deploy", "obsolete").trust, "disputed");
  assert.equal(store.use("deploy", "three").trust, "disputed");
});

test("passes the vendored memory checker over HTTP", async t => {
  const server = await listen(0, folder(t), { fixture: "chat-1" });
  t.after(() => server[Symbol.asyncDispose]());
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  assert.equal((await fetch(url, { method: "POST" })).status, 401);
  const { stdout } = await promisify(execFile)(process.execPath, [
    process.env.BANNERET_CHECKER ?? "vendor/kit/checker/cli.mjs",
    "--manifest", "examples/markdown-memory/plugin.json", "--url", url, "--json",
  ], { env: { ...process.env, BANNERET_CHECK_TOKEN: "fixture" } });
  assert.equal(JSON.parse(stdout).passed, true);
});
