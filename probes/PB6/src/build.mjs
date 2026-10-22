// "moxi build" for the probe: runtime bundles (prod and dev) and plugin factory bodies.
// A plugin bundle reads `vue` and `@moxi/sdk` from the `__moxi` argument of its factory (D 3.3).
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Vue from "@vue/runtime-core";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { baseCompile, baseParse } from "@vue/compiler-core";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
mkdirSync(join(dist, "plugins"), { recursive: true });
const sizes = {};
const kib = (n) => Math.round((n / 1024) * 10) / 10;

for (const mode of ["prod", "dev"]) {
  const out = join(dist, `runtime-api1.${mode}.js`);
  await build({
    entryPoints: [join(root, "src/runtime.mjs")],
    outfile: out,
    bundle: true,
    format: "iife",
    globalName: "__moxiRuntime",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["module"],
    target: "es2022",
    minify: mode === "prod",
    define: {
      "process.env.NODE_ENV": mode === "prod" ? '"production"' : '"development"',
      __VUE_OPTIONS_API__: "false",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
  });
  const buf = readFileSync(out);
  sizes[`runtime.${mode}`] = { minKiB: kib(buf.length), gzKiB: kib(gzipSync(buf).length) };
}

const shimFor = {
  vue: (names) => `const m = __moxi.vue;\n${names.map((n) => `export const ${n} = m.${n};`).join("\n")}`,
  "@moxi/sdk": () =>
    `const m = __moxi.sdk;\nexport const definePlugin = m.definePlugin, useFact = m.useFact, probe = m.probe, Counter = m.Counter;`,
};
const vueNames = Object.keys(Vue).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== "default");

const externals = {
  name: "moxi-externals",
  setup(b) {
    b.onResolve({ filter: /^(vue|@moxi\/sdk)$/ }, (a) => ({ path: a.path, namespace: "moxi-ext" }));
    b.onLoad({ filter: /.*/, namespace: "moxi-ext" }, (a) => ({ contents: shimFor[a.path](vueNames), loader: "js" }));
  },
};

const sfc = {
  name: "sfc",
  setup(b) {
    b.onLoad({ filter: /\.vue$/ }, (a) => {
      const { descriptor, errors } = parse(readFileSync(a.path, "utf8"), { filename: a.path });
      if (errors.length) throw errors[0];
      const id = basename(a.path, ".vue");
      const script = compileScript(descriptor, { id });
      const tpl = compileTemplate({
        source: descriptor.template.content,
        filename: a.path,
        id,
        compiler: { compile: baseCompile, parse: baseParse },
        compilerOptions: { isNativeTag: () => true, hoistStatic: false, bindingMetadata: script.bindings },
      });
      if (tpl.errors.length) throw tpl.errors[0];
      const code =
        script.content.replace("export default", "const __sfc__ =") +
        "\n" + tpl.code.replace("export function render", "function render") +
        "\n__sfc__.render = render\nexport default __sfc__\n";
      return { contents: code, loader: "js" };
    });
  },
};

// Synthetic module-size fixtures: many top-level functions (what the factory re-creates per session),
// optionally a module-level data table (what a plugin author duplicates per session).
function fatSource(withTable) {
  const fns = Array.from({ length: 600 }, (_, i) => `function f${i}(a) { return a * ${i + 2} + (a % ${i + 3}) - ${i}; }`).join("\n");
  const list = Array.from({ length: 600 }, (_, i) => `f${i}`).join(", ");
  const table = withTable
    ? `const table = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: "row " + i, tags: ["a", "b"], n: i * 3 }));`
    : "const table = [];";
  return `import { h, defineComponent } from "vue";
import { definePlugin, useFact } from "@moxi/sdk";
${fns}
const all = [${list}];
${table}
const sum = all.reduce((s, f, i) => s + f(i), 0);
const target = useFact("game.target");
const View = defineComponent({ setup: () => () => h("ui-text", { text: \`fat \${all.length} \${table.length} \${sum} \${target.value.name}\` }) });
export default definePlugin({ commands: { main: View } });
`;
}
mkdirSync(join(dist, "gen"), { recursive: true });
writeFileSync(join(dist, "gen", "fat.plugin.js"), fatSource(false));
writeFileSync(join(dist, "gen", "fatdata.plugin.js"), fatSource(true));

for (const name of ["pb6", "globals", "list200", "trade500", "fat", "fatdata"]) {
  const gen = name.startsWith("fat");
  const res = await build({
    entryPoints: [gen ? join(dist, "gen", `${name}.plugin.js`) : join(root, "plugins", `${name}.plugin.js`)],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__plugin",
    platform: "neutral",
    target: "es2022",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [externals, sfc],
  });
  const body = `${res.outputFiles[0].text}\nreturn __plugin.default;\n`;
  writeFileSync(join(dist, "plugins", `${name}.factory.js`), body);
  sizes[`plugin.${name}`] = { minKiB: kib(Buffer.byteLength(body)), gzKiB: kib(gzipSync(body).length) };
}
writeFileSync(join(dist, "sizes.json"), JSON.stringify(sizes, null, 2));
console.log(JSON.stringify(sizes));
