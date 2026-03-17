import { readFile } from "node:fs/promises";
import path from "node:path";

const packageFiles = [
  "apps/api-server/package.json",
  "apps/worker/package.json",
  "apps/vscode-extension/package.json"
];

let failed = false;

for (const file of packageFiles) {
  const fullPath = path.resolve(process.cwd(), file);
  const raw = await readFile(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  const lintScript = parsed?.scripts?.lint;

  if (typeof lintScript !== "string" || lintScript.trim().length === 0) {
    console.error(`[lint-check] Missing lint script: ${file}`);
    failed = true;
    continue;
  }

  if (lintScript.includes("placeholder")) {
    console.error(`[lint-check] Placeholder lint script detected: ${file} -> ${lintScript}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("[lint-check] All lint scripts are non-placeholder.");
