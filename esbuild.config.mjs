import esbuild from "esbuild";
import process from "node:process";

const mode = process.argv[2] ?? "production";
const isDev = mode === "dev";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "node",
  format: "cjs",
  sourcemap: isDev ? "inline" : false,
  sourcesContent: isDev,
  minify: !isDev,
  treeShaking: true,
  target: "es2022",
  logLevel: "info",
  external: ["obsidian", "electron", "@codemirror/*"],
  banner: {
    js: "/* eslint-disable */",
  },
});

if (isDev) {
  await ctx.watch();
  console.log("[obsidian-codex] watching");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
