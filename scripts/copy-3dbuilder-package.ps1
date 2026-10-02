#requires -Version 5.1
<#
.SYNOPSIS
Copies the installed 3D Builder package and its installed dependencies.
.DESCRIPTION
Creates a file snapshot, preserving each package in its own directory and
verifying every file with SHA-256. The destination must not already exist.
Includes installed resource packages and transitive package dependencies.

This does not create an installer, a second registered application, source code,
or an embeddable editor. App data, settings, licenses, and Windows registration
are not exported. The installed application and its permissions are unchanged.
No downloads, elevation, package registration, or application launch occurs.
.PARAMETER DestinationPath
A new folder inside an existing local directory. Defaults to TEMP\3dbuilder.
Choose a persistent directory if the copy must survive temporary-file cleanup.
.EXAMPLE
.\scripts\copy-3dbuilder-package.ps1 -WhatIf
.EXAMPLE
.\scripts\copy-3dbuilder-package.ps1 -DestinationPath "$env:TEMP\3dbuilder"
.LINK
https://learn.microsoft.com/en-us/powershell/module/appx/get-appxpackage
.LINK
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/copy-item
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
    [ValidateNotNullOrEmpty()]
    [string]$DestinationPath = (Join-Path $env:TEMP '3dbuilder')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-RegularDirectory {
    param([string]$Path)
    $directory = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $directory.PSIsContainer) { throw "Not a directory: $Path" }
    while ($null -ne $directory) {
        if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Links and junctions are not supported: $($directory.FullName)"
        }
        $directory = $directory.Parent
    }
}

function Get-PackageTree {
    param([string]$Path)
    $pendingDirectories = [Collections.Generic.Stack[string]]::new()
    $pendingDirectories.Push($Path)
    while ($pendingDirectories.Count -gt 0) {
        foreach ($entry in Get-ChildItem -LiteralPath $pendingDirectories.Pop() -Force -ErrorAction Stop) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Package contains a link or junction: $($entry.FullName)"
            }
            if ($entry.PSIsContainer) { $pendingDirectories.Push($entry.FullName) }
            $entry
        }
    }
}

if ($env:OS -ne 'Windows_NT') { throw 'This script requires Windows and the Appx PowerShell module.' }
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationPath)
if ($destination -notmatch '^[A-Za-z]:\\') { throw 'Choose a local drive path for the destination.' }
$destination = [IO.Path]::GetFullPath($destination).TrimEnd('\')
if (Test-Path -LiteralPath $destination) {
    throw "Destination already exists; nothing will be overwritten: $destination"
}
$destinationParent = Split-Path -Parent $destination
Assert-RegularDirectory -Path $destinationParent

$mainPackages = @(Get-AppxPackage -Name 'Microsoft.3DBuilder' -PackageTypeFilter Main -ErrorAction Stop |
    Where-Object { $_.Name -eq 'Microsoft.3DBuilder' })
if ($mainPackages.Count -ne 1) {
    throw 'Expected one installed Microsoft.3DBuilder main package for the current user.'
}
$mainPackage = $mainPackages[0]
$pendingPackages = [Collections.Generic.Queue[object]]::new()
$pendingPackages.Enqueue($mainPackage)
# Resources are not included in Get-AppxPackage's default package-type filter.
foreach ($resource in Get-AppxPackage -Name 'Microsoft.3DBuilder' -PackageTypeFilter Resource -ErrorAction Stop) {
    if ($resource.PackageFamilyName -eq $mainPackage.PackageFamilyName -and $resource.Version -eq $mainPackage.Version) {
        $pendingPackages.Enqueue($resource)
    }
}

$seenPackages = @{}
$packages = [Collections.Generic.List[object]]::new()
while ($pendingPackages.Count -gt 0) {
    $package = $pendingPackages.Dequeue()
    $packageName = [string]$package.PackageFullName
    if ($seenPackages.ContainsKey($packageName)) { continue }
    if ($packageName -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Package identity is missing or invalid.' }
    $seenPackages[$packageName] = $true
    if ([string]$package.Status -ne 'Ok') { throw "Package is not in a healthy installed state: $packageName" }
    if ([string]::IsNullOrWhiteSpace($package.InstallLocation)) { throw "Package location is unavailable: $packageName" }
    $source = [IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\')
    Assert-RegularDirectory -Path $source
    if ($destination.Equals($source, [StringComparison]::OrdinalIgnoreCase) -or
        $destination.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The destination must be outside every installed package directory.'
    }
    $entries = @(Get-PackageTree -Path $source)
    $files = @($entries | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{
            Path = $_.FullName.Substring($source.Length + 1)
            Bytes = [long]$_.Length
            SHA256 = $null
        }
    })
    if ($files.Count -eq 0 -or -not (Test-Path -LiteralPath (Join-Path $source 'AppxManifest.xml') -PathType Leaf)) {
        throw "Package files or manifest are missing: $packageName"
    }
    $directories = @($entries | Where-Object { $_.PSIsContainer } | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($source.Length + 1)
    })
    $packages.Add([pscustomobject]@{
        Name = [string]$package.Name
        PackageFullName = $packageName
        Version = [string]$package.Version
        Architecture = [string]$package.Architecture
        IsResourcePackage = [bool]$package.IsResourcePackage
        IsFramework = [bool]$package.IsFramework
        Source = $source
        CopyDirectory = "packages\$packageName"
        Dependencies = @($package.Dependencies | ForEach-Object { [string]$_.PackageFullName })
        Directories = $directories
        Files = $files
    })
    foreach ($dependency in $package.Dependencies) { $pendingPackages.Enqueue($dependency) }
}

$fileCount = 0
[long]$totalBytes = 0
foreach ($package in $packages) {
    $fileCount += $package.Files.Count
    foreach ($file in $package.Files) { $totalBytes += $file.Bytes }
}
Write-Host ("Found {0} packages, {1} files, {2:N2} MiB. Destination: {3}" -f
    $packages.Count, $fileCount, ($totalBytes / 1MB), $destination)
if (-not $PSCmdlet.ShouldProcess($destination, 'Copy installed 3D Builder files and dependencies; verify SHA-256')) { return }

# Windows PowerShell 5.1's Get-FileHash inherits WhatIf into its internal
# pipeline. Hash only after ShouldProcess has authorized the real operation.
# Read every source before creating a destination, so access failures are clean.
foreach ($package in $packages) {
    foreach ($file in $package.Files) {
        $file.SHA256 = (Get-FileHash -LiteralPath (Join-Path $package.Source $file.Path) -Algorithm SHA256 -ErrorAction Stop).Hash
    }
}

# No -Force: a concurrently created destination also causes a failure.
Assert-RegularDirectory -Path $destinationParent
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
$receiptPath = Join-Path $destination 'copy-receipt.json'
$receipt = [ordered]@{
    SchemaVersion = 1
    Status = 'copying'
    CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
    CompletedAtUtc = $null
    IntendedAction = 'Verified copy of installed package files; not an installer or independent app.'
    MainPackage = [string]$mainPackage.PackageFullName
    PackageCount = $packages.Count
    FileCount = $fileCount
    TotalBytes = $totalBytes
    HashAlgorithm = 'SHA256'
    Packages = @($packages.ToArray())
    Error = $null
}
try {
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    New-Item -ItemType Directory -Path (Join-Path $destination 'packages') -ErrorAction Stop | Out-Null
    foreach ($package in $packages) {
        Write-Host "Copying and verifying $($package.PackageFullName)..."
        Assert-RegularDirectory -Path $package.Source
        $copyPath = Join-Path $destination $package.CopyDirectory
        if (Test-Path -LiteralPath $copyPath) { throw "Copy target unexpectedly exists: $copyPath" }
        Copy-Item -LiteralPath $package.Source -Destination $copyPath -Recurse -Force -ErrorAction Stop
        $copiedEntries = @(Get-PackageTree -Path $copyPath)
        $copiedFiles = @($copiedEntries | Where-Object { -not $_.PSIsContainer })
        $copiedDirectories = @($copiedEntries | Where-Object { $_.PSIsContainer })
        if ($copiedFiles.Count -ne $package.Files.Count -or $copiedDirectories.Count -ne $package.Directories.Count) {
            throw "Copied file/directory counts differ for $($package.PackageFullName)."
        }
        foreach ($directory in $package.Directories) {
            if (-not (Test-Path -LiteralPath (Join-Path $copyPath $directory) -PathType Container)) {
                throw "Copied directory is missing: $directory"
            }
        }
        foreach ($file in $package.Files) {
            $copiedFile = Get-Item -LiteralPath (Join-Path $copyPath $file.Path) -Force -ErrorAction Stop
            $copiedHash = (Get-FileHash -LiteralPath $copiedFile.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
            $sourceHash = (Get-FileHash -LiteralPath (Join-Path $package.Source $file.Path) -Algorithm SHA256 -ErrorAction Stop).Hash
            if ($copiedFile.Length -ne $file.Bytes -or $copiedHash -ne $file.SHA256 -or $sourceHash -ne $file.SHA256) {
                throw "File verification failed or the installed package changed: $($file.Path)"
            }
        }
    }
    @'
3D Builder installed-package file snapshot

Each installed package is stored separately under packages. copy-receipt.json
records the source locations, package identities, file sizes, and SHA-256 hashes.
Status "verified" means all recorded files matched the installed sources.

This is a copy of installed program files. It is not an APPX/MSIX installer,
portable application, second registered installation, source-code export, or
an editor component for Local AI Workstation. No installation or launch is run.
App data, settings, licenses, and Windows registration are not backed up.
Only dependencies/resources installed for this user were included.

The script leaves the installed application and its permissions unchanged.
Keep this folder outside the source repository. TEMP folders can be cleaned by
Windows; choose a persistent destination for long-term preservation.
'@ | Set-Content -LiteralPath (Join-Path $destination 'README.txt') -Encoding UTF8
    $receipt.Status = 'verified'
    $receipt.CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
} catch {
    $copyFailure = $_
    $receipt.Status = 'failed'
    $receipt.Error = $copyFailure.Exception.Message
    try {
        $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    } catch { Write-Warning 'Could not update the failure receipt.' }
    Write-Warning "The copy is incomplete. Files have been retained for inspection at: $destination"
    throw $copyFailure
}

[pscustomobject]@{
    Status = $receipt.Status
    Destination = $destination
    Packages = $packages.Count
    Files = $fileCount
    Bytes = $totalBytes
    Receipt = $receiptPath
}
