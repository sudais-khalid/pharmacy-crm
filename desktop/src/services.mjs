/**
 * The web server and the worker run as child processes on Electron's own Node runtime
 * (ELECTRON_RUN_AS_NODE), each with its own log file. A child that stops unexpectedly is reported through
 * onExit so the supervisor can restart it.
 */
import { fork, spawn } from "node:child_process";
import { openLogStream } from "./log.mjs";

export class ChildService {
  /**
   * @param {{ name: string, script: string, cwd: string, env: Record<string, string>, logFile: string,
   *   ipc?: boolean, ready: (svc: ChildService) => Promise<void>, onExit?: (code: number | null) => void }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.proc = null;
    this.stopping = false;
  }

  get running() {
    return this.proc !== null && this.proc.exitCode === null;
  }

  async start() {
    this.stopping = false;
    const out = openLogStream(this.logFile);
    const env = { ...process.env, ...this.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production" };
    const stdio = this.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"];
    const proc = this.ipc
      ? fork(this.script, [], { cwd: this.cwd, env, execPath: process.execPath, stdio, windowsHide: true })
      : spawn(process.execPath, [this.script], { cwd: this.cwd, env, stdio, windowsHide: true });
    this.proc = proc;
    this.output = "";
    const capture = (d) => {
      out.write(d);
      this.output = (this.output + d).slice(-4000);
    };
    proc.stdout.on("data", capture);
    proc.stderr.on("data", capture);
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.once("exit", (code) => {
      out.end();
      if (!this.stopping) this.onExit?.(code);
    });
    await Promise.race([
      this.ready(this),
      exited.then((code) => {
        throw new Error(`${this.name} stopped while starting (exit ${code}): ${this.output.slice(-1500)}`);
      }),
    ]);
  }

  /** Graceful stop: the worker gets a "shutdown" message, the web server a terminate. */
  async stop(timeoutMs = 20_000) {
    this.stopping = true;
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    if (this.ipc && proc.connected) proc.send("shutdown");
    else proc.kill();
    const timer = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
    if ((await Promise.race([exited, timer])) === "timeout") {
      proc.kill();
      await exited;
    }
  }
}

/** Resolves when the child prints a line containing text. */
export function readyWhenOutput(text, timeoutMs = 60_000) {
  return (svc) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${svc.name} did not report "${text}" within ${timeoutMs / 1000}s`)), timeoutMs);
      const check = (d) => {
        if (String(d).includes(text)) {
          clearTimeout(timer);
          svc.proc.stdout.off("data", check);
          resolve();
        }
      };
      svc.proc.stdout.on("data", check);
    });
}

/** Resolves when the URL answers 200. */
export function readyWhenHealthy(url, timeoutMs = 90_000) {
  return async (svc) => {
    const start = Date.now();
    let last = "no answer";
    while (Date.now() - start < timeoutMs) {
      if (!svc.running) throw new Error(`${svc.name} stopped while starting: ${svc.output.slice(-1500)}`);
      try {
        const r = await fetch(url);
        if (r.ok) return;
        last = `${r.status} ${(await r.text()).slice(0, 300)}`;
      } catch (e) {
        last = String(e?.cause?.code ?? e);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`${svc.name} was not healthy within ${timeoutMs / 1000}s: ${last}`);
  };
}
