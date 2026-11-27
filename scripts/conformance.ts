import { spawn } from "node:child_process";
import { once } from "node:events";
import { listen } from "../src/server.ts";

const http = await listen(0);
try {
  const addr = http.address();
  if (!addr || typeof addr === "string")
    throw new Error("Expected a listening TCP socket");
  const checker = process.env.BANNERET_CHECKER ?? "vendor/kit/checker/cli.mjs";
  const child = spawn(
    process.execPath,
    [
      checker,
      "--manifest",
      "plugin.json",
      "--task-id",
      "T1",
      "--url",
      `http://127.0.0.1:${addr.port}/mcp`,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        BANNERET_CHECK_TOKEN: "demo-alice",
        BANNERET_CHECK_PEER_TOKEN: "demo-bob",
      },
    },
  );
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally {
  http.close();
}
