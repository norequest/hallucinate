import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

/** Extension host: CJS, node platform, vscode external. */
const host = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
};

/** Webview client: browser IIFE, no externals. */
const webview = {
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview/main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

/** Library webview client: browser IIFE, no externals. */
const libraryWebview = {
  entryPoints: ["src/webview/library-main.ts"],
  outfile: "dist/webview/library-main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

/** Anatomy editor webview client: browser IIFE, no externals. */
const anatomyWebview = {
  entryPoints: ["src/webview/anatomy-main.ts"],
  outfile: "dist/webview/anatomy-main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

/** Full-width review webview client: browser IIFE, no externals. */
const reviewWebview = {
  entryPoints: ["src/webview/review-main.ts"],
  outfile: "dist/webview/review-main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

function copyStyles() {
  mkdirSync("dist/webview", { recursive: true });
  copyFileSync("src/webview/style.css", "dist/webview/style.css");
  copyFileSync("src/webview/library.css", "dist/webview/library.css");
  copyFileSync("src/webview/anatomy.css", "dist/webview/anatomy.css");
}

if (watch) {
  const a = await context(host);
  const b = await context(webview);
  const c = await context(libraryWebview);
  const d = await context(anatomyWebview);
  const f = await context(reviewWebview);
  await Promise.all([a.watch(), b.watch(), c.watch(), d.watch(), f.watch()]);
  copyStyles();
  console.log("esbuild watching...");
} else {
  await Promise.all([build(host), build(webview), build(libraryWebview), build(anatomyWebview), build(reviewWebview)]);
  copyStyles();
  console.log("esbuild done");
}
