/**
 * config.json and keys.json. Both are written atomically (temporary file, then rename) so a power cut
 * never leaves half a file. Secrets in keys.json are encrypted with Windows DPAPI through Electron
 * safeStorage, which ties them to the Windows account that wrote them.
 */
import { safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

export class ConfigStore {
  constructor(file) {
    this.file = file;
    this.data = { format: 1, ...readJson(file, {}) };
  }
  get(name) {
    return this.data[name];
  }
  set(values) {
    Object.assign(this.data, values);
    writeJsonAtomic(this.file, this.data);
  }
}

export class SecretStore {
  constructor(file) {
    this.file = file;
    this.data = readJson(file, null) ?? { format: 1, protection: "dpapi", secrets: {} };
    /** Names present in the file that this Windows account cannot decrypt. */
    this.unreadable = new Set();
  }
  static available() {
    return safeStorage.isEncryptionAvailable();
  }
  has(name) {
    return name in this.data.secrets;
  }
  /** The secret, or null when it is missing or cannot be decrypted here. */
  get(name) {
    const sealed = this.data.secrets[name];
    if (!sealed) return null;
    try {
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      this.unreadable.add(name);
      return null;
    }
  }
  set(name, value) {
    this.data.secrets[name] = safeStorage.encryptString(value).toString("base64");
    this.unreadable.delete(name);
    writeJsonAtomic(this.file, this.data);
  }
  /** Returns the stored secret, or creates, stores and returns a new one. */
  getOrCreate(name, create) {
    const existing = this.get(name);
    if (existing !== null) return { value: existing, created: false };
    const value = create();
    this.set(name, value);
    return { value, created: true };
  }
}
