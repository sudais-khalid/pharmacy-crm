# Pharmacy CRM for Windows

The desktop app runs a whole installation on one PC: Electron supervises an embedded PostgreSQL 16, the
Next.js server and the worker (architecture, sections 2.3 and 2.4).

## Build

From the repository root:

```
npm run build:desktop            # server folder: .next/standalone with dist/ and the migrations
cd desktop
npm run package                  # dist/PharmacyCRM-Setup-<version>.exe
npm run package:dir              # dist/win-unpacked only, quicker to try
```

The Developer account a new installation creates comes from `desktop/build/owner.json` (email and bcrypt
hash, never the password). `npm run package` writes it from `PCRM_OWNER_EMAIL` with `PCRM_OWNER_PASSWORD`
or `PCRM_OWNER_PASSWORD_HASH`, or from `PLATFORM_OWNER_EMAIL` and `PLATFORM_OWNER_PASSWORD` in the root
`.env`. `desktop/build` is not committed.

## Test

```
npm test                                                    # unit tests (backup retention, mirror)
npm run selftest                                            # the app from source, headless, 35 checks
node scripts/selftest.mjs --exe dist/win-unpacked/PharmacyCRM.exe   # a packaged build
node scripts/installer-test.mjs                             # install, uninstall, reinstall, restore
```

All of them use a throwaway data folder (`PCRM_DATA_DIR`), never `%PROGRAMDATA%`. The installer test
installs the app for the current Windows user and removes it again at the end.

Release builds must be code-signed (`CSC_LINK`, `CSC_KEY_PASSWORD`). Windows 11 Smart App Control blocks
unsigned programs it does not know, so an unsigned build may not start at all on such a PC.

## On a pharmacy PC

| What | Where |
|---|---|
| Program | `%LOCALAPPDATA%\Programs\PharmacyCRM` |
| Data, backups, logs | `%PROGRAMDATA%\PharmacyCRM` (only the setup user, Administrators and SYSTEM) |
| Key for `keys.json` | `%APPDATA%\Pharmacy CRM` (Electron safe storage, Windows DPAPI) |

- Uninstalling keeps the data. The uninstaller offers "Also delete all pharmacy data" and then "Also
  delete the backups". Silent uninstalls take `/S /DELETEDATA` or `/S /DELETEDATA /DELETEBACKUPS`.
- Lost Developer password or authenticator: run
  `"%LOCALAPPDATA%\Programs\PharmacyCRM\PharmacyCRM.exe" --recover-owner` with Pharmacy CRM closed. Windows
  asks for an administrator; the new password is shown once and two-factor sign-in is set up again.
- Backups: Developer console, "This computer" (inside the app), or the tray icon menu.
