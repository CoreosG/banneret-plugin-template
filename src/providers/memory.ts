import type { ToolInput } from "../../vendor/kit/src/index.ts";
import type { Register } from "../registry.ts";

type Note = ToolInput<"banneret_memory_propose"> & {
  trust: "proposed" | "disputed";
  chats: Set<string>;
};
function view({ chats, ...note }: Note) {
  return { ...note, useCount: chats.size };
}
const encode = (value: unknown) => ({ data: JSON.stringify(value) });

export function createNotebook() {
  const notes = new Map<string, Note>();
  function read(key: string) {
    const note = notes.get(key);
    if (!note) throw new Error("Unknown note");
    return note;
  }
  return function registerMemory(add: Register, chat: string) {
    add("banneret_memory_propose", (proposal) => {
      if (notes.has(proposal.key)) throw new Error("Key already exists");
      const note: Note = { ...proposal, trust: "proposed", chats: new Set() };
      notes.set(note.key, note);
      return encode(view(note));
    });
    add("banneret_memory_read", ({ key }) => encode(view(read(key))));
    add("banneret_memory_search", ({ query }) =>
      encode(
        [...notes.values()]
          .filter(
            (note) => note.text.includes(query) || note.key.includes(query),
          )
          .map(view),
      ),
    );
    add("banneret_memory_use", ({ key }) => {
      const note = read(key);
      note.chats.add(chat);
      return encode(view(note));
    });
    add("banneret_memory_flag", ({ key }) => {
      const note = read(key);
      note.trust = "disputed";
      return encode(view(note));
    });
  };
}
