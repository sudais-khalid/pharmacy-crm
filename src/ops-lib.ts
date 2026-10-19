/**
 * Library entry for the desktop supervisor, bundled to dist/ops-lib.js (CommonJS) and loaded by the
 * Electron main process with require(). The supervisor passes keys as Buffers, so they never pass through
 * environment variables or command lines. The same functions back the ops CLI (src/ops-cli.ts).
 */
export { applyMigrations, migrationStatus, pendingMigrations, readMigrations } from "@/lib/migrations/runner";
export { createBackup, restoreBackup, verifyBackup, readBackupHeader, newBackupKey, formatRecoveryKey, parseRecoveryKey, keyId } from "@/lib/backup";
