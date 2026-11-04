import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import type { Assets } from "../src/server.js";

export async function buildAssets(): Promise<Assets> {
  const result = await build({
    entryPoints: ["src/ui/app.ts"], bundle: true, minify: true, format: "esm",
    target: "chrome120", outfile: "app.js", write: false, legalComments: "none"
  });
  const js = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Bud's UI assets were not generated.");
  return { html: await readFile("src/ui/index.html", "utf8"), js, css };
}
