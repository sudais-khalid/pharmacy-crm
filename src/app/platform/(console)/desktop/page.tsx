"use client";
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, HardDrive, History, RotateCcw, Save, Usb } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Spinner, TableWrap, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/client";
import { DesktopError, desktopCall, formatBytes, getDesktop, type DesktopBackup, type DesktopStatus } from "@/lib/desktop-bridge";

const REASON: Record<string, string> = {
  scheduled: "Scheduled",
  "on-close": "When the app closed",
  manual: "Backed up by hand",
  "pre-update": "Before an update",
  "pre-restore": "Before a restore",
};

type Target = { id: string; createdAt: string; size: number; name: string; needsKey?: boolean };

/** Backups and restore for this computer. Shown only inside the desktop app. */
export default function DesktopPage() {
  const toast = useToast();
  const desktop = getDesktop();
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  const load = useCallback(async () => {
    if (!desktop) return;
    setError(null);
    try {
      setStatus(await desktopCall(desktop.status()));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [desktop]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!desktop) {
    return (
      <>
        <PageHeader title="This computer" subtitle="Backups and restore" />
        <Card><EmptyState title="Available in the desktop app" hint="Backups and restore of a desktop installation are managed from the Pharmacy CRM app on that computer." /></Card>
      </>
    );
  }

  async function run(name: string, fn: () => Promise<unknown>, done: string) {
    setBusy(name);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pickFile() {
    try {
      const f = await desktopCall(desktop!.pickBackupFile());
      if (f) setTarget(f);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const last = status?.lastBackup;
  return (
    <>
      <PageHeader title="This computer" subtitle={status ? `Pharmacy CRM ${status.version.app}, data in ${status.dataRoot}` : "Backups and restore"}
        actions={<Button onClick={() => run("backup", () => desktopCall(desktop.backupNow()), "Backup saved")} loading={busy === "backup"} disabled={Boolean(busy)}><Save className="h-4 w-4" aria-hidden /> Back up now</Button>} />
      {error ? <ErrorBox message={error} onRetry={load} /> : !status ? <Spinner /> : (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary" aria-hidden /> Last backup</h2>
              {last ? (
                <p className="text-sm">{formatDateTime(last.at)} <span className="text-fg-muted">({REASON[last.reason] ?? last.reason}, {formatBytes(last.size)})</span></p>
              ) : <p className="text-sm text-fg-muted">No backup yet.</p>}
              {status.lastBackupError && <p className="mt-2 text-sm text-danger">The last attempt failed at {formatDateTime(status.lastBackupError.at)}: {status.lastBackupError.error}</p>}
              <p className="mt-2 text-xs text-fg-muted">Encrypted backups are taken every 4 hours while the app runs, when it closes and before updates. The newest 24 and one per day for 30 days are kept.</p>
              <Button className="mt-3" size="sm" variant="secondary" onClick={() => desktopCall(desktop.openFolder("backups"))}><FolderOpen className="h-4 w-4" aria-hidden /> Open backups folder</Button>
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 flex items-center gap-2 font-semibold"><Usb className="h-4 w-4 text-primary" aria-hidden /> Second copy</h2>
              {status.mirrorDir ? (
                <>
                  <p className="break-all text-sm">Each backup is also copied to <span className="font-mono">{status.mirrorDir}</span></p>
                  {last?.mirror && !last.mirror.ok && <p className="mt-2 text-sm text-danger">The last copy failed: {last.mirror.error}. Check that the drive is connected.</p>}
                </>
              ) : <p className="text-sm text-fg-muted">Keep a second copy on another drive, a USB stick or a synced cloud folder, so a broken disk does not take the backups with it.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={Boolean(busy)} loading={busy === "mirror"} onClick={() => run("mirror", () => desktopCall(desktop.chooseMirror()), "Mirror folder saved")}><HardDrive className="h-4 w-4" aria-hidden /> {status.mirrorDir ? "Change folder" : "Choose a folder"}</Button>
                {status.mirrorDir && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run("mirror-clear", () => desktopCall(desktop.clearMirror()), "Copies to the mirror folder stopped")}>Stop copying</Button>}
              </div>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
              <h2 className="font-semibold">Restore</h2>
              <Button size="sm" variant="secondary" onClick={pickFile}><Usb className="h-4 w-4" aria-hidden /> Restore from a file</Button>
            </div>
            {!status.backups.length ? <EmptyState title="No backups yet" /> : (
              <TableWrap>
                <thead><tr className="border-b border-border"><th className="th">Taken</th><th className="th">Why</th><th className="th">Size</th><th className="th">Where</th><th className="th text-right">Action</th></tr></thead>
                <tbody>
                  {status.backups.map((b: DesktopBackup) => (
                    <tr key={b.id} className="border-b border-border/60">
                      <td className="td whitespace-nowrap">{formatDateTime(b.createdAt)}</td>
                      <td className="td">{REASON[b.reason] ?? b.reason}</td>
                      <td className="td">{formatBytes(b.size)}</td>
                      <td className="td">{b.source === "mirror" ? <Badge tone="blue">Mirror folder</Badge> : <Badge>This computer</Badge>}</td>
                      <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setTarget(b)} aria-label={`Restore the backup from ${formatDateTime(b.createdAt)}`}><RotateCcw className="h-4 w-4" aria-hidden /> Restore</Button></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>
      )}
      {target && <RestoreDialog target={target} onClose={() => setTarget(null)} />}
    </>
  );
}

function RestoreDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const desktop = getDesktop()!;
  const [code, setCode] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [needsKey, setNeedsKey] = useState(Boolean(target.needsKey));
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => desktop.onProgress(setProgress), [desktop]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFailure(null);
    setProgress("Starting the restore");
    try {
      await desktopCall(desktop.restore(target.id, needsKey ? recoveryKey : null, code));
      setProgress("Restored. Opening the console again.");
    } catch (err) {
      const d = err as DesktopError;
      setProgress(null);
      if (d.needsKey) setNeedsKey(true);
      setErrors(d.fields ?? {});
      setFailure(d.message);
    }
  }

  const running = progress !== null && !failure;
  return (
    <Modal open onClose={running ? () => {} : onClose} title="Restore a backup"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={running}>Cancel</Button>
        <Button variant="danger" type="submit" form="restore-form" loading={running}>Restore</Button>
      </>}>
      <form id="restore-form" onSubmit={submit} className="grid gap-3">
        <p className="text-sm">Replace all pharmacy data on this computer with the backup from <strong>{formatDateTime(target.createdAt)}</strong> ({formatBytes(target.size)}).</p>
        <p className="text-sm text-fg-muted">Everything entered after that time is replaced. A backup of the current data is saved first, so this can be undone by restoring that one. Everyone is signed out while the app restarts.</p>
        {needsKey && (
          <Field label="Recovery key *" hint="This backup was made with another key. Enter the recovery key written down for it." error={errors.recoveryKey}>
            <Input value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono uppercase" placeholder="ABCD-EFGH-..." required />
          </Field>
        )}
        <Field label="Authenticator code *" hint="Confirms it is you" error={errors.code}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required className="w-40" />
        </Field>
        {failure && <p className="text-sm text-danger" role="alert">{failure}</p>}
        {running && <p className="text-sm text-primary" role="status">{progress}</p>}
      </form>
    </Modal>
  );
}
