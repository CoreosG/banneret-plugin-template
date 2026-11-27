import { z } from "zod";
import { BoardCard, Id, TaskRead } from "./tasks.ts";
import { memoryTools } from "./memory.ts";

const capability = z.enum(["tasks", "skills", "memory", "chat", "search", "health"]);
const text = z.string().min(1);
export const manifestSchema = z
  .object({
    source: Id,
    description: text,
    auth: z.enum(["per-user-token", "service"]),
    capabilities: z.array(capability).min(1),
    toolPrefix: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    atomicClaim: z.boolean().optional(),
  })
  .refine((m) => !m.capabilities.includes("tasks") || m.atomicClaim !== undefined, {
    message: "Task providers must declare atomicClaim.",
    path: ["atomicClaim"],
  });
const name = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const skill = z.object({ name, description: text });
const byTask = z.object({ taskId: Id });

export const tools = {
  tasks_list_boards: {
    input: z.object({}),
    output: z.object({ boards: z.array(z.object({ id: Id, title: text })) }),
  },
  tasks_list_tasks: {
    input: z.object({ boardId: Id }),
    output: z.object({ tasks: z.array(BoardCard) }),
  },
  tasks_read: { input: byTask, output: TaskRead },
  tasks_claim: {
    input: byTask,
    output: z.object({ status: z.enum(["claimed", "conflict"]) }),
  },
  tasks_release: {
    input: byTask.extend({
      reason: z.enum([
        "done",
        "blocked",
        "handing_over",
        "out_of_usage",
        "wrong_approach",
        "duplicate",
        "deprioritised",
        "other",
      ]),
      note: text.max(2048).optional(),
      freeToContinue: z.boolean(),
    }),
    output: z.object({ status: z.enum(["released", "not_holder"]) }),
  },
  skills_list: { input: z.object({}), output: z.object({ skills: z.array(skill) }) },
  skills_get: { input: z.object({ name }), output: skill.extend({ text }) },
  ...memoryTools,
} as const;

type ToolName = keyof typeof tools;
export type ToolInput<N extends ToolName> = z.infer<(typeof tools)[N]["input"]>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof tools)[N]["output"]>;

export function skillUri(skillName: string) {
  return `skill://${name.parse(skillName)}/`;
}

interface Transport {
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  readResource(
    uri: string,
  ): Promise<{ contents: ReadonlyArray<{ uri: string; mimeType?: string; text?: string }> }>;
}

export function fakeHub(manifest: z.input<typeof manifestSchema>, transport: Transport) {
  const config = manifestSchema.parse(manifest);
  return {
    async call<N extends ToolName>(tool: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
      const owner = tool.startsWith("banneret_memory_")
        ? "memory"
        : tool.startsWith("skills_")
          ? "skills"
          : "tasks";
      if (!config.capabilities.includes(owner)) throw new Error(`Missing capability: ${owner}`);
      const result = await transport.callTool(
        (config.toolPrefix ?? "") + tool,
        tools[tool].input.parse(input),
      );
      if (result.isError) throw new Error(`Provider failed: ${tool}`);
      return tools[tool].output.parse(result.structuredContent) as ToolOutput<N>;
    },
    async readSkill(skillName: string) {
      if (!config.capabilities.includes("skills")) throw new Error("Missing capability: skills");
      const uri = skillUri(skillName);
      const { contents } = await transport.readResource(uri);
      const resource = contents.find(
        (item) => item.uri === uri && item.mimeType === "text/markdown",
      );
      return text.parse(resource?.text);
    },
  };
}
