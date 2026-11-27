import { z } from "zod";

const text = z.string().min(1);
const key = z.object({
  key: z
    .string()
    .max(96)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const proposal = key.extend({
  text: text.max(4096),
  source: text.max(512),
  kind: z.enum(["user", "feedback", "project", "reference"]),
  scope: z.enum(["personal", "project"]),
});
const note = proposal.extend({
  trust: z.enum(["proposed", "confirmed", "trusted", "pinned", "stale", "archived", "disputed"]),
  useCount: z.int().nonnegative(),
});

// The Hub memory tools carry JSON inside a string-valued data field.
function memoryResult(schema: z.ZodType) {
  return z.object({
    data: z.string().refine((value) => {
      try {
        return schema.safeParse(JSON.parse(value)).success;
      } catch {
        return false;
      }
    }, "Expected JSON matching the memory result shape."),
  });
}

export const memoryTools = {
  banneret_memory_search: {
    input: z.object({ query: text.max(256) }),
    output: memoryResult(z.array(note)),
  },
  banneret_memory_read: { input: key, output: memoryResult(note) },
  banneret_memory_use: { input: key, output: memoryResult(note) },
  banneret_memory_propose: {
    input: proposal,
    output: memoryResult(note.extend({ trust: z.literal("proposed") })),
  },
  banneret_memory_flag: {
    input: key.extend({ reason: text.max(512) }),
    output: memoryResult(note.extend({ trust: z.literal("disputed") })),
  },
};
