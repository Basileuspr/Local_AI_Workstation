param(
    [ValidateSet('all','omnivoice','chatterbox-turbo','qwen3-tts')][string]$Model = 'all',
    [string]$ModelsDir = $env:LAW_MODELS_DIR
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ModelsDir) { $ModelsDir = Join-Path $projectRoot 'models' }
if (-not [System.IO.Path]::IsPathRooted($ModelsDir)) { $ModelsDir = Join-Path $projectRoot $ModelsDir }
$voiceRoot = Join-Path ([System.IO.Path]::GetFullPath($ModelsDir)) 'audio/voice-cloning'
$pythonBase = (py -3.11 -c 'import sys; print(sys.executable)')
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.11 first.' }
$engines = @(
    @{ Id='omnivoice'; Runtime='omnivoice'; Folder='omnivoice'; Repository='k2-fsa/OmniVoice'; ModelRevision='c5fdb5ccb189668d56333f77ba2629f4cd7535f4'; Git='https://github.com/k2-fsa/OmniVoice.git'; GitRevision='08be0b4ccbac3e13e374e86fbfead4b4cac343e2'; Torch='2.8.0'; Cuda='cu128'; Import='from omnivoice import OmniVoice' },
    @{ Id='chatterbox-turbo'; Runtime='chatterbox'; Folder='chatterbox-turbo'; Repository='ResembleAI/chatterbox-turbo'; ModelRevision='749d1c1a46eb10492095d68fbcf55691ccf137cd'; Git='https://github.com/resemble-ai/chatterbox.git'; GitRevision='5de7a54aa4e5e2baadb0182dde554908b48b85c2'; Torch='2.6.0'; Cuda='cu126'; Import='from chatterbox.tts_turbo import ChatterboxTurboTTS' },
    @{ Id='qwen3-tts'; Runtime='qwen3-tts'; Folder='qwen3-tts-0.6b'; Repository='Qwen/Qwen3-TTS-12Hz-0.6B-Base'; ModelRevision='5d83992436eae1d760afd27aff78a71d676296fc'; Git='https://github.com/QwenLM/Qwen3-TTS.git'; GitRevision='022e286b98fbec7e1e916cb940cdf532cd9f488e'; Torch='2.8.0'; Cuda='cu128'; Import='from qwen_tts import Qwen3TTSModel' }
)
$previousOffline = $env:HF_HUB_OFFLINE
$previousCache = $env:HF_HOME
try {
    $env:HF_HUB_OFFLINE = '0'
    $env:HF_HOME = Join-Path $voiceRoot 'cache'
    foreach ($engine in $engines) {
        if ($Model -ne 'all' -and $Model -ne $engine.Id) { continue }
        Write-Host ('Installing ' + $engine.Id + ' in its own runtime...')
        $source = Join-Path $voiceRoot ('sources/' + $engine.Runtime)
        if (-not (Test-Path -LiteralPath $source)) {
            git clone $engine.Git $source
            if ($LASTEXITCODE -ne 0) { throw 'Source download failed.' }
            git -C $source checkout --detach $engine.GitRevision
            if ($LASTEXITCODE -ne 0) { throw 'Pinned source revision is unavailable.' }
        }
        $revision = git -C $source rev-parse HEAD
        if ($revision -ne $engine.GitRevision) { throw ('Existing source revision differs: ' + $source) }
        $runtime = Join-Path $voiceRoot ('runtimes/' + $engine.Runtime)
        $python = Join-Path $runtime 'Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $python)) {
            & $pythonBase -m venv $runtime
            if ($LASTEXITCODE -ne 0) { throw 'Could not create voice runtime.' }
        }
        @{ state='installing'; engine=$engine.Id } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'installed.json') -Encoding UTF8
        & $python -m pip install ('torch==' + $engine.Torch) ('torchaudio==' + $engine.Torch) --index-url ('https://download.pytorch.org/whl/' + $engine.Cuda)
        if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed.' }
        & $python -m pip install $source
        if ($LASTEXITCODE -ne 0) { throw 'Voice package installation failed.' }
        $hf = Join-Path $runtime 'Scripts/hf.exe'
        $downloadArgs = @('download', $engine.Repository, '--revision', $engine.ModelRevision, '--local-dir', (Join-Path $voiceRoot $engine.Folder))
        if ($engine.Id -eq 'chatterbox-turbo') { $downloadArgs += @('--exclude','s3gen.safetensors') }
        & $hf @downloadArgs
        if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }
        & $python -c $engine.Import
        if ($LASTEXITCODE -ne 0) { throw 'Voice runtime import check failed.' }
        & $python -m pip check
        if ($LASTEXITCODE -ne 0) { throw 'Voice runtime has incompatible dependencies.' }
        $receipt = @{ state='ready'; engine=$engine.Id; source_revision=$engine.GitRevision; model_revision=$engine.ModelRevision; installed_at=(Get-Date).ToString('o') }
        $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'installed.json') -Encoding UTF8
    }
} finally {
    $env:HF_HUB_OFFLINE = $previousOffline
    $env:HF_HOME = $previousCache
}
Write-Host 'Selected voice engines installed. Reopen the Audio workspace.'
