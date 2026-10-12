// Starts Electron with ELECTRON_RUN_AS_NODE removed. Terminals inside VS Code (itself Electron) export it,
// which would make Electron run as plain Node and fail to load the "electron" module.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
