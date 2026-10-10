import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = process.cwd();
const extensionDir = path.join(rootDir, "extension");
const publicDir = path.join(rootDir, "public");
const zipPath = path.join(publicDir, "handsfree-extension.zip");

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log("📦 Packaging Handsfree Chrome Extension...");

try {
  // Use system zip utility
  execSync(`cd "${rootDir}" && zip -r "${zipPath}" extension -x "*.DS_Store"`, {
    stdio: "inherit",
  });
  const stat = fs.statSync(zipPath);
  console.log(`✅ Successfully packaged handsfree-extension.zip (${(stat.size / 1024).toFixed(1)} KB) to public/handsfree-extension.zip`);
} catch (err) {
  console.error("Packaging failed:", err);
  process.exit(1);
}
