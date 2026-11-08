$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'),
        (Join-Path $env:USERPROFILE '.cache/parcel-build/jdk')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'bin/java.exe')) { $env:JAVA_HOME = $candidate; break }
        if (Test-Path $candidate) {
            $jdk = Get-ChildItem -LiteralPath $candidate -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1
            if ($jdk) { $env:JAVA_HOME = $jdk.FullName; break }
        }
    }
}
if (-not $env:JAVA_HOME) { throw 'Install JDK 21 and set JAVA_HOME.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
& npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
Push-Location -LiteralPath (Join-Path $projectRoot 'android')
try {
    $buildErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & ./gradlew.bat assembleRelease --no-daemon --console=plain 2>&1 | ForEach-Object { $_.ToString() | Out-File -FilePath (Join-Path $projectRoot 'test-results/android-live.log') -Encoding utf8 -Append; Write-Host $_.ToString() }
    $buildExitCode = $LASTEXITCODE
    $ErrorActionPreference = $buildErrorPreference
    if ($buildExitCode -ne 0) { throw 'Android Gradle build failed.' }
} finally { Pop-Location }

$signingRoot = Join-Path $env:USERPROFILE '.parcel-tracker-signing'
$keystorePath = Join-Path $signingRoot 'android-release.p12'
$passwordPath = Join-Path $signingRoot 'android-release-password.txt'
New-Item -ItemType Directory -Force -Path $signingRoot | Out-Null
if (-not (Test-Path -LiteralPath $keystorePath)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($bytes) | Set-Content -LiteralPath $passwordPath -NoNewline
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keystorePath -storepass:file $passwordPath -alias parcel-release -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Parcel Tracker, OU=Personal, O=Parcel Tracker, C=IN' -storetype PKCS12
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create release signing key.' }
}
if (-not (Test-Path -LiteralPath $passwordPath)) { throw "Restore signing password file at $passwordPath to sign updates with the original certificate." }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Install Android SDK build-tools.' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$releaseRoot = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$aligned = Join-Path $releaseRoot "Parcel-$version-android-aligned.apk"
$final = Join-Path $releaseRoot "Parcel-$version-android.apk"
& (Join-Path $buildTools.FullName 'zipalign.exe') -f -p 4 (Join-Path $projectRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk') $aligned
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
& (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $keystorePath --ks-key-alias parcel-release --ks-pass "file:$passwordPath" --out $final $aligned
if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
& (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose --print-certs $final
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
Remove-Item -LiteralPath $aligned
Write-Host "Signed APK: $final"
Write-Host "Preserve the signing key and password under $signingRoot for future upgrades."
