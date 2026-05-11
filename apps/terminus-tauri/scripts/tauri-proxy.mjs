import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const nodeCmd = process.platform === "win32" ? "node.exe" : "node";

const isDev = args[0] === "dev";

const child = isDev
  ? spawn(nodeCmd, ["scripts/tauri-dev-safe.mjs"], { stdio: "inherit", shell: false })
  : spawn(npxCmd, ["tauri", ...args], { stdio: "inherit", shell: false });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
