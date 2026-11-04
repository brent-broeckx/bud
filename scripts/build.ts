import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAssets } from "./ui-assets.js";

const directory = join(".github", "extensions", "bud");
await mkdir(directory, { recursive: true });
const assets = await buildAssets();
await build({
  entryPoints: ["src/extension.ts"], bundle: true, format: "esm", platform: "node", target: "node22",
  outfile: join(directory, "extension.mjs"), external: ["@github/copilot-sdk/extension"],
  plugins: [{
    name: "bud-ui-assets",
    setup(builder) {
      builder.onResolve({ filter: /^bud:assets$/ }, () => ({ path: "bud:assets", namespace: "bud-assets" }));
      builder.onLoad({ filter: /.*/, namespace: "bud-assets" }, () => ({
        contents: `export default ${JSON.stringify(assets)};`, loader: "js"
      }));
    }
  }]
});
await writeFile(join(directory, "package.json"), JSON.stringify({ name: "bud-canvas", private: true, version: "0.1.0", type: "module", main: "extension.mjs", engines: { node: ">=22.13.0" } }, null, 2) + "\n");
const notices = await Promise.all(["@primer/css", "@primer/primitives"].map(async name =>
  `${name}\n${await readFile(join("node_modules", ...name.split("/"), "LICENSE"), "utf8")}`
));
await writeFile(join(directory, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n"));
console.log(`Built ${directory}: host-provided SDK, bundled UI and content, no runtime npm install.`);
