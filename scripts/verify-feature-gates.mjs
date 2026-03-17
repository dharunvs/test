import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const repoRoot = process.cwd();
const manifestPath = resolve(repoRoot, "docs/04_delivery/03_feature_gate_manifest.json");
const runbookPath = resolve(repoRoot, "docs/04_delivery/03_manual_runbooks.md");
const executeChecks = process.argv.includes("--execute");

if (!existsSync(manifestPath)) {
  console.error(`Feature gate manifest not found: ${manifestPath}`);
  process.exit(1);
}

if (!existsSync(runbookPath)) {
  console.error(`Manual runbook file not found: ${runbookPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const runbook = readFileSync(runbookPath, "utf8");

const requiredFeatures = Array.from({ length: 16 }, (_, index) => `F${index + 1}`);
const features = Array.isArray(manifest.features) ? manifest.features : [];
const executedChecks = new Set();

const errors = [];

function findPackageRoot(filePath) {
  let current = dirname(filePath);

  while (true) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
          return {
            packageRoot: current,
            packageName: parsed.name.trim()
          };
        }
      } catch {
        return null;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function runCommand({ featureKey, command, key }) {
  if (executedChecks.has(key)) {
    return;
  }

  executedChecks.add(key);
  console.log(`[feature-gate] executing ${featureKey}: ${command}`);
  const result = spawnSync(command, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true
  });

  if (result.status !== 0) {
    errors.push(`${featureKey} automated check failed: ${command}`);
  }
}

for (const featureKey of requiredFeatures) {
  const entry = features.find((item) => item?.feature === featureKey);
  if (!entry) {
    errors.push(`Missing manifest entry for ${featureKey}`);
    continue;
  }

  if (!entry.automated?.id || typeof entry.automated.id !== "string") {
    errors.push(`${featureKey} is missing automated.id`);
  }
  if (!entry.manual?.id || typeof entry.manual.id !== "string") {
    errors.push(`${featureKey} is missing manual.id`);
  }

  if (entry.automated?.type === "test") {
    const ref = entry.automated?.ref;
    if (!ref || typeof ref !== "string") {
      errors.push(`${featureKey} automated test ref is missing`);
    } else {
      const absPath = resolve(repoRoot, ref);
      if (!existsSync(absPath)) {
        errors.push(`${featureKey} automated test ref does not exist: ${ref}`);
      } else if (executeChecks) {
        const packageInfo = findPackageRoot(absPath);
        if (!packageInfo) {
          errors.push(`${featureKey} automated test ref is not inside a valid package: ${ref}`);
        } else {
          const testPath = relative(packageInfo.packageRoot, absPath).split(sep).join("/");
          const command = `pnpm --filter ${packageInfo.packageName} exec vitest run --passWithNoTests ${testPath}`;
          runCommand({
            featureKey,
            command,
            key: `test:${packageInfo.packageName}:${testPath}`
          });
        }
      }
    }
  }

  if (executeChecks && typeof entry.automated?.command === "string" && entry.automated.command.trim().length > 0) {
    const command = entry.automated.command.trim();
    runCommand({
      featureKey,
      command,
      key: `command:${command}`
    });
  }

  const manualId = String(entry.manual?.id ?? "").trim();
  if (manualId.length > 0) {
    const marker = `## ${manualId}`;
    if (!runbook.includes(marker)) {
      errors.push(`${featureKey} manual runbook section not found: ${manualId}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Feature gate validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (executeChecks) {
  console.log(
    `Feature gate manifest validated for ${requiredFeatures.length} features with ${executedChecks.size} automated checks executed.`
  );
} else {
  console.log(`Feature gate manifest validated for ${requiredFeatures.length} features.`);
}
