import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? ".");
const maxBlobBytes = 8_000_000;
const excludedDirs = new Set([
  ".git", ".claude", "node_modules", "dist", "logs", "memory", "external-inbox",
  "portable-claude-home", "backups-src", "Output", "optimizer-runs", "converted", "audits",
]);
const excludedFiles = new Set([".env", ".DS_Store"]);
const binaryExts = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".7z",
  ".exe", ".dll", ".pyc", ".ck" + "pt", ".p" + "th", ".w" + "em",
]);
const patterns = [
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { name: "NVIDIA API key", re: /\bnvapi-[0-9A-Za-z_-]{20,}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "Bearer token", re: /\bbearer\s+[A-Za-z0-9._-]{16,}\b/i },
  {
    name: "secret assignment",
    re: /\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|pwd|cookie)\b\s*[:=]\s*["']?[^"'\s]{8,}/i,
  },
  {
    name: "private project marker",
    // Assemble marker literals so the scanner itself needs no blanket exemption.
    re: new RegExp("\\b(" + ["private-" + "persona", "persona-" + "card", "persona-" + "v2",
      "voice-" + "rip", "audio-" + "rip", "private-" + "companion"].join("|") +
      ")\\b|\\.(" + ["w" + "em", "ck" + "pt", "p" + "th"].join("|") + ")\\b", "i"),
  },
];

type Finding = { file: string; line: number; pattern: string };
const findings: Finding[] = [];
const scanned = new Set<string>();
function record(file: string, pattern: string, line = 0) {
  findings.push({ file, line, pattern });
}
function scanText(text: string, file: string) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (!pattern.re.test(lines[i])) continue;
      if (pattern.name === "secret assignment" && /\b(process\.env|config\.|cfg\.|opts\.|this\.client|envPath)\b/.test(lines[i])) continue;
      record(file, pattern.name, i + 1);
    }
  }
}
async function scanFile(file: string) {
  if (scanned.has(file)) return;
  scanned.add(file);
  const rel = path.relative(root, file);
  try { scanText(await readFile(file, "utf8"), rel); }
  catch { record(rel, "unreadable working file"); }
}
async function walk(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) await walk(full);
    } else if (entry.isFile() && !excludedFiles.has(entry.name) && !entry.name.includes(".bak") && !binaryExts.has(path.extname(entry.name).toLowerCase())) {
      if ((await stat(full)).size <= 1_000_000) await scanFile(full);
    }
  }
}

try { await walk(root); }
catch { record("working tree", "unable to complete working-tree scan"); }

// The index is the next commit's payload. Its bytes can differ from the worktree,
// including when a tracked file was deleted locally. Read each actual stage-0 blob.
// Ignore rules, binary extensions and the scanner's own path do not exempt it.
if (existsSync(path.join(root, ".git"))) {
  try {
    const git = (args: string[]) => execFileSync("git", args, {
      cwd: root, maxBuffer: maxBlobBytes, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8");
    const entries = git(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean);
    for (const entry of entries) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
      if (!match) { record("Git index", "unreadable index entry"); continue; }
      const [, mode, oid, stage, rel] = match;
      const label = `index:${rel}`;
      if (rel !== ".env.example" && /(^|\/)(\.env(?:\..*)?|\.claude|\.codex|memory|logs|sessions|transcripts|private|data)(\/|$)/i.test(rel)) record(label, "private tracked path");
      if (stage !== "0") { record(label, "unresolved index conflict"); continue; }
      if (mode !== "100644" && mode !== "100755") { record(label, "tracked link or submodule requires separate review"); continue; }
      try { scanText(git(["cat-file", "blob", oid]), label); }
      catch { record(label, "unreadable or oversized index blob"); }
      const full = path.join(root, rel);
      if (existsSync(full) && !binaryExts.has(path.extname(full).toLowerCase())) await scanFile(full);
    }
  } catch { record("Git index", "unable to complete index scan"); }
}

if (findings.length > 0) {
  console.error(`Secret/private scan found ${findings.length} issue(s):`);
  for (const item of findings.slice(0, 80)) {
    console.error(`${item.file}:${item.line} [${item.pattern}] (content redacted)`);
  }
  if (findings.length > 80) console.error(`...and ${findings.length - 80} more`);
  process.exit(1);
}
console.log(`Secret/private scan passed for ${root}`);
