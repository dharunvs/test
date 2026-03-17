import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { glob } from "node:fs/promises";

const includeExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".env",
  ".md",
  ".sql",
  ".sh"
]);

const ignoredPathFragments = ["node_modules/", "dist/", ".next/", ".turbo/"];

const detectors = [
  {
    name: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g
  },
  {
    name: "github_pat",
    pattern: /ghp_[A-Za-z0-9]{36}/g
  },
  {
    name: "private_key_block",
    pattern: /-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/g
  }
];

const findings = [];

for await (const file of glob("**/*", { cwd: process.cwd() })) {
  if (ignoredPathFragments.some((fragment) => file.includes(fragment))) {
    continue;
  }

  const extension = extname(file);
  if (!includeExtensions.has(extension) && !file.endsWith(".env.example")) {
    continue;
  }

  const content = await readFile(file, "utf8").catch(() => "");
  if (!content) {
    continue;
  }

  for (const detector of detectors) {
    const matches = content.match(detector.pattern);
    if (matches && matches.length > 0) {
      findings.push({
        file,
        detector: detector.name,
        count: matches.length
      });
    }
  }
}

if (findings.length > 0) {
  console.error("[secret-scan] potential secrets detected:");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.detector} (${finding.count})`);
  }
  process.exit(1);
}

console.log("[secret-scan] no known secret patterns detected.");
