# Parcel for Windows and Android

Private parcel tracking for shipments within, entering and leaving India. Get the Windows EXE or Android APK from [GitHub Releases](https://github.com/Soorya-John/parcel-tracker/releases/latest). No website or hosted backend is needed.

## Start tracking

1. Windows: run Setup to install, or launch the Portable EXE. Android: install the APK.
2. Open Settings and enter your own **17TRACK API key** from the [provider dashboard](https://api.17track.net). API access is separate from a consumer tracking account; provider plans and quotas apply.
3. Add a tracking number, choose a courier or auto-detect, and save. Click **Refresh tracking** to retrieve scans. Supply extra courier information if requested.
4. Delivered parcels move to the searchable archive with their history retained.

The app starts empty and never invents scans. Without a provider key, saved parcels show a configuration error until tracking is configured. No account credentials are bundled. Live tracking against a paid provider account has not been verified in this development session.

## Storage and updates

Windows stores SQLite data in the Electron user-data directory under `%APPDATA%`. Settings use Windows DPAPI encryption through Electron safeStorage. Closing the window keeps Parcel running in the tray. Use **Quit Parcel** in the tray to exit. Settings can enable startup at Windows sign-in. Checks run at launch and every two hours while the process runs; fully quitting or powering off pauses checks.

Android stores SQLite data privately and encrypts settings with AndroidKeyStore. Checks run when opened/resumed and every two hours while in the foreground. Background execution is not promised. Windows and Android workspaces are independent; there is no cloud sync.

Timezone-aware scans display in Asia/Kolkata (IST). Unzoned courier times are labelled explicitly. Scan freshness depends on the courier and 17TRACK. The complete bundled official carrier catalog is available offline and refreshed when possible.

Optional email digests require a Resend API key, recipient and verified sender in Settings. Clear the recipient to disable email. Failed deliveries retain an immutable outbox with an idempotency key. Ambiguous sends pause before Resend's 24-hour idempotency window expires; the workspace displays the error for provider-account reconciliation.

**Export parcel backup** saves parcel, scan, catalog and email outbox history as JSON, excluding API keys. Keep backups private. Restore replaces current records after confirmation and rolls back invalid data. Re-enter keys on another device. Back up before uninstalling or clearing app data.

Windows binaries are unsigned because no publisher certificate was supplied; Windows may show an unknown-publisher prompt. Android release APKs use a persistent project signing key stored outside this repository.

## Build and verify

Requires Node.js 24. In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm ci
npm test
npm run test:desktop
npm run build
npm run test:electron
npm start
npm run dist:win
```

Tests verify the shared engine with real D1/SQLite and mocked external HTTP, native SQLite transactions and restart persistence, duplicate registration, scans, delivery archiving, retry handling and visible provider failures. The Electron suite launches the app and verifies empty first run, persistence, encrypted settings and renderer isolation. Set `PARCEL_EXE` to an unpacked Parcel.exe to test the packaged application. Screenshots and build logs go to ignored `test-results/`.

Windows packaging generates an NSIS per-user installer and portable x64 EXE in `release/`. Requires Windows 10 or newer. The renderer is sandboxed with context isolation and a narrow validated IPC interface; provider network calls and secrets remain in the main process.

Android builds require JDK 21 and Android SDK 36. Run `npm run android:sync` followed by `npm run android:build`. See the Android build instructions for signing setup. Requires Android 11 or newer.

## Source

- `src/`: shared UI and Android bridge
- `desktop/`: Electron shell, settings, SQLite adapter and tracking service
- `android/`: native Android project, SQLite and encrypted settings bridge
- `worker/`: shared provider, catalog, scan and email engine
- `migrations/`: SQLite schema
- `test/`: tracking integration, native persistence and Electron application checks
- `scripts/`: catalog and Android build helpers

GitHub Pages deployment was removed. Legacy Worker entry points and deployment tooling remain for engine integration tests; neither installed app requires a Worker deployment.
