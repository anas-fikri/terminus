import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "..", "..");

const appName = "Terminus.app";
const candidateAppPaths = [
  path.join(workspaceRoot, "target", "release", "bundle", "macos", appName),
  path.join(appRoot, "src-tauri", "target", "release", "bundle", "macos", appName),
];

const appPath = candidateAppPaths.find((p) => existsSync(p));
if (!appPath) {
  console.error("[installer] App bundle not found. Build app first.");
  process.exit(1);
}

const outDir = path.join(workspaceRoot, "target", "release", "bundle", "pkg");
mkdirSync(outDir, { recursive: true });

const pkgPath = path.join(outDir, "Terminus_0.1.0_aarch64.pkg");
const cmd = [
  "pkgbuild",
  "--install-location", "/Applications",
  "--component", JSON.stringify(appPath),
  JSON.stringify(pkgPath),
].join(" ");

try {
  execSync("command -v pkgbuild", { stdio: "ignore" });
} catch {
  console.error("[installer] pkgbuild not found. This script requires macOS Xcode command line tools.");
  process.exit(1);
}

console.log(`[installer] Creating PKG from: ${appPath}`);
execSync(cmd, { stdio: "inherit" });
console.log(`[installer] Created: ${pkgPath}`);
