import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("public build has only allowlisted demo assets and disables API connections", async () => {
  execFileSync(process.execPath, ["scripts/build-demo.mjs"], { cwd: fileURLToPath(new URL("../", import.meta.url)) });
  const output = new URL("../dist/demo/", import.meta.url);
  assert.deepEqual((await readdir(output)).sort(), ["app.js", "index.html", "runtime-config.js", "styles.css"]);
  assert.equal(await readFile(new URL("runtime-config.js", output), "utf8"), 'export const mode = "demo";\n');
  const html = await readFile(new URL("index.html", output), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /src="\.\/app.js"/);
  assert.match(html, /href="\.\/styles.css"/);
  for (const name of await readdir(output)) {
    const source = await readFile(new URL(name, output), "utf8");
    assert.doesNotMatch(source, /https?:\/\/(?:localhost|127\.0\.0\.1)/);
  }
});
