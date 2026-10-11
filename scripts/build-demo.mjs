import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist", "demo");
const files = ["index.html", "styles.css", "app.js", "runtime-config.js"];
// Fail closed on stale files or links; never recursively copy the project or private data.
for (const dir of [path.join(root, "dist"), output]) {
  try { if ((await lstat(dir)).isSymbolicLink()) throw new Error("Build directory must not be a link."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
await mkdir(output, { recursive: true });
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (!files.includes(entry.name) || !entry.isFile()) throw new Error("Unexpected build output. Use a fresh checkout to build the demo.");
}
for (const file of files) {
  const source = path.join(root, "public", file);
  if (!(await lstat(source)).isFile()) throw new Error("Public assets must be regular files.");
  let text = await readFile(source, "utf8");
  if (file === "runtime-config.js") text = 'export const mode = "demo";\n';
  if (file === "index.html") {
    if (!text.includes("connect-src 'self'")) throw new Error("Missing expected CSP.");
    text = text.replace("connect-src 'self'", "connect-src 'none'");
  }
  await writeFile(path.join(output, file), text);
}
console.log("Built dist/demo: four static files, demo mode, no API connections.");
