import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipFeatureGates = args.has("--skip-feature-gates");
const skipWebE2e = args.has("--skip-web");
const skipExtensionE2e = args.has("--skip-extension");

const steps = [
  {
    id: "feature-gates",
    command: "pnpm feature-gates:verify",
    enabled: !skipFeatureGates
  },
  {
    id: "web-e2e",
    command: "pnpm e2e:web",
    enabled: !skipWebE2e
  },
  {
    id: "extension-e2e",
    command: "pnpm e2e:extension",
    enabled: !skipExtensionE2e
  }
];

for (const step of steps) {
  if (!step.enabled) {
    continue;
  }

  console.log(`[pilot-flow] running ${step.id}: ${step.command}`);
  const result = spawnSync(step.command, {
    cwd: process.cwd(),
    shell: true,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error(`[pilot-flow] step failed: ${step.id}`);
    process.exit(result.status ?? 1);
  }
}

console.log("[pilot-flow] MVP pilot flow checks passed");
