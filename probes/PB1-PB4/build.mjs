// Builds dist/: the runtime (IIFE, minified) and the three fixture plugins as function bodies.
import { build, transformSync } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [join(here, "src/runtime-api1.js")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  charset: "ascii",
  write: false,
  define: {
    "process.env.NODE_ENV": '"production"',
    __VUE_OPTIONS_API__: "false",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  logLevel: "warning",
});
const runtime = result.outputFiles[0].text;
writeFileSync(join(dist, "runtime-api1.js"), runtime);

const sizes = { runtimeBytes: Buffer.byteLength(runtime) };
for (const [kind, file] of [
  ["a", "a-builds.js"],
  ["b", "b-hud.js"],
  ["c", "c-trade.js"],
  ["a2", "a2-builds-elements.js"],
  ["c2", "c2-trade-elements.js"],
]) {
  const source = readFileSync(join(here, "src/plugins", file), "utf8");
  const minified = transformSync(source, { minify: true, charset: "ascii" }).code.trim().replace(/;$/, "");
  writeFileSync(join(dist, `plugin-${kind}.js`), minified);
  sizes[`plugin_${kind}_Bytes`] = Buffer.byteLength(minified);
}
writeFileSync(join(dist, "sizes.json"), JSON.stringify(sizes));
console.log(JSON.stringify(sizes));
