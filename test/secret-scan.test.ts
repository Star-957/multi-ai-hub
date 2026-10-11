import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(new URL("../scripts/secret-scan.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const syntheticToken = "sk-" + "SYNTHETIC_ONLY_".repeat(3);

async function fixture(run: (root: string, git: (args: string[], input?: string) => string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hub-scanner-test-"));
  const git = (args: string[], input?: string) => execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], {
    cwd: root, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  try {
    git(["-c", "init.templateDir=", "init", "-q"]);
    await run(root, git);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("hub-scanner-test-"));
    await rm(root, { recursive: true, force: true });
  }
}
function scan(root: string) {
  const result = spawnSync(process.execPath, [tsx, scanner, root], { encoding: "utf8", timeout: 30_000 });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(syntheticToken), "scanner must redact matched contents");
  return { code: result.status, output };
}

test("scan inspects staged blobs even after worktree cleanup or deletion", async () => fixture(async (root, git) => {
  const file = path.join(root, "config.txt");
  await writeFile(file, "safe placeholder\n");
  git(["add", "--", "config.txt"]);
  assert.equal(scan(root).code, 0);
  await writeFile(file, syntheticToken);
  assert.equal(scan(root).code, 1, "working-tree control");
  git(["add", "--", "config.txt"]);
  await writeFile(file, "safe placeholder\n");
  const staged = scan(root);
  assert.equal(staged.code, 1);
  assert.match(staged.output, /index:config.txt/);
  await rm(file);
  assert.equal(scan(root).code, 1);
}));

test("index scan does not exempt binary extensions or its own script path", async () => fixture(async (root, git) => {
  await mkdir(path.join(root, "scripts"));
  for (const name of ["fixture.png", "scripts/secret-scan.ts"]) {
    await writeFile(path.join(root, name), syntheticToken);
    git(["add", "--", name]);
    await writeFile(path.join(root, name), "clean working copy");
  }
  const result = scan(root);
  assert.equal(result.code, 1);
  assert.match(result.output, /index:fixture.png/);
  assert.match(result.output, /index:scripts\/secret-scan.ts/);
}));

test("private tracked paths are rejected even with harmless contents", async () => fixture(async (root, git) => {
  await writeFile(path.join(root, ".env"), "SYNTHETIC=placeholder");
  git(["add", "--", ".env"]);
  assert.match(scan(root).output, /private tracked path/);
}));

test("unresolved index stages and missing blobs fail closed", async () => fixture(async (root, git) => {
  const oid = git(["hash-object", "-w", "--stdin"], "synthetic harmless blob\n");
  git(["update-index", "--index-info"], `100644 ${oid} 1\tconflict.txt\n100644 ${oid} 2\tconflict.txt\n`);
  const conflict = scan(root);
  assert.equal(conflict.code, 1);
  assert.match(conflict.output, /unresolved index conflict/);
  git(["update-index", "--add", "--cacheinfo", `100644,${"a".repeat(40)},missing.txt`]);
  const missing = scan(root);
  assert.equal(missing.code, 1);
  assert.match(missing.output, /unreadable or oversized index blob/);
}));
