"""Native source stays complete while Android runtime/signing material stays local."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


publisher = load('publish-github')
capture = load('capture-app-review')


def test_complete_native_source_is_captured_and_privacy_checked():
    names = [str(path.relative_to(ROOT)).replace('\\', '/')
             for path in (ROOT / 'mobile-companion/android').rglob('*') if path.is_file()
             and not any(part in {'build', '.gradle', 'output'} for part in path.parts)]
    assert any(name.endswith('MainActivity.java') for name in names)
    assert any(name.endswith('AndroidManifest.xml') for name in names)
    for name in names:
        assert publisher.allowed(name), name
        assert capture.included(name), name
        assert publisher.privacy_problem(name, (ROOT / name).read_bytes()) is None, name


def test_native_build_outputs_secrets_and_traversal_are_not_source():
    private = [
        'output/Workstation-Companion.apk', 'output/SHA256SUMS.txt',
        'app/build/outputs/apk/release/AndroidManifest.xml', '.gradle/settings.json',
        'local.properties', 'signing.properties', 'release.jks', 'release.p12',
        'gradle/wrapper/gradle-wrapper.jar', 'data/device.json',
        'app/src/main/.env.java', 'app/src/main/.git/hidden.java',
        'app/src/main/../../../private.java', 'app/src/C:/private.java',
        'app/src/main\\private.java', 'tools/private-report.json',
    ]
    for name in private:
        assert not publisher.allowed('mobile-companion/android/' + name), name
        assert not capture.included('mobile-companion/android/' + name), name
    # The additional native formats are not a broad permission elsewhere.
    assert not publisher.allowed('mobile-companion/private.xml')
    assert not publisher.allowed('src/private.gradle')
