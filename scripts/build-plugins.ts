import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { build } from "vite-plus";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "apps/plugin-host/dist/plugins");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const index: { manifest: string; script: string; bytes: number }[] = [];
const dirs = (await readdir(join(root, "plugins"), { withFileTypes: true }))
  .filter((dir) => dir.isDirectory())
  .map((dir) => join(root, "plugins", dir.name));
if (!process.argv.includes("--bundled"))
  dirs.push(join(root, "apps/plugin-host/test-fixtures/chaos"));
dirs.sort((a, b) => basename(a).localeCompare(basename(b)));
for (const dir of dirs) {
  const json = await readFile(join(dir, "plugin.json"), "utf8");
  const manifest = JSON.parse(json);
  const entry = join(out, `${manifest.id}.entry.ts`);
  await writeFile(
    entry,
    `import setup from ${JSON.stringify(join(dir, "index.ts"))};\nimport { startRuntime } from "@moxi/sdk/host";\nstartRuntime({ post: (m) => self.postMessage(m), listen: (h) => self.addEventListener("message", (e) => h(e.data)) }, setup);\n`,
  );
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      rolldownOptions: {
        input: entry,
        output: { format: "es", entryFileNames: `${manifest.id}.js` },
      },
      outDir: out,
      emptyOutDir: false,
      minify: true,
      target: "es2023",
    },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await rm(entry);
  await writeFile(join(out, `${manifest.id}.json`), json);
  const bytes = (await readFile(join(out, `${manifest.id}.js`))).byteLength;
  index.push({
    manifest: `/plugins/${manifest.id}.json`,
    script: `/plugins/${manifest.id}.js`,
    bytes,
  });
  console.log(`${manifest.id.padEnd(20)} ${(bytes / 1024).toFixed(1)} KiB`);
}
await writeFile(join(out, "index.json"), JSON.stringify(index, null, 2));
