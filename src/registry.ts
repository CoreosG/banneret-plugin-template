import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  tools,
  type ToolInput,
  type ToolOutput,
} from "../vendor/kit/src/index.ts";

export function registry(server: McpServer, prefix: string) {
  return function register<N extends keyof typeof tools>(
    name: N,
    run: (args: ToolInput<N>) => ToolOutput<N>,
  ) {
    const { input, output } = tools[name];
    server.registerTool(
      prefix + name,
      { inputSchema: input as z.ZodObject },
      (args) => {
        const result = output.parse(run(input.parse(args) as ToolInput<N>));
        return {
          structuredContent: result,
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      },
    );
  };
}
export type Register = ReturnType<typeof registry>;
