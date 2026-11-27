import { listen } from "./server.ts";

const folder = process.env.MEMORY_FOLDER;
const credentials = process.env.MEMORY_CHAT_TOKENS;
if (!folder || !credentials) throw new Error("Set MEMORY_FOLDER and MEMORY_CHAT_TOKENS");
const port = Number(process.env.PORT ?? 8787);
await listen(port, folder, JSON.parse(credentials));
console.log(`Markdown memory endpoint: http://127.0.0.1:${port}/mcp`);
