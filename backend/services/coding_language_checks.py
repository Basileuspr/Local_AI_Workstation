"""Language recipes. All execution remains behind the coordinator's grants."""
from __future__ import annotations
import configparser
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tomllib
from services.coding_toolchains import installed, node_package, build_home

HELPER = Path(__file__).with_name('coding_runner.py')
WEB_HELPER = Path(__file__).resolve().parents[2] / 'scripts/coding-verify-javascript.cjs'
CONFIG_NAMES = {'.law-verification.json', '.sqlfluff', '.sqlfluffignore', '.htmlvalidate.json', '.htmlvalidate.js',
                '.htmlvalidate.cjs', '.htmlvalidate.mjs', '.htmlvalidateignore', '.stylelintrc', '.stylelintrc.json',
                '.stylelintrc.js', '.stylelintrc.cjs', '.stylelintrc.mjs', '.stylelintrc.yaml', '.stylelintrc.yml', '.stylelintignore',
                'stylelint-suppressions.json', 'stylelint.config.js', 'stylelint.config.cjs', 'stylelint.config.mjs',
                'pom.xml', 'settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradle.properties',
                'gradle-wrapper.properties', 'maven-wrapper.properties', 'CMakeLists.txt', 'CMakePresets.json',
                'CMakeUserPresets.json', 'global.json', 'NuGet.Config', 'Directory.Build.props', 'Directory.Build.targets'}
EXTENSIONS = {'sql': {'.sql'}, 'html': {'.html', '.htm'}, 'css': {'.css', '.scss', '.less'},
              'jvm': {'.java', '.kt', '.kts', '.scala', '.groovy', '.xml', '.properties'},
              'c': {'.c', '.h'}, 'cpp': {'.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh', '.h'},
              'native': {'.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.hh', '.cmake'},
              'dotnet': {'.cs', '.fs', '.vb', '.csproj', '.fsproj', '.vbproj', '.sln', '.slnx', '.props', '.targets', '.resx', '.xaml', '.razor', '.cshtml'}}


def configuration(project, scope):
    path = '.law-verification.json' if scope == '.' else scope + '/.law-verification.json'
    file = project.path(path)
    if not file.exists():
        return {}
    if file.stat().st_size > 16000:
        raise ValueError('Verification configuration exceeds 16 KB.')
    value = json.loads(file.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict) or set(value) - {'sql_dialect', 'c_standard', 'cpp_standard'}:
        raise ValueError('Verification configuration accepts sql_dialect, c_standard and cpp_standard only.')
    if any(not isinstance(v, str) or not re.fullmatch(r'[A-Za-z0-9+_-]{1,40}', v) for v in value.values()):
        raise ValueError('Verification settings must be simple dialect/standard names.')
    return value


def extend(project, paths, add, warnings, environments):
    tools = installed()
    paths = set(paths)
    configs = sorted(p for p in paths if PurePosixPath(p).name in CONFIG_NAMES or Path(p).suffix in {'.csproj', '.fsproj', '.vbproj', '.props', '.targets', '.cmake'})
    by_ext = lambda extensions: sorted(p for p in paths if Path(p).suffix.lower() in extensions)
    setup = 'Install the missing tool or run python scripts/prepare-coding-verification.py --native in the Workstation checkout.'

    def recipe(source, key, title, category, language, specification, description, *, scope='.', needed=(), recommended=False, problem=''):
        missing = [name for name in needed if not specification.get(name)]
        problem = problem or (('Missing ' + ', '.join(missing) + '. ' + setup) if missing else '')
        argv = [sys.executable, '-I', str(HELPER), key, str(project.root), scope, json.dumps(specification, sort_keys=True)]
        host_files = [str(HELPER), str(Path(__file__)), str(Path(__file__).with_name('coding_toolchains.py')), str(Path(__file__).with_name('coding_sql_check.py')), str(WEB_HELPER)]
        host_files += [v for k, v in specification.items() if k != 'cache' and isinstance(v, str) and Path(v).is_absolute()]
        for name in ('package', 'parser', 'standard'):
            if specification.get(name):
                host_files.append(str(Path(specification[name]) / 'package.json'))
        if specification.get('home'):
            home = Path(specification['home'])
            host_files.extend(str(p) for p in home.glob('lib/*core-*.jar'))
        host_files += [str(Path(tools['root']) / 'node/package-lock.json')]
        identity_source = source if PurePosixPath(source).name in CONFIG_NAMES | {'tsconfig.json'} or Path(source).suffix in {'.csproj', '.fsproj', '.vbproj'} else scope
        return add(source, key, title, category, argv, language, definition=description, unavailable=problem,
                   cwd=scope, extra_inputs=[p for p in configs if scope == '.' or p.startswith(scope + '/') or PurePosixPath(p).parent in PurePosixPath(scope).parents or str(PurePosixPath(p).parent) == scope], tool_inputs=host_files, display_command=description,
                   recommended=recommended, timeout_seconds=300, identity='language:' + key + ':' + identity_source,
                   risk='Runs the displayed verification recipe with your account permissions. Project build scripts/plugins may execute code. Dependencies are not installed during verification.')

    try:
        config = configuration(project, '.')
    except (ValueError, OSError) as error:
        warnings.append('.law-verification.json: ' + str(error))
        config = {}
        # Never silently approve or run a replacement for a malformed explicit configuration.
        return

    for language, extensions, label in [('sql', {'.sql'}, 'SQL'), ('html', {'.html', '.htm'}, 'HTML'), ('css', {'.css'}, 'CSS')]:
        sources = by_ext(extensions)
        if not sources:
            continue
        environments.add(label)
        spec = {'node': tools['node']}
        if language == 'sql':
            dialect = config.get('sql_dialect', 'ansi')
            try:
                if 'sql_dialect' not in config and '.sqlfluff' in paths:
                    ini = configparser.ConfigParser(interpolation=None)
                    ini.read_string(project.path('.sqlfluff').read_text(encoding='utf-8-sig'))
                    dialect = ini.get('sqlfluff', 'dialect', fallback='ansi')
                elif 'sql_dialect' not in config and 'pyproject.toml' in paths:
                    dialect = tomllib.loads(project.path('pyproject.toml').read_text()).get('tool', {}).get('sqlfluff', {}).get('core', {}).get('dialect', 'ansi')
                if not isinstance(dialect, str) or not re.fullmatch(r'[a-z0-9_]{1,40}', dialect):
                    raise ValueError('Invalid SQL dialect.')
            except (ValueError, OSError, AttributeError, configparser.Error) as error:
                warnings.append('SQL configuration: ' + str(error)); continue
            spec = {'python': tools['python'], 'dialect': dialect}
            description = f'SQLFluff parser: {dialect} dialect, raw SQL (grammar only, no database execution)'
            needed = ('python',)
        else:
            package = 'html-validate' if language == 'html' else 'stylelint'
            spec['package'] = node_package(project, '.', package)
            if language == 'css':
                spec['standard'] = node_package(project, '.', 'stylelint-config-standard')
                spec['config'] = next((p for p in configs if str(PurePosixPath(p).parent) == '.' and (PurePosixPath(p).name.startswith('.stylelintrc') or PurePosixPath(p).name.startswith('stylelint.config.'))), '')
            needed = ('node', 'package') + (('standard',) if language == 'css' and not spec['config'] else ())
            description = 'HTML-validate: validate HTML files' if language == 'html' else 'Stylelint: lint CSS files without fixing them'
        recipe(sources[0], language, label + (' syntax' if language == 'sql' else ' validation'), 'lint', language, spec, description, needed=needed, recommended=True)

    javascript = by_ext({'.js', '.jsx', '.mjs', '.cjs'})
    if javascript:
        environments.add('JavaScript / Node.js')
        recipe(javascript[0], 'javascript', 'JavaScript / JSX syntax', 'lint', 'javascript',
               {'node': tools['node'], 'parser': node_package(project, '.', '@babel/parser')},
               'Babel parser: check JavaScript and JSX syntax without executing source', needed=('node', 'parser'), recommended=True)
    typescript = by_ext({'.ts', '.tsx'})
    if typescript:
        environments.add('TypeScript')
        scopes = sorted(str(PurePosixPath(p).parent) for p in paths if PurePosixPath(p).name == 'tsconfig.json') or ['.']
        for scope in scopes[:12]:
            source = 'tsconfig.json' if scope == '.' and 'tsconfig.json' in paths else scope + '/tsconfig.json' if scope != '.' else typescript[0]
            recipe(source, 'typescript', 'TypeScript type check', 'types', 'javascript',
                   {'node': tools['node'], 'package': node_package(project, scope, 'typescript')},
                   'tsc --noEmit --pretty false (project configuration when present)', scope=scope, needed=('node', 'package'), recommended=True)
    python = by_ext({'.py'})
    if python:
        environments.add('Python')
        recipe(python[0], 'python', 'Python syntax', 'lint', 'python', {}, 'Compile Python source in memory without importing it', recommended=False)

    jvm_manifests = sorted(p for p in paths if PurePosixPath(p).name in {'pom.xml', 'build.gradle', 'build.gradle.kts'})
    for source in jvm_manifests[:20]:
        scope = str(PurePosixPath(source).parent)
        kind = 'maven' if source.endswith('pom.xml') else 'gradle'
        environments.add('Java / JVM (' + ('Maven' if kind == 'maven' else 'Gradle') + ')')
        home, problem = build_home(project, scope, kind, tools)
        spec = {'java': tools['java'], 'home': home, 'cache': str(Path(tools['root']) / (kind + '-cache'))}
        for task, category in [('test', 'tests'), ('verify' if kind == 'maven' else 'build', 'build')]:
            recipe(source, kind + '-' + task, kind.title() + ' ' + task, category, 'jvm', {**spec, 'task': task},
                   kind.title() + ' ' + task + ' (offline, fresh checks, no persistent daemon)', scope=scope, needed=('java', 'home'), recommended=task == 'test', problem=problem)
    java = by_ext({'.java'})
    if java and not jvm_manifests:
        environments.add('Java')
        recipe(java[0], 'java', 'Java compilation', 'build', 'jvm', {'javac': tools['javac']},
               'javac -proc:none -d <temporary classes> (Java sources; default classpath)', needed=('javac',), recommended=True)
    if by_ext({'.kt', '.kts'}): environments.add('Kotlin / JVM')
    if by_ext({'.scala'}): environments.add('Scala / JVM')
    if by_ext({'.groovy'}): environments.add('Groovy / JVM')
    if by_ext({'.kt', '.scala', '.groovy'}) and not jvm_manifests:
        warnings.append('Kotlin/Scala/Groovy verification requires a Maven or Gradle project with its compiler plugin installed.')

    for language, extensions, label in [('c', {'.c'}, 'C'), ('cpp', {'.cpp', '.cc', '.cxx'}, 'C++')]:
        sources = by_ext(extensions)
        if sources:
            environments.add(label)
            compiler = tools['cc' if language == 'c' else 'cxx'] or tools['zig']
            standard = config.get('c_standard' if language == 'c' else 'cpp_standard', 'c17' if language == 'c' else 'c++17')
            recipe(sources[0], language, label + ' compilation', 'build', language,
                   {'compiler': compiler, 'zig': compiler == tools['zig'], 'standard': standard},
                   label + ' compiler -c -std=' + standard + ' (objects in temporary directory; no linking or execution)', needed=('compiler',),
                   recommended=not any(PurePosixPath(p).name == 'CMakeLists.txt' for p in paths))
    for source in sorted(p for p in paths if PurePosixPath(p).name == 'CMakeLists.txt')[:12]:
        scope = str(PurePosixPath(source).parent)
        # Child lists normally belong to the containing CMake project.
        if any(source != other and (str(PurePosixPath(other).parent) == '.' or source.startswith(str(PurePosixPath(other).parent) + '/')) for other in paths if PurePosixPath(other).name == 'CMakeLists.txt'):
            continue
        for task, category in [('build', 'build'), ('test', 'tests')]:
            recipe(source, 'cmake-' + task, 'CMake ' + task, category, 'native',
                   {'cmake': tools['cmake'], 'ninja': tools['ninja'], 'zig': tools['zig'], 'task': task},
                   'CMake configure + build in temporary directory' + (' + CTest --no-tests=error' if task == 'test' else ''),
                   scope=scope, needed=('cmake',), recommended=task == 'test')
    for source in sorted(p for p in paths if Path(p).suffix in {'.csproj', '.fsproj', '.vbproj'})[:20]:
        scope = str(PurePosixPath(source).parent)
        environments.add('.NET / C# / F# / Visual Basic')
        file = project.path(source)
        if file.stat().st_size > 128000:
            warnings.append(source + ': manifest exceeds the 128 KB inspection limit.'); continue
        text = file.read_text(encoding='utf-8-sig')
        test_project = bool(re.search(r'IsTestProject>\s*true|Microsoft.NET.Test.Sdk|xunit|NUnit|MSTest', text, re.I))
        for task in (['build', 'test'] if test_project else ['build']):
            recipe(source, 'dotnet-' + task, '.NET ' + task + ' ' + PurePosixPath(source).name, 'tests' if task == 'test' else 'build', 'dotnet',
                   {'dotnet': tools['dotnet'], 'project': PurePosixPath(source).name, 'task': task},
                   'dotnet ' + task + ' ' + PurePosixPath(source).name + ' --no-restore --nologo', scope=scope, needed=('dotnet',), recommended=True)
