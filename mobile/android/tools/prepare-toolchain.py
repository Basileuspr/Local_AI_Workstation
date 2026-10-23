"""Download a private Android build toolchain; never changes PATH or the workstation repo."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(os.environ['LOCALAPPDATA']) / 'LocalAIWorkstation' / 'AndroidToolchain'
ROOT.mkdir(parents=True, exist_ok=True)

def unpack(name, url, checksum, destination):
    archive = ROOT / name
    if not archive.exists() or hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != checksum:
        print('Downloading ' + name, flush=True)
        subprocess.run(['curl.exe', '--fail', '--silent', '--show-error', '--location', '--retry', '2', '--max-time', '900', '--output', str(archive), url], check=True)
    actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    if actual != checksum:
        raise RuntimeError('Checksum mismatch: ' + name)
    if not destination.exists():
        destination.mkdir(parents=True)
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                resolved = (destination / member.filename).resolve()
                if not resolved.is_relative_to(destination.resolve()):
                    raise RuntimeError('Unsafe archive entry')
            bundle.extractall(destination)
    print('Verified and extracted ' + name, flush=True)
    return {'name': name, 'url': url, 'sha256': checksum}

locked = json.loads(Path(__file__).with_name('toolchain-lock.json').read_text(encoding='utf-8'))
downloads = [(item['name'], item['url'], item['sha256'], ROOT / item['directory']) for item in locked]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    receipts = list(pool.map(lambda args: unpack(*args), downloads))
java = next((ROOT / 'jdk').glob('*/bin/java.exe')).parent.parent
sdk = ROOT / 'sdk'
sdk.mkdir(exist_ok=True)
env = dict(os.environ, JAVA_HOME=str(java), ANDROID_HOME=str(sdk), GRADLE_USER_HOME=str(ROOT / 'gradle-cache'))
manager = ROOT / 'command-line/cmdline-tools/bin/sdkmanager.bat'
for args in [['--licenses'], ['platform-tools', 'platforms;android-36', 'build-tools;36.0.0']]:
    print('SDK manager: ' + ', '.join(args), flush=True)
    result = subprocess.run([str(manager), '--sdk_root=' + str(sdk), *args], input='y\n' * 100, text=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (ROOT / ('licenses.log' if args == ['--licenses'] else 'sdk-install.log')).write_text(result.stdout, encoding='utf-8')
    if result.returncode:
        print(result.stdout[-5000:])
        raise SystemExit(result.returncode)
config = {'java': str(java), 'sdk': str(sdk), 'gradle': str(ROOT / 'gradle/gradle-8.13/bin/gradle.bat'), 'gradle_user_home': env['GRADLE_USER_HOME'], 'downloads': receipts}
(ROOT / 'toolchain.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
print('Toolchain ready: ' + str(ROOT / 'toolchain.json'), flush=True)
