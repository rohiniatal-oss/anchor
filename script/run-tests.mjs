import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");
const testRoots = [path.join(repoRoot, "server"), path.join(repoRoot, "client", "src")];
const testBuildDir = path.join(repoRoot, ".tmp", "test-build");

function collectTestFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = testRoots.flatMap((dir) => collectTestFiles(dir)).sort();

if (testFiles.length === 0) {
  console.error("No test files found under server/ or client/src/.");
  process.exit(1);
}

rmSync(testBuildDir, { recursive: true, force: true });
mkdirSync(testBuildDir, { recursive: true });

const builtTestFiles = [];

for (const testFile of testFiles) {
  const relative = path.relative(repoRoot, testFile);
  const outFile = path.join(testBuildDir, relative).replace(/\.ts$/, ".mjs");
  mkdirSync(path.dirname(outFile), { recursive: true });
  await build({
    entryPoints: [testFile],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    sourcemap: "inline",
    packages: "external",
    logLevel: "silent",
  });
  builtTestFiles.push(outFile);
}

const result = spawnSync(process.execPath, ["--test", ...builtTestFiles], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
