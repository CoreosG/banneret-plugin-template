import { listen } from "./server.ts";

const port = Number(process.env.PORT ?? 8787);
await listen(port, "https://api.linear.app/graphql", process.env.LINEAR_AGENT ?? "banneret");
console.log(`Linear MCP endpoint: http://127.0.0.1:${port}/mcp`);
