# 06. Desktop Proof of Concept (Phase 0, task 0.12)

Goal: prove, before Phase 2 depends on it, that the Windows desktop design in the architecture document (section 2.3) works: an Electron main process starting an embedded PostgreSQL, the Next.js server and the worker, then showing the app.

Run it with `npm run build:desktop` in the repository root, then `npm run poc` in `desktop/`. The PoC starts everything hidden, captures the login page, shuts down and writes `desktop/poc-report.json`.

## 1. Result

**It works.** On this Windows 11 machine, Electron 44.7 started PostgreSQL 16.14, applied all migrations, started the Next.js standalone server and the worker, and rendered the login page in the app window. Health reported `ok` for database, worker and disk, and everything stopped gracefully.

| Step (first run, empty data folder) | Time from launch |
|---|---|
| PostgreSQL cluster initialised (`initdb`) | 3.0 s |
| PostgreSQL started | 3.2 s |
| Migrations applied | 5.4 s |
| Web server healthy | 6.2 s |
| Worker started | 6.8 s |
| Window loaded | 5.5 to 7.9 s across runs |
| Graceful shutdown (worker, server, PostgreSQL) | 2.1 to 3.0 s |

Later starts skip `initdb` and the migrations are no-ops, so a normal start is expected around 3 s.

Verified settings of the embedded server: `listen_addresses = 127.0.0.1` (not reachable from the network), `timezone = UTC`, version 16.14.

## 2. Sizes (unpacked, before installer compression)

| Part | Size |
|---|---|
| Electron runtime | 385 MB (includes all Chromium locales; trimming to `en-US` saves most of 40 MB) |
| PostgreSQL 16 binaries | 100 MB |
| Next.js standalone server | 67 MB |
| Empty database after migrations | 51 MB |

Estimated installer size after NSIS compression: 150 to 200 MB. Installed size about 550 MB plus data. Acceptable for a shop PC; reduce later by trimming locales and PostgreSQL extras that are not used.

## 3. What did not need any work

- **No native Node modules at run time.** Prisma 6 with `engineType = "client"` uses a WebAssembly query compiler, and `pg`, `bcryptjs`, `pino` and `pg-boss` are pure JavaScript. Nothing has to be rebuilt for Electron's Node version.
- **pg_trgm** is included in the embedded PostgreSQL build, so trigram search works offline.
- **Graceful worker stop** through the IPC `"shutdown"` message (added in task 0.9) works under Electron.

## 4. Problems found and fixed during the PoC

| Problem | Fix |
|---|---|
| Next.js standalone file tracing left out Prisma's `query_compiler_bg.wasm`, so every query failed with `ENOENT` | `outputFileTracingIncludes` in `next.config.mjs` |
| The health endpoint could report an empty error message for driver errors | `describe()` in `platform/health.ts` reports name, code and first line |
| Next.js does not copy `.next/static` into the standalone folder | `npm run build:desktop` copies it |
| Terminals inside VS Code export `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node | `desktop/scripts/run-electron.mjs` clears it; installed apps are not affected |

## 5. Open items for Phase 2

| # | Finding | Decision for Phase 2 |
|---|---|---|
| 1 | Migrations ran through the Prisma CLI from the repository. A packaged app would also have to ship the Prisma schema engine binary | Build a small migration runner that applies `prisma/migrations/*/migration.sql` in order inside a transaction each and records rows in `_prisma_migrations` exactly as Prisma does (same checksum), so server and desktop databases stay interchangeable. Covered by a test that compares its result with `prisma migrate deploy` |
| 2 | The embedded-postgres Windows package has no `pg_dump.exe` or `pg_restore.exe` | Superseded by ADR-14: backups are made by the app itself (encrypted, data-only, COPY based), so no PostgreSQL client binaries are needed |
| 3 | embedded-postgres registers its own exit hook, which throws `done is not a function` on Electron's exit path (harmless, the supervisor already stops PostgreSQL) | Disable or replace the library's hook; keep explicit, ordered shutdown in the supervisor |
| 4 | embedded-postgres versions carry a `-beta` tag (wrapper versioning), pinned here to `16.14.0-beta.17` | Pin exactly, record checksums of the binaries, upgrade deliberately |
| 5 | Electron 44 runs Node 24.21, the Docker image runs Node 22 | Add Node 24 to the CI matrix so both runtimes are tested |
| 6 | The PoC used the `postgres` superuser and a new random password per run | `app_owner`, `app_user` and `platform_user` roles (Phase 1), password stored with Windows DPAPI through Electron `safeStorage`, data in `%PROGRAMDATA%\PharmacyCRM` |
| 7 | Free ports were picked at start; the window URL changes every run | Fix the web port per installation (stored in settings, re-picked only if taken) so LAN devices keep the same address |
