/**
 * Shop network access (architecture, section 2.3): off by default, the web server listens on 127.0.0.1
 * only. When it is turned on, the server also listens on the PC's network addresses and a Windows Firewall
 * rule allows this program on its port for private networks only. PostgreSQL always stays on loopback.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const RULE = "Pharmacy CRM (shop network)";
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const encode = (script) => Buffer.from(script, "utf16le").toString("base64");
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

// adapters of virtual machines, WSL and Docker: their addresses are not reachable from a tablet
const VIRTUAL = /vEthernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|bluetooth/i;

/**
 * The PC's private IPv4 addresses (Wi-Fi, Ethernet), the ones tablets on the same network can reach.
 * Virtual adapters are left out unless there is nothing else.
 */
export function lanAddresses() {
  const real = [];
  const virtual = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || !isPrivate(a.address)) continue;
      (VIRTUAL.test(name) ? virtual : real).push(a.address);
    }
  }
  return [...new Set(real.length ? real : virtual)];
}

/**
 * Whether an enabled rule allows the port: "allowed", "missing" or "unknown". Uses the firewall cmdlets
 * rather than netsh, whose output is translated on non-English Windows.
 */
export async function firewallState(port) {
  const script = `$r = Get-NetFirewallRule -DisplayName ${quote(RULE)} -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }
if (-not $r) { 'missing' } else { ($r | Get-NetFirewallPortFilter).LocalPort -join ',' }`;
  try {
    const { stdout } = await run(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encode(script)], { windowsHide: true, timeout: 30_000 });
    const out = stdout.trim();
    if (out === "missing") return "missing";
    return out.split(",").map((p) => p.trim()).includes(String(port)) ? "allowed" : "missing";
  } catch {
    return "unknown";
  }
}

/**
 * Adds (or replaces) the rule through the Windows administrator prompt. Resolves false when the prompt was
 * declined or the rule could not be added.
 */
export async function allowThroughFirewall(port, program) {
  const inner = `Remove-NetFirewallRule -DisplayName ${quote(RULE)} -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName ${quote(RULE)} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${Number(port)} -Profile Private -Program ${quote(program)} | Out-Null`;
  const outer = `try {
  $p = Start-Process -FilePath ${quote(powershell)} -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encode(inner)}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  exit $p.ExitCode
} catch { exit 1223 }`;
  try {
    await run(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encode(outer)], { windowsHide: true, timeout: 180_000 });
    return true;
  } catch {
    return false;
  }
}
