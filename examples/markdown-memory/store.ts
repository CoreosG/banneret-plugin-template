import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { memoryTools } from "../../vendor/kit/src/memory.ts";

const proposal = memoryTools.banneret_memory_propose.input;
const metadata = proposal.omit({ text: true }).extend({
  created: z.int(),
  confirmedAt: z.int().nullable(),
  lastUsedAt: z.int().nullable(),
  useCount: z.int().nonnegative(),
  pinned: z.union([z.literal(0), z.literal(1)]),
  disputedAt: z.int().nullable(),
  disputeReason: z.string().nullable(),
  useChatHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).optional(),
});
type Note = z.infer<typeof metadata> & { text: string };
const day = 86400000;

function trust(note: Note, now: number) {
  if (note.disputeReason !== null) return "disputed";
  if (note.confirmedAt === null) return "proposed";
  if (note.pinned) return "pinned";
  const idle = now - (note.lastUsedAt ?? note.created);
  if (idle >= 90 * day) return "archived";
  if (idle >= 45 * day) return "stale";
  if (note.useCount >= 3 && now - (note.disputedAt ?? note.created) >= 30 * day) return "trusted";
  return "confirmed";
}

function view(note: Note, now: number) {
  return { ...proposal.parse(note), useCount: note.useCount, trust: trust(note, now) };
}

function format({ text, useChatHashes, ...fields }: Note, now: number) {
  const header = stringify({
    name: fields.key, description: text.split("\n")[0].slice(0, 160), type: fields.kind,
    key: fields.key, kind: fields.kind, scope: fields.scope, source: fields.source,
    created: fields.created, confirmedAt: fields.confirmedAt, lastUsedAt: fields.lastUsedAt,
    useCount: fields.useCount, pinned: fields.pinned, disputedAt: fields.disputedAt,
    disputeReason: fields.disputeReason, trust: trust({ ...fields, text }, now), ...(useChatHashes && { useChatHashes }),
  });
  return `---\n${header}---\n${text}\n`;
}

export function openFolder(folder: string, clock = Date.now) {
  mkdirSync(folder, { recursive: true });
  const path = (key: string) => join(folder, `note-${proposal.shape.key.parse(key)}.md`);
  function load(key: string) {
    const fd = openSync(path(key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const content = readFileSync(fd, "utf8").replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
      const match = /^---\n([\s\S]*?)\n---[ \t]*\n([\s\S]*)$/.exec(content);
      if (!match) throw new Error("Invalid note file");
      const fields = metadata.parse(parse(match[1], { maxAliasCount: 0 }));
      if (fields.key !== key) throw new Error("Filename and note key differ");
      return { ...fields, text: proposal.shape.text.parse(match[2].replace(/\n$/, "")) };
    } finally {
      closeSync(fd);
    }
  }
  function shared(key: string) {
    const note = load(key);
    if (note.scope !== "project") throw new Error("Unknown project note");
    return note;
  }
  function list() {
    return readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^note-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(entry.name))
      .map(entry => entry.name.slice(5, -3)).sort().map(load).filter(note => note.scope === "project");
  }
  function write(file: string, content: string, createOnly = false) {
    const temp = join(folder, "." + randomUUID());
    writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
    try {
      if (createOnly) linkSync(temp, file);
      else renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  const indexFile = join(folder, "MEMORY.md");
  const indexHeader = "# Memory\n\n<!-- Banneret index -->\n";
  function index() {
    const names = list().map(note => `note-${note.key}.md`);
    write(indexFile, indexHeader + names.map(name => `- [${name}](${name})`).join("\n"));
  }
  const existing = readdirSync(folder, { withFileTypes: true }).find(e => e.name === "MEMORY.md");
  if (existing && (!existing.isFile() || !readFileSync(indexFile, "utf8").startsWith(indexHeader)))
    throw new Error("Folder contains an unrelated MEMORY.md");
  index();

  return {
    propose(input: z.infer<typeof proposal>) {
      const fields = proposal.parse(input);
      if (fields.scope !== "project") throw new Error("Only shared project notes are accepted");
      if (!fields.text.trim()) throw new Error("Empty note");
      const now = clock();
      const note = { ...fields, created: now, confirmedAt: null, lastUsedAt: null, useCount: 0,
        pinned: 0 as const, disputedAt: null, disputeReason: null };
      write(path(note.key), format(note, now), true);
      index();
      return view(note, now);
    },
    read(key: string) { return view(shared(key), clock()); },
    search(query: string) {
      const needle = query.toLowerCase();
      const now = clock();
      return list().filter(note => [note.key, note.text, note.source].some(s => s.toLowerCase().includes(needle)))
        .map(note => view(note, now));
    },
    use(key: string, chat: string) {
      const note = shared(key);
      const hash = createHash("sha256").update(JSON.stringify([key, chat])).digest("hex");
      note.useChatHashes ??= [];
      if (!note.useChatHashes.includes(hash)) {
        note.useChatHashes.push(hash);
        note.useCount++;
      }
      const now = clock();
      note.lastUsedAt = now;
      write(path(key), format(note, now));
      return view(note, now);
    },
    flag(key: string, reason: string) {
      const note = shared(key);
      const now = clock();
      note.disputedAt = now;
      note.disputeReason = reason;
      write(path(key), format(note, now));
      return view(note, now);
    },
  };
}
