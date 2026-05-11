import net from "node:net";
import { spawn } from "node:child_process";

const START_PORT = Number(process.env.TERMINUS_DEV_START_PORT ?? 1420);
const MAX_TRIES = 30;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findOpenPort(startPort) {
  for (let offset = 0; offset < MAX_TRIES; offset++) {
    const port = startPort + offset;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + MAX_TRIES - 1}`);
}

const port = await findOpenPort(START_PORT);
const devUrl = `http://localhost:${port}`;
const tauriConfigOverride = JSON.stringify({
  build: {
    beforeDevCommand: `vite --port ${port} --strictPort`,
    devUrl,
  },
});

console.log(`[terminus] using dev port ${port}`);

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npxCmd, ["tauri", "dev", "-c", tauriConfigOverride], {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
