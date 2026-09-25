# Run from PowerShell; no administrator rights or activation-policy change required.
[CmdletBinding()]
param([Alias('Profile')][ValidateSet('Core', 'Full')][string]$InstallProfile = 'Core')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Major -lt 10) {
        throw 'This setup targets Windows 10/11. Older Windows releases cannot run the current Electron desktop.'
    }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit Windows installation is required.' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 22 with npm, reopen PowerShell, and rerun this script.'
    }
    $nodeVersion = & node.exe --version
    $nodeMajor = ($nodeVersion -replace '^v', '').Split('.')[0]
    if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 22) { throw 'Use Node.js 22 or newer. The recorded working baseline is Node.js 22.' }
    $python = Join-Path $projectRoot 'venv\Scripts\python.exe'
    $pythonCheck = "import sys,struct; sys.exit(0 if sys.version_info[:2] == (3,13) and struct.calcsize('P') == 8 else 1)"
    if (-not (Test-Path -LiteralPath $python)) {
        if (Test-Path -LiteralPath (Join-Path $projectRoot 'venv')) {
            throw 'The existing venv is incomplete. Preserve or rename that folder, then rerun setup; it will not be overwritten automatically.'
        }
        if (Get-Command py.exe -ErrorAction SilentlyContinue) {
            & py.exe -3.13 -m venv venv
        } elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
            & python.exe -c $pythonCheck
            if ($LASTEXITCODE -ne 0) { throw 'Install 64-bit Python 3.13, reopen PowerShell, and rerun setup.' }
            & python.exe -m venv venv
        } else { throw 'Install 64-bit Python 3.13, reopen PowerShell, and rerun setup.' }
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 could not create the venv. Install 64-bit Python 3.13 and rerun setup.' }
    }
    & $python -c $pythonCheck
    if ($LASTEXITCODE -ne 0) { throw 'This venv is unusable here or is not 64-bit Python 3.13. Preserve or rename it, then rerun setup to create a local environment.' }
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Node dependency installation failed. Check network access and the npm error above, then rerun setup.' }
    & $python -m pip install -r requirements-core.txt
    if ($LASTEXITCODE -ne 0) { throw 'Core Python installation failed. Check the pip error above; the app is not ready yet.' }
    if ($InstallProfile -eq 'Full') {
        & $python -m pip install -r requirements.lock.txt
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Full dependency installation failed. Continuing with installed components; optional AI features may be unavailable.' }
    } else {
        & $python -m pip install -r requirements-knowledge.txt
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Knowledge search could not be installed. Continuing with core chat, files, galleries, editing and desktop tools.' }
    }
    & $python -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency conflicts remain. Review pip check above before starting the app.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'The desktop build failed. Review the error above and rerun setup.' }
    Write-Host 'Setup completed. Start Ollama separately for chat, then run npm start.'
    Write-Host 'Models and Media Organizer are separate installs. Core mode does not require an NVIDIA GPU.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally { Pop-Location }
