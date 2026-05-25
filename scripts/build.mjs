import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import esbuild from "esbuild";

const root = resolve(".");
const outMain = resolve(root, "dist/main.js");
const outUi = resolve(root, "dist/ui.html");

await mkdir(dirname(outMain), { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, "src/main.ts")],
  outfile: outMain,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2017",
  supported: {
    "object-rest-spread": false
  },
  legalComments: "none"
});

await copyFile(resolve(root, "src/ui.html"), outUi);
