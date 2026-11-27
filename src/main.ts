import { listen } from "./server.ts";

const port = Number(process.env.PORT ?? 8787);
await listen(port);
console.log(`MCP endpoint: http://127.0.0.1:${port}/mcp`);
