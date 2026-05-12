import { existsSync, mkdtempSync, rmSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "..", "..");
const dmgDir = path.join(workspaceRoot, "target", "release", "bundle", "dmg");

function quote(value) {
  return JSON.stringify(value);
}

function findDmgFile() {
  if (!existsSync(dmgDir)) return null;
  const entries = execFileSync("/bin/ls", ["-1", dmgDir], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((name) => name.endsWith(".dmg"));
  if (entries.length === 0) return null;
  return path.join(dmgDir, entries.sort().at(-1));
}

const dmgPath = findDmgFile();
if (!dmgPath) {
  console.error("[dmg] no DMG file found to post-process");
  process.exit(1);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "terminus-dmg-"));
const rwImageBase = path.join(tempRoot, "rw-image");
const finalImageBase = path.join(tempRoot, "final-image");
const mountPoint = path.join(tempRoot, "mount");

try {
  execSync(`hdiutil convert ${quote(dmgPath)} -format UDRW -o ${quote(rwImageBase)}`, { stdio: "inherit" });
  const rwImage = `${rwImageBase}.dmg`;
  execSync(`mkdir -p ${quote(mountPoint)}`);
  execSync(`hdiutil attach ${quote(rwImage)} -nobrowse -mountpoint ${quote(mountPoint)}`, { stdio: "inherit" });

  for (const fileName of [".VolumeIcon.icns", ".DS_Store"]) {
    const target = path.join(mountPoint, fileName);
    if (existsSync(target)) {
      execSync(`SetFile -a V ${quote(target)}`, { stdio: "inherit" });
    }
  }

  execSync(`hdiutil detach ${quote(mountPoint)}`, { stdio: "inherit" });
  execSync(`hdiutil convert ${quote(rwImage)} -format UDZO -imagekey zlib-level=9 -o ${quote(finalImageBase)}`, { stdio: "inherit" });

  const finalDmg = `${finalImageBase}.dmg`;
  rmSync(dmgPath, { force: true });
  renameSync(finalDmg, dmgPath);
  console.log(`[dmg] post-processed installer: ${dmgPath}`);
} catch (error) {
  try {
    execSync(`hdiutil detach ${quote(mountPoint)}`, { stdio: "ignore" });
  } catch {}
  console.error("[dmg] post-process failed:", error?.message ?? error);
  process.exit(1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
