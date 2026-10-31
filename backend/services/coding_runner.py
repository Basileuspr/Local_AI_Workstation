"""Fixed language recipes, launched inside the coordinator's process containment.

This is a CLI, not a model tool. It never accepts shell strings or installs packages.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.coding_project import Project


def execute(kind, root, scope, spec):
    project = Project(root)
    cwd = project.root if scope == '.' else project.path(scope)
    if not cwd.is_dir():
        raise ValueError('Verification working directory is unavailable.')
    scratch = Path(os.environ.get('LAW_VERIFICATION_RUNTIME') or tempfile.mkdtemp(prefix='law-language-check-'))
    scratch.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    environment.update(DOTNET_CLI_TELEMETRY_OPTOUT='1', DOTNET_NOLOGO='1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1',
                       ZIG_GLOBAL_CACHE_DIR=str(scratch / 'zig-cache'))
    inventory = [p for p in project.inventory() if scope == '.' or p.startswith(scope + '/')]

    def files(extensions):
        selected = [project.path(p) for p in inventory if Path(p).suffix.lower() in extensions]
        if not selected:
            raise ValueError('No matching source files were found; verification did not run.')
        if len(selected) > 1000 or any(p.stat().st_size > 2_000_000 for p in selected):
            raise ValueError('Source validation is limited to 1,000 files of at most 2 MB each. Use a narrower project check.')
        return selected

    def run(argv):
        argv = list(map(str, argv))
        print('Working directory: ' + str(cwd), flush=True)
        print('Command: ' + subprocess.list2cmdline(argv), flush=True)
        result = subprocess.run(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                creationflags=0x08000000 if os.name == 'nt' else 0)
        print('Exit status: ' + str(result.returncode), flush=True)
        if result.returncode:
            raise SystemExit(result.returncode if 0 < result.returncode < 256 else 1)

    def batches(argv, selected):
        # Avoid the Windows command line limit, without silently omitting files.
        for index in range(0, len(selected), 20):
            run([*argv, *selected[index:index + 20]])
        print(f'Submitted {len(selected)} source files; project validator rules and ignores apply where configured.', flush=True)

    if kind == 'python':
        selected = files({'.py'})
        for path in selected:
            compile(path.read_bytes(), str(path), 'exec')
        print(f'Python compilation passed for {len(selected)} files; source was not imported or executed.')
    elif kind == 'javascript':
        batches([spec['node'], Path(__file__).resolve().parents[2] / 'scripts/coding-verify-javascript.cjs',
                 str(Path(spec['parser']) / 'lib/index.js')], files({'.js', '.jsx', '.mjs', '.cjs'}))
    elif kind == 'typescript':
        base = [spec['node'], Path(spec['package']) / 'bin/tsc', '--noEmit', '--pretty', 'false']
        if (cwd / 'tsconfig.json').is_file():
            run([*base, '--project', cwd / 'tsconfig.json'])
        else:
            # One compiler invocation preserves type relationships between files.
            selected = files({'.ts', '.tsx'})
            if sum(len(str(p)) + 3 for p in selected) > 18000:
                raise ValueError('Add a tsconfig.json for this large TypeScript project.')
            run([*base, '--jsx', 'preserve', *selected])
    elif kind == 'sql':
        batches([spec['python'], '-I', Path(__file__).with_name('coding_sql_check.py'), spec['dialect']], files({'.sql'}))
    elif kind == 'html':
        batches([spec['node'], Path(spec['package']) / 'bin/html-validate.mjs'], files({'.html', '.htm'}))
    elif kind == 'css':
        config = project.path(spec['config']) if spec.get('config') else scratch / 'stylelint.json'
        if not spec.get('config'):
            config.write_text(json.dumps({'extends': [str(Path(spec['standard']) / 'index.js')]}), encoding='utf-8')
        batches([spec['node'], Path(spec['package']) / 'bin/stylelint.mjs', '--config', config], files({'.css'}))
    elif kind == 'java':
        selected = files({'.java'})
        if any(any(character in str(path) for character in '\r\n"') for path in selected):
            raise ValueError('Java source paths cannot contain quotes or newlines.')
        # javac supports an argument file and resolves all classes together.
        arguments = scratch / 'javac-sources.txt'
        arguments.write_text('\n'.join('"' + str(p).replace('\\', '/') + '"' for p in selected), encoding='utf-8')
        run([spec['javac'], '-proc:none', '-d', scratch / 'classes', '@' + str(arguments)])
    elif kind in {'c', 'cpp'}:
        selected = files({'.c'} if kind == 'c' else {'.cpp', '.cc', '.cxx'})
        for index, path in enumerate(selected):
            prefix = [spec['compiler']] + (['cc' if kind == 'c' else 'c++'] if spec['zig'] else [])
            run([*prefix, '-std=' + spec['standard'], '-I', cwd, '-c', path, '-o', scratch / f'unit-{index}.o'])
        print('Compiled translation units; no linking or program execution was performed.')
    elif kind in {'maven-test', 'maven-verify'}:
        home = Path(spec['home'])
        boot = next(home.glob('boot/plexus-classworlds-*.jar'), None)
        if not boot:
            raise ValueError('Maven installation is incomplete.')
        environment['JAVA_HOME'] = str(Path(spec['java']).parent.parent)
        run([spec['java'], '-classpath', boot, '-Dclassworlds.conf=' + str(home / 'bin/m2.conf'),
             '-Dmaven.home=' + str(home), '-Dmaven.multiModuleProjectDirectory=' + str(cwd),
             'org.codehaus.plexus.classworlds.launcher.Launcher', '--batch-mode', '--offline',
             '-Dmaven.repo.local=' + spec['cache'], '-DfailIfNoTests=true', spec['task']])
    elif kind in {'gradle-test', 'gradle-build'}:
        home = Path(spec['home'])
        cli = next(home.glob('lib/gradle-gradle-cli-main-*.jar'), None) or next(home.glob('lib/gradle-launcher-*.jar'), None)
        if not cli:
            raise ValueError('Gradle installation is incomplete.')
        agent = next(home.glob('lib/agents/gradle-instrumentation-agent-*.jar'), None)
        options = []
        if spec['task'] == 'test':
            guard = scratch / 'require-tests.gradle'
            guard.write_text('''def executedTests = new java.util.concurrent.atomic.AtomicLong()
allprojects {
    tasks.withType(org.gradle.api.tasks.testing.Test).configureEach {
        afterSuite { descriptor, result -> if (!descriptor.parent) executedTests.addAndGet(result.testCount) }
    }
}
gradle.buildFinished { result ->
    if (!result.failure && executedTests.get() == 0) throw new GradleException("No tests executed; verification did not pass.")
}
''', encoding='utf-8')
            options = ['--init-script', guard]
        environment['JAVA_HOME'] = str(Path(spec['java']).parent.parent)
        run([spec['java'], *(['-javaagent:' + str(agent)] if agent else []), '-classpath', cli,
             'org.gradle.launcher.GradleMain', '--offline', '--no-daemon', '--console=plain', '--max-workers=2',
             '--gradle-user-home', spec['cache'], '--rerun-tasks', *options, spec['task']])
    elif kind in {'cmake-build', 'cmake-test'}:
        build = scratch / 'cmake-build'
        options = []
        if spec.get('zig') and spec.get('ninja'):
            options = ['-G', 'Ninja', '-DCMAKE_MAKE_PROGRAM=' + spec['ninja'],
                       '-DCMAKE_C_COMPILER=' + spec['zig'], '-DCMAKE_C_COMPILER_ARG1=cc',
                       '-DCMAKE_CXX_COMPILER=' + spec['zig'], '-DCMAKE_CXX_COMPILER_ARG1=c++']
        run([spec['cmake'], '-S', cwd, '-B', build, '-DFETCHCONTENT_FULLY_DISCONNECTED=ON', *options])
        run([spec['cmake'], '--build', build, '--config', 'Debug', '--parallel', '2'])
        if spec['task'] == 'test':
            run([Path(spec['cmake']).with_name('ctest.exe' if os.name == 'nt' else 'ctest'),
                 '--test-dir', build, '-C', 'Debug', '--output-on-failure', '--no-tests=error'])
    elif kind in {'dotnet-build', 'dotnet-test'}:
        results = scratch / 'dotnet-results'
        options = ['--logger', 'trx', '--results-directory', results] if spec['task'] == 'test' else []
        run([spec['dotnet'], spec['task'], spec['project'], '--no-restore', '--nologo', '--disable-build-servers', *options])
        if spec['task'] == 'test':
            reports = list(results.glob('*.trx'))
            if len(reports) > 100 or any(path.stat().st_size > 2_000_000 for path in reports):
                raise ValueError('Test reports exceed the verification inspection limit.')
            executed = sum(int(counter.get('executed', '0')) for path in reports
                           for counter in ET.parse(path).iter() if counter.tag.rsplit('}', 1)[-1] == 'Counters')
            if not executed:
                raise ValueError('No executed tests in VSTest reports; verification did not pass. Use a project-specific check for another test platform.')
            print(f'Verified {executed} executed .NET tests from fresh reports.', flush=True)
    else:
        raise ValueError('Unknown verification recipe.')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 5:
            raise ValueError('Expected recipe, repository, scope and tool specification.')
        execute(*sys.argv[1:4], json.loads(sys.argv[4]))
    except (ValueError, OSError, SyntaxError, KeyError) as error:
        print('Verification failed: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
