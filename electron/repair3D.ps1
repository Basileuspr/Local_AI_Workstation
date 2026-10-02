#requires -Version 5.1
# Windows' public, local 3D repair API. No copied 3D Builder binaries are used.
# https://learn.microsoft.com/en-us/uwp/api/windows.graphics.printing3d.printing3dmodel.repairasync
param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Report($Value) { [Console]::WriteLine(($Value | ConvertTo-Json -Depth 5 -Compress)) }
$inputStream = $null
$resultReader = $null
$outputFile = $null
try {
    if (-not [IO.Path]::IsPathRooted($InputPath) -or -not [IO.Path]::IsPathRooted($OutputPath)) { throw 'Absolute input and output paths are required.' }
    if (Test-Path -LiteralPath $OutputPath) { throw 'The output already exists.' }
    if ((Get-Item -LiteralPath $InputPath).Length -gt 128MB) { throw 'Repair input exceeds 128 MB.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # Check the actual bytes again at the native boundary, independently of the renderer.
    $archive = [IO.Compression.ZipFile]::OpenRead($InputPath)
    try {
        if ($archive.Entries.Count -gt 4096) { throw 'The 3MF has too many archive entries.' }
        [long]$expanded = 0
        foreach ($entry in $archive.Entries) {
            $expanded += $entry.Length
            if ($expanded -gt 256MB) { throw 'The 3MF expands beyond the 256 MB repair limit.' }
            if ($entry.FullName -match '(^|[\\/])\.\.([\\/]|$)|:|^[/\\]') { throw 'The 3MF contains an unsafe archive path.' }
            if ($entry.FullName -match '\.(model|rels|xml)$') {
                $settings = [Xml.XmlReaderSettings]::new()
                $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
                $settings.XmlResolver = $null
                $settings.MaxCharactersInDocument = 256MB
                $entryStream = $entry.Open()
                $reader = [Xml.XmlReader]::Create($entryStream, $settings)
                try {
                    while ($reader.Read()) {
                        if ($reader.NodeType -eq [Xml.XmlNodeType]::Element -and $reader.LocalName -eq 'Relationship') {
                            if ($reader.GetAttribute('TargetMode') -eq 'External' -or $reader.GetAttribute('Target') -match '^[a-zA-Z][a-zA-Z0-9+.-]*:|^//') {
                                throw 'External 3MF resources are not supported for local repair.'
                            }
                        }
                    }
                } finally { $reader.Dispose(); $entryStream.Dispose() }
            }
        }
    } finally { $archive.Dispose() }

    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $modelType = [Windows.Graphics.Printing3D.Printing3DModel, Windows.Graphics.Printing3D, ContentType = WindowsRuntime]
    $packageType = [Windows.Graphics.Printing3D.Printing3D3MFPackage, Windows.Graphics.Printing3D, ContentType = WindowsRuntime]
    $verificationType = [Windows.Graphics.Printing3D.Printing3DMeshVerificationResult, Windows.Graphics.Printing3D, ContentType = WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $asAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
    } | Select-Object -First 1
    function Wait-Result($Operation, [Type]$Type) {
        $task = $asTask.MakeGenericMethod($Type).Invoke($null, @($Operation))
        try { $task.Wait() } catch { throw $task.Exception.GetBaseException() }
        return $task.Result
    }
    function Wait-Action($Operation) {
        $task = $asAction.Invoke($null, @($Operation))
        try { $task.Wait() } catch { throw $task.Exception.GetBaseException() }
    }
    function Measure-Model($Model) {
        [long]$triangles = 0
        [long]$vertices = 0
        $invalidMeshes = 0
        foreach ($mesh in $Model.Meshes) {
            $triangles += $mesh.IndexCount
            $vertices += $mesh.VertexCount
            $verification = Wait-Result ($mesh.VerifyAsync([Windows.Graphics.Printing3D.Printing3DMeshVerificationMode]::FindFirstError)) $verificationType
            if (-not $verification.IsValid) { $invalidMeshes++ }
        }
        return @{ triangles = $triangles; vertices = $vertices; meshes = $Model.Meshes.Count; invalidMeshes = $invalidMeshes }
    }

    Report @{ type = 'progress'; stage = 'loading' }
    $file = Wait-Result ([Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]::GetFileFromPathAsync($InputPath)) ([Windows.Storage.StorageFile])
    $inputStream = Wait-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $package = New-Object Windows.Graphics.Printing3D.Printing3D3MFPackage
    # This API consumes the full ZIP stream, not package.ModelPart (which is XML).
    $model = Wait-Result ($package.LoadModelFromPackageAsync($inputStream)) $modelType
    Report @{ type = 'progress'; stage = 'checking' }
    $before = Measure-Model $model
    if ($before.triangles -lt 1 -or $before.triangles -gt 8000000) { throw 'Repair supports models with 1 to 8 million triangles.' }
    Report @{ type = 'progress'; stage = 'repairing' }
    Wait-Action ($model.RepairAsync())
    Report @{ type = 'progress'; stage = 'verifying' }
    $after = Measure-Model $model
    if ($after.triangles -lt 1) { throw 'Windows repair produced an empty model.' }
    Report @{ type = 'progress'; stage = 'saving' }
    # A new output package avoids stale ZIP/stream state after repair.
    $outputPackage = New-Object Windows.Graphics.Printing3D.Printing3D3MFPackage
    Wait-Action ($outputPackage.SaveModelToPackageAsync($model))
    $resultStream = Wait-Result ($outputPackage.SaveAsync()) ([Windows.Storage.Streams.IRandomAccessStream])
    if ($resultStream.Size -gt 128MB) { throw 'The repaired file exceeds the 128 MB output limit.' }
    $resultStream.Seek(0)
    $resultReader = [IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($resultStream)
    $outputFile = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew)
    $resultReader.CopyTo($outputFile)
    $outputFile.Dispose(); $outputFile = $null
    Report @{ type = 'complete'; before = $before; after = $after; units = [string]$model.Unit; engine = 'Windows.Graphics.Printing3D.Printing3DModel.RepairAsync' }
} catch {
    Report @{ type = 'error'; message = ('Windows mesh repair failed: ' + $_.Exception.GetBaseException().Message) }
    exit 1
} finally {
    if ($null -ne $outputFile) { $outputFile.Dispose() }
    if ($null -ne $resultReader) { $resultReader.Dispose() }
    if ($null -ne $inputStream) { $inputStream.Dispose() }
}
