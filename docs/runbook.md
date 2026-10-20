# Developer runbook

How to run Pharmacy CRM on a server and look after the pharmacies on it. For the Windows desktop app, backups, restore and recovery are on the console's **This computer** page instead.

Commands assume you are on the server, in the folder that holds `docker-compose.prod.yml` and `.env`. `C` below stands for `docker compose -f docker-compose.prod.yml`.

## 1. First setup

1. Get a server with Docker (4 GB of memory and 2 CPUs serve about 20 pharmacies). Point a DNS name, for example `crm.example.com`, at it and open ports 80 and 443.
2. Copy the project, then `cp .env.example .env` and fill in:
   - `DOMAIN` and `ACME_EMAIL` (Caddy gets the HTTPS certificate by itself)
   - `POSTGRES_PASSWORD`, `JWT_SECRET` and `TOTP_ENCRYPTION_KEY`: long random values, for example `openssl rand -base64 48`
   - `PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PASSWORD`: your Developer account, created on the first start only
   - `BACKUP_KEY`: see section 3
3. Start everything: `C up -d --build`. The app applies the database migrations before it starts.
4. Open `https://<DOMAIN>/platform/login`, sign in, and set up two-factor sign-in when asked.
5. Remove `PLATFORM_OWNER_PASSWORD` from `.env` once you have signed in.

Never run `npm run db:seed` on a server: the demo accounts have published passwords, and the seed refuses to run in production.

## 2. Onboarding a pharmacy

1. In the console, open **Pharmacies**, then **New pharmacy**. Enter the name, a short code (it becomes part of the sign-in address), the plan, the user limit, the OCR page limit, the subscription end date and the features.
2. Choose an invite link (recommended) or a temporary password for the Pharmacy Admin, and send it by WhatsApp from the confirmation screen.
3. The admin signs in at `https://<DOMAIN>/p/<code>/login`, sets a password, then the logo, receipt format and staff.

## 3. Backups

The worker takes an encrypted backup every night at 02:30 (in the pharmacy time zone) and whenever it starts without a backup from the last 24 hours. Each backup is decrypted completely to check it before it counts.

- **The key.** Create it once with `C run --rm --no-deps app node dist/ops.js new-key`, put it in `.env` as `BACKUP_KEY`, and keep a printed copy somewhere safe away from the server. Without the key no backup can be opened: not by you, not by anyone.
- **Where they go.** They go into the `backups` volume. Set `BACKUP_OFFSITE_HOST_DIR` to a folder on another disk (a mounted network drive, or a folder a sync tool copies elsewhere) to get a second copy of each one. A backup that exists only on the same server does not survive the loss of that server.
- **How long they are kept.** The newest backup of each of the last 14 days (`BACKUP_KEEP_DAILY`) and of each of the last 12 months (`BACKUP_KEEP_MONTHLY`) is kept, and the same rule applies to the offsite folder.
- **Checking them.** The console overview shows the last backup, or the error if it failed. `/api/health` reports `degraded` when the last good backup is more than 36 hours old; point an uptime monitor at it.
- **A backup now** (before an update, for example): `C exec worker sh -c 'PCRM_RECOVERY_KEY="$BACKUP_KEY" node dist/ops.js backup "/backups/$(date -u +%Y-%m-%dT%H-%M-%S-000Z)-manual.pcrmbak"'`.

## 4. Restore

1. List the backups: `C exec worker ls -l /backups`.
2. Run `sh deploy/restore.sh <file name>`. It does the following, in order:
   - checks the file;
   - asks you to type RESTORE;
   - stops the app and the worker;
   - backs up the current data once more;
   - loads the backup into a new database;
   - only then swaps the new database in, and starts everything again.

   A restore that fails at any step changes nothing.
3. The previous data stays as a database named `pharmacy_crm_old_<time>`. Drop it once you are sure, with the command the script prints.
4. For a backup made with an earlier key, run `export PCRM_RECOVERY_KEY='<that key>'` first.

Staff who were signed in must sign in again. Data entered after the backup was taken is not in it.

## 5. Monthly restore drill

Once a month, prove that the backups can be restored. Do it on another computer, never on the live server.

1. Copy the newest offsite backup to a test machine that has the project and Docker.
2. On the test machine, start an empty stack and run `sh deploy/restore.sh <file name>` with the same `BACKUP_KEY`.
3. Sign in to the console and to one pharmacy, and check a recent invoice and today's stock of one medicine.
4. Write down the date, the backup's name, how long the restore took and anything that went wrong. Fix problems before the next drill.

The project also runs the same drill automatically: `npm run restore:drill`. It backs up seeded data, drops the database, restores the backup into a new one and runs the full smoke and isolation suites against it.

## 6. Subscriptions, suspension and reactivation

- A pharmacy whose subscription end date has passed moves to **grace** on the next nightly check. Staff keep working and see a banner with the date sign-in stops.
- After `SUBSCRIPTION_GRACE_DAYS` (7 by default) it is **suspended**: sign-in stops and its data is kept.
- The Pharmacy Admin is notified a week before the end and again in grace.
- To renew, set a new end date in the pharmacy's **Plan**. A pharmacy the check moved returns to active on the next check, or at once if you also set the status to Active.
- A status you set yourself (a suspension for another reason, for example) is never changed by the check.
- Deactivate a pharmacy that leaves the platform. Its data is kept and it can be reactivated.

## 7. Recovery

- **Lost Developer password or phone:** run `C exec app node dist/ops.js recover-owner`. It prints a new password once and removes two-factor sign-in, so you set it up again.
- **A Pharmacy Admin is locked out:** in the console, open **Accounts**, then unlock the account or issue a reset link.
- **The app does not start:** check `C logs app --tail 100`. A failed migration names the file; fix the cause, then `C up -d app`.
- **The worker is behind** (health `degraded`, worker check): check `C logs worker --tail 100`, then `C restart worker`.

## 8. Updates

1. Take a backup now (section 3).
2. Get the new version, then `C up -d --build`. The app applies new migrations before it starts serving.
3. Check `/api/health` and sign in once.
