param([switch]$SkipChecks, [switch]$ChecksOnly)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$toolchainPath = Join-Path $env:LOCALAPPDATA 'LocalAIWorkstation\AndroidToolchain\toolchain.json'
if (-not (Test-Path -LiteralPath $toolchainPath)) { throw 'Run tools/prepare-toolchain.py first.' }
$toolchain = Get-Content -LiteralPath $toolchainPath -Raw | ConvertFrom-Json
$previousJava = $env:JAVA_HOME
$previousAndroid = $env:ANDROID_HOME
$previousGradle = $env:GRADLE_USER_HOME
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed (exit $LASTEXITCODE): $Executable" }
}
try {
    $env:JAVA_HOME = $toolchain.java
    $env:ANDROID_HOME = $toolchain.sdk
    $env:GRADLE_USER_HOME = $toolchain.gradle_user_home
    $tasks = @('--no-daemon', '--console=plain', '-p', $project)
    if (-not $SkipChecks) { $tasks += @('testReleaseUnitTest', 'lintRelease') }
    if ($ChecksOnly -and $SkipChecks) { throw 'ChecksOnly cannot be combined with SkipChecks.' }
    if (-not $ChecksOnly) { $tasks += 'assembleRelease' }
    Invoke-Checked $toolchain.gradle $tasks
    if ($ChecksOnly) { return }

    # Node can inherit PowerShell 7 module paths while launching Windows PowerShell.
    # Load this host's security module explicitly before using Windows DPAPI.
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop

    $signing = Join-Path $env:LOCALAPPDATA 'LocalAIWorkstation\AndroidSigning'
    New-Item -ItemType Directory -Force -Path $signing | Out-Null
    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    # icacls changes this directory's DACL without requesting SACL privileges.
    Invoke-Checked 'icacls.exe' @($signing, '/grant:r', ('*' + $account.Value + ':(OI)(CI)F'), '/inheritance:r', '/q')
    $secretPath = Join-Path $signing 'companion-release.dpapi'
    $keyPath = Join-Path $signing 'companion-release.p12'
    if ((Test-Path -LiteralPath $keyPath) -and -not (Test-Path -LiteralPath $secretPath)) { throw 'The existing signing key password is missing. Do not replace the key.' }
    if (-not (Test-Path -LiteralPath $secretPath)) {
        $bytes = New-Object byte[] 48
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $random.GetBytes($bytes); $random.Dispose()
        $secret = ConvertTo-SecureString -String ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
        ConvertFrom-SecureString -SecureString $secret | Set-Content -LiteralPath $secretPath
    }
    $securePassword = (Get-Content -LiteralPath $secretPath -Raw).Trim() | ConvertTo-SecureString
    $credential = [System.Management.Automation.PSCredential]::new('signing', $securePassword)
    $env:LAW_ANDROID_KEYSTORE_PASSWORD = $credential.GetNetworkCredential().Password
    if (-not (Test-Path -LiteralPath $keyPath)) {
        Invoke-Checked (Join-Path $toolchain.java 'bin\keytool.exe') @('-genkeypair', '-keystore', $keyPath, '-storetype', 'PKCS12', '-storepass:env', 'LAW_ANDROID_KEYSTORE_PASSWORD', '-keypass:env', 'LAW_ANDROID_KEYSTORE_PASSWORD', '-alias', 'companion', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Workstation Companion Local Release', '-noprompt')
    }
    $output = Join-Path $project 'output'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $buildTools = Join-Path $toolchain.sdk 'build-tools\36.0.0'
    $unsigned = Join-Path $project 'app\build\outputs\apk\release\app-release-unsigned.apk'
    $aligned = Join-Path $output 'companion-aligned.apk'
    $versionMatch = [regex]::Match((Get-Content -LiteralPath (Join-Path $project 'app\build.gradle') -Raw), "versionName '([0-9]+\.[0-9]+\.[0-9]+)'")
    if (-not $versionMatch.Success) { throw 'Missing Android versionName.' }
    $apkName = 'Workstation-Companion-' + $versionMatch.Groups[1].Value + '.apk'
    $apk = Join-Path $output $apkName
    Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-P', '16', '-f', '4', $unsigned, $aligned)
    Invoke-Checked (Join-Path $buildTools 'apksigner.bat') @('sign', '--ks', $keyPath, '--ks-key-alias', 'companion', '--ks-pass', 'env:LAW_ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:LAW_ANDROID_KEYSTORE_PASSWORD', '--out', $apk, $aligned)
    Invoke-Checked (Join-Path $buildTools 'apksigner.bat') @('verify', '--verbose', '--print-certs', $apk)
    Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c', '-P', '16', '4', $apk)
    $hashStream = [System.IO.File]::OpenRead($apk)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($sha256.ComputeHash($hashStream))).Replace('-', '').ToLowerInvariant() }
    finally { $hashStream.Dispose(); $sha256.Dispose() }
    "$hash  $apkName" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
    Write-Output "Signed APK: $apk"
    Write-Output "SHA-256: $hash"
} finally {
    $env:LAW_ANDROID_KEYSTORE_PASSWORD = $null
    $env:JAVA_HOME = $previousJava
    $env:ANDROID_HOME = $previousAndroid
    $env:GRADLE_USER_HOME = $previousGradle
}
