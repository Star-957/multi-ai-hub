import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? ".");

const excludedDirs = new Set([
  ".git",
  ".claude",
  "node_modules",
  "dist",
  "logs",
  "memory",
  "external-inbox",
  "portable-claude-home",
  "backups-src",
  "Output",
  "optimizer-runs",
  "converted",
  "audits",
]);

const excludedFiles = new Set([".env", ".DS_Store"]);
const binaryExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".7z",
  ".exe",
  ".dll",
  ".pyc",
  ".ckpt",
  ".pth",
  ".wem",
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
    re: /\b(private-persona|persona-card|persona-v2|voice-rip|audio-rip|private-companion)\b|\.wem\b|\.ckpt\b|\.pth\b/i,
  },
];

type Finding = { file: string; line: number; pattern: string };
const findings: Finding[] = [];
const scanned = new Set<string>();

async function walk(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      await walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (excludedFiles.has(entry.name) || entry.name.includes(".bak")) continue;
    if (binaryExts.has(path.extname(entry.name).toLowerCase())) continue;
    const info = await stat(full);
    if (info.size > 1_000_000) continue;
    await scanFile(full);
  }
}

async function scanFile(file: string) {
  if (scanned.has(file)) return;
  scanned.add(file);
  const rel = path.relative(root, file);
  if (rel.replace(/\\/g, "/") === "scripts/secret-scan.ts") return;
  const text = await readFile(file, "utf8").catch(() => "");
  if (!text) return;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.re.test(lines[i])) {
        if (
          pattern.name === "secret assignment" &&
          /\b(process\.env|config\.|cfg\.|opts\.|this\.client|envPath)\b/.test(lines[i])
        ) {
          continue;
        }
        findings.push({
          file: rel,
          line: i + 1,
          pattern: pattern.name,
        });
      }
    }
  }
}

await walk(root);

// Ignore rules do not protect files already tracked by Git. Inspect those as well,
// including paths excluded from the ordinary working-directory scan.
if (existsSync(path.join(root, ".git"))) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const rel of tracked) {
    if (rel !== ".env.example" && /(^|\/)(\.env(?:\..*)?|\.claude|\.codex|memory|logs|sessions|transcripts|private|data)(\/|$)/i.test(rel)) {
      findings.push({ file: rel, line: 0, pattern: "private tracked path" });
    }
    const file = path.join(root, rel);
    if (existsSync(file) && !binaryExts.has(path.extname(file).toLowerCase())) await scanFile(file);
  }
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
