# Parcel for Android

Install `Parcel-2.0.0-android.apk` from the GitHub release on Android 11 or later. Android may ask you to allow installs from the browser or file manager used to open the APK. This is a signed release APK, with application ID `com.parceltracker.mobile`, version name `2.0.0`, and version code `20000`.

Open Settings and enter your own 17TRACK API key to register and refresh live parcels. The workspace starts empty. Parcels and scan history are stored in a private native SQLite database; API settings are encrypted with an AES-GCM key in AndroidKeyStore. There is no hosted website, server account, or bundled provider credential. Device backup is disabled to avoid restoring encrypted settings without their device key.

Android checks tracking on opening/resuming the app (at most once every 15 minutes), on **Refresh tracking**, and every two hours while the app remains visible. Android background scheduling is not implemented. Optional Resend digest delivery runs during refresh when all email settings are present. Windows and Android have independent local workspaces. Export/restore a `parcel-backup-v1` JSON file using Settings to transfer parcels and history between them; backups exclude API keys. Restore asks before replacing existing records and rolls back malformed backups.

## Build a signed APK on Windows

Requirements: Node.js 24, JDK 21, Android SDK platform 36, and SDK build tools. Set `JAVA_HOME` and `ANDROID_HOME` if they are not in their standard locations.

```powershell
npm.cmd ci
npm.cmd run android:build
```

The script builds the shared production UI, runs Capacitor sync, compiles a release APK, aligns it, signs it, and verifies its certificate. The final artifact is `release/Parcel-2.0.0-android.apk`. Its dependencies are CPU independent; there is no separate ARM/x86 download.

The first local build creates a signing key under `C:/Users/soory/.parcel-tracker-signing/android-release.p12` and a companion password file in that directory. Preserve both privately for future updates. They are outside this repository and must never be uploaded to GitHub. On another machine, restore the original key and password to the corresponding user profile directory before building updates. Creating a different key produces an APK that cannot upgrade an installed copy signed with the original certificate.

Release certificate SHA-256 fingerprint:

```text
cea457b72e863d852e5a0bbdb1e1298fce1fcffe2680cca1b4890894f3411cea
```

For CI, securely supply the same signing files outside the repository before running the build script. CI compilation without signing can use `android/gradlew assembleRelease`; it produces `android/app/build/outputs/apk/release/app-release-unsigned.apk`.

## Device verification

With an emulator or test device connected:

```powershell
npm.cmd run android:sync
cd android
.\gradlew.bat :app:connectedDebugAndroidTest
```

`ParcelAppTest` uses the actual Android WebView/native bridge and SQLite database. It checks an empty first run, saving a parcel without an API key with an explicit registration error, duplicate reuse, persistence after activity restart, encrypted settings at rest, and masked settings returned to the UI. It uses no live carrier credentials and performs no tracking registration with the provider. Run it only on a test device: it clears this app's local test workspace at the start.

The native HTTPS bridge accepts only HTTPS requests to `api.17track.net`, `res.17track.net`, and `api.resend.com`, rejects redirects, and uses the Android platform's TLS certificate validation. Web assets and executable scripts are bundled locally. Release WebView debugging and Capacitor logging are disabled.
