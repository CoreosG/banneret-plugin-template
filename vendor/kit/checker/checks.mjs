import * as NodeCrypto from "node:crypto";
import { parse } from "yaml";
import { skillUri, tools } from "../src/index.ts";

function requireResult(condition, hint) {
  if (!condition) throw new Error(hint);
}

async function discover(list, field) {
  const entries = [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await list({ cursor });
    entries.push(...page[field]);
    cursor = page.nextCursor;
    if (cursors.has(cursor)) throw new Error("Return a fresh pagination cursor or end the list.");
    cursors.add(cursor);
  } while (cursor);
  return entries;
}

export async function check(manifest, client, { peer, taskId } = {}) {
  const checks = [];
  const prefix = manifest.toolPrefix ?? "";
  async function run(name, fn) {
    try {
      await fn();
      checks.push({ name, status: "pass" });
    } catch (error) {
      checks.push({ name, status: "fail", hint: error.message });
    }
  }
  async function invoke(actor, tool, args) {
    return actor.callTool({ name: prefix + tool, arguments: args });
  }
  async function call(tool, args, actor = client) {
    const response = await invoke(actor, tool, args);
    requireResult(
      !response.isError,
      tool + ": expected a successful call. Check fixture permissions and arguments.",
    );
    const parsed = tools[tool].output.safeParse(response.structuredContent);
    requireResult(
      parsed.success,
      tool + ": return structuredContent matching the kit schema. " + (parsed.error?.message ?? ""),
    );
    return parsed.data;
  }
  async function expectError(tool, args) {
    requireResult(
      (await invoke(client, tool, args)).isError === true,
      tool + ": return an MCP tool error for this input.",
    );
  }

  await run("tools/list", async () => {
    const names = new Set((await discover((p) => client.listTools(p), "tools")).map((t) => t.name));
    for (const [capability, start] of [
      ["tasks", "tasks_"],
      ["memory", "banneret_memory_"],
      ["skills", "skills_"],
    ]) {
      if (!manifest.capabilities.includes(capability)) continue;
      for (const tool of Object.keys(tools).filter((t) => t.startsWith(start))) {
        requireResult(names.has(prefix + tool), "Advertise " + prefix + tool + " in tools/list.");
      }
    }
  });
  if (manifest.capabilities.includes("skills")) {
    await run("skills discovery, resources and frontmatter", async () => {
      const { skills } = await call("skills_list", {});
      requireResult(skills.length, "Seed at least one skill to exercise skills_get.");
      const resources = await discover((p) => client.listResources(p), "resources");
      for (const { name, description } of skills) {
        const uri = skillUri(name);
        requireResult(
          resources.some((r) => r.uri === uri),
          "Advertise " + uri + " in resources/list.",
        );
        const skill = await call("skills_get", { name });
        requireResult(
          skill.name === name && skill.description === description,
          "Match skills_get metadata to skills_list for " + name,
        );
        const { contents } = await client.readResource({ uri });
        requireResult(
          contents.some(
            (r) => r.uri === uri && r.mimeType === "text/markdown" && r.text === skill.text,
          ),
          "Serve the same text/markdown at " + uri,
        );
        const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(skill.text);
        const meta = match && parse(match[1]);
        requireResult(
          meta?.name === name && meta?.description === description,
          "Set matching name and description in SKILL.md frontmatter for " + name,
        );
      }
      await expectError("skills_get", { name: NodeCrypto.randomUUID() });
    });
  }
  if (manifest.capabilities.includes("tasks")) {
    await run("tasks discovery, read and claims", async () => {
      requireResult(
        taskId && peer,
        "Supply --task-id and a second actor for the same unclaimed test task.",
      );
      const args = { taskId };
      const release = { ...args, reason: "handing_over", freeToContinue: true };
      const { boards } = await call("tasks_list_boards", {});
      let found = false;
      for (const { id } of boards) {
        const { tasks } = await call("tasks_list_tasks", { boardId: id });
        if (tasks.some((card) => card.task.id === taskId)) found = true;
      }
      requireResult(found, "List the specified test task on a visible board.");
      const read = await call("tasks_read", args);
      requireResult(
        read.task.id === taskId && !read.lease,
        "Supply a visible, unclaimed test task.",
      );
      const missing = { taskId: NodeCrypto.randomUUID() };
      await expectError("tasks_read", missing);
      await expectError("tasks_claim", missing);
      await expectError("tasks_release", { ...release, ...missing });
      await expectError("tasks_release", { ...release, reason: "invalid" });
      const actors = [client, peer];
      try {
        const claim = (actor) => call("tasks_claim", args, actor);
        const results = manifest.atomicClaim
          ? await Promise.allSettled(actors.map(claim)).then((results) =>
              results.map((r) => {
                if (r.status === "rejected") throw r.reason;
                return r.value;
              }),
            )
          : [await claim(client), await claim(peer)];
        const winner = results.findIndex((r) => r.status === "claimed");
        requireResult(
          winner >= 0 && results[1 - winner].status === "conflict",
          "Use distinct actors sharing one store. Exactly one claim must win.",
        );
        requireResult(
          (await call("tasks_release", release, actors[1 - winner])).status === "not_holder",
          "Reject release by the competing actor.",
        );
        requireResult(
          (await claim(actors[1 - winner])).status === "conflict",
          "Keep the winner's claim after a non-holder release.",
        );
        requireResult(
          (await claim(actors[winner])).status === "claimed",
          "Make a repeated holder claim succeed.",
        );
        requireResult(
          (await call("tasks_release", release, actors[winner])).status === "released",
          "Allow the holder to release.",
        );
        requireResult(
          (await call("tasks_release", release, actors[winner])).status === "not_holder",
          "Clear the claim on release.",
        );
      } catch (error) {
        await Promise.allSettled(actors.map((actor) => call("tasks_release", release, actor)));
        throw error;
      }
    });
  }
  if (manifest.capabilities.includes("memory")) {
    await run("memory proposal, search, use and dispute", async () => {
      const key = "checker-" + NodeCrypto.randomUUID();
      const proposal = { key, text: key, source: "checker", scope: "project", kind: "project" };
      const memory = async (op, args) =>
        JSON.parse((await call("banneret_memory_" + op, args)).data);
      const verify = (note, trust, count) =>
        requireResult(
          Object.entries(proposal).every(([k, v]) => note[k] === v) &&
            note.trust === trust &&
            note.useCount === count,
          "Preserve the proposal fields and return trust " + trust + " and useCount " + count + ".",
        );
      await expectError("banneret_memory_read", { key });
      verify(
        await memory("propose", { ...proposal, confirmed: true, trust: "confirmed" }),
        "proposed",
        0,
      );
      verify(await memory("read", { key }), "proposed", 0);
      const hits = await memory("search", { query: key });
      const hit = hits.find((n) => n.key === key);
      requireResult(hit, "Return the newly proposed note from search by its text.");
      verify(hit, "proposed", 0);
      verify(await memory("use", { key }), "proposed", 1);
      verify(await memory("use", { key }), "proposed", 1);
      verify(await memory("flag", { key, reason: "Conformance test" }), "disputed", 1);
      verify(
        await memory("flag", {
          key,
          reason: "Conformance test",
          resolve: true,
          trust: "confirmed",
        }),
        "disputed",
        1,
      );
      verify(await memory("read", { key }), "disputed", 1);
    });
  }
  for (const capability of new Set(
    manifest.capabilities.filter((c) => !["tasks", "memory", "skills"].includes(c)),
  )) {
    checks.push({ name: capability, status: "skip", hint: "No published conformance contract." });
  }
  return {
    passed:
      checks.every((c) => c.status !== "fail") &&
      checks.some((c) => c.name !== "tools/list" && c.status === "pass"),
    checks,
  };
}
