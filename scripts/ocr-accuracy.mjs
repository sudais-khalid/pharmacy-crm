// Photo reading accuracy (roadmap task 4.15): renders synthetic supplier bills and stock lists, reads them
// with a photo reader and the parsers, and reports how many fields came out right.
//   node scripts/ocr-accuracy.mjs [count] [LOCAL|CLOUD]
// Synthetic pages are clean prints. They measure the parsers and catch regressions; they do not replace a
// test on real phone photos from pilot pharmacies (put those, with a truth.json, in a folder and run
// `npx tsx scripts/ocr-accuracy/score.mts <folder>`).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const count = process.argv[2] ?? "12";
const provider = process.argv[3] ?? "LOCAL";
const out = mkdtempSync(path.join(os.tmpdir(), "pcrm-ocr-"));
const electron = path.resolve("desktop/node_modules/.bin", process.platform === "win32" ? "electron.cmd" : "electron");

// a terminal inside an Electron editor (VS Code) may set ELECTRON_RUN_AS_NODE, which would start Electron as plain Node
const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env;
execFileSync(electron, ["scripts/ocr-accuracy/render.cjs", out, count], { stdio: "inherit", shell: process.platform === "win32", env });
execFileSync("npx", ["tsx", "scripts/ocr-accuracy/score.mts", out, provider], { stdio: "inherit", shell: process.platform === "win32" });
console.log(`\nsamples and report in ${out}`);
