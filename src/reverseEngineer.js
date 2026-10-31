export const REVERSE_ENGINEER_KEY = 'local-ai-workstation-reverse-engineer-v1';
export const reverseCategories = ['Native code', 'Runtime analysis', '.NET', 'Android'];

export const reverseTools = [
  {
    id: 'ghidra', name: 'Ghidra', category: 'Native code', kind: 'Reverse-engineering framework',
    description: 'Explore compiled programs with disassembly, C-like decompilation, function graphs and scripting.',
    bestFor: 'Understanding native executables, libraries and firmware without their original source.',
    platforms: 'Windows · macOS · Linux', license: 'Free · open source',
    website: 'https://github.com/NationalSecurityAgency/ghidra/releases',
    docs: 'https://github.com/NationalSecurityAgency/ghidra',
    setup: 'Download the official release, extract it, and install the Java version required by that release. On Windows, create a shortcut to ghidraRun.bat and link that .lnk here.',
    note: 'Decompiled code is a reconstruction; original comments and many names are not recovered.',
  },
  {
    id: 'ida', name: 'IDA / IDA Pro', category: 'Native code', kind: 'Disassembler, debugger & decompiler suite',
    description: 'Navigate assembly, cross-references and function graphs, with decompilation available by edition.',
    bestFor: 'Detailed analysis of native applications across supported processor architectures.',
    platforms: 'Windows · macOS · Linux', license: 'Free edition · paid editions',
    website: 'https://hex-rays.com/ida-free', docs: 'https://docs.hex-rays.com/',
    setup: 'Choose an edition from Hex-Rays, install it, then link its executable or Windows shortcut.',
    note: 'IDA Free is for non-commercial use and uses cloud-based decompilation. Check the edition before sending code for decompilation.',
  },
  {
    id: 'binary-ninja', name: 'Binary Ninja', category: 'Native code', kind: 'Binary analysis platform',
    description: 'Read disassembly and decompiled code, debug applications, and automate analysis in supported editions.',
    bestFor: 'Interactive native-code analysis and repeatable analysis scripts.',
    platforms: 'Windows · macOS · Linux', license: 'Free edition · paid editions',
    website: 'https://binary.ninja/free/', docs: 'https://binary.ninja/features/',
    setup: 'Install the desktop edition you want to use and link its executable or Windows shortcut.',
    note: 'The free desktop edition has architecture and API/plugin restrictions. Paid editions offer broader automation.',
  },
  {
    id: 'cutter', name: 'Cutter', category: 'Native code', kind: 'Graphical reverse-engineering platform',
    description: 'Inspect binaries through a graphical interface powered by the Rizin analysis engine.',
    bestFor: 'Visual navigation of assembly, graphs and decompiled code in an open-source workspace.',
    platforms: 'Windows · macOS · Linux', license: 'Free · open source',
    website: 'https://cutter.re/', docs: 'https://cutter.re/docs/',
    setup: 'Download the official release, extract the Windows archive, and link cutter.exe or its shortcut.',
    note: 'Cutter uses Rizin. radare2 is a separate tool with its own commands and plugins.',
  },
  {
    id: 'radare2', name: 'radare2', category: 'Native code', kind: 'Command-line reverse-engineering framework',
    description: 'Disassemble, debug and edit binaries with terminal commands, scripts and plugins.',
    bestFor: 'Terminal-based exploration and automated binary-analysis workflows.',
    platforms: 'Windows · macOS · Linux', license: 'Free · open source',
    website: 'https://github.com/radareorg/radare2/releases', docs: 'https://github.com/radareorg/radare2',
    setup: 'Install an official release. Create a Windows terminal shortcut for your radare2 workflow and link the .lnk so the terminal stays open.',
    note: 'Choose target files and arguments in your terminal. This workspace opens your saved launcher without constructing commands.',
  },
  {
    id: 'x64dbg', name: 'x64dbg', category: 'Runtime analysis', kind: 'Windows debugger',
    description: 'Pause a running program, step through instructions, and inspect memory, registers and threads.',
    bestFor: 'Observing the runtime behavior of 32-bit and 64-bit Windows applications.',
    platforms: 'Windows', license: 'Free · open source',
    website: 'https://x64dbg.com/', docs: 'https://help.x64dbg.com/',
    setup: 'Extract the official Windows release and link x96dbg.exe, x64dbg.exe, x32dbg.exe, or a shortcut.',
    note: 'Debugging executes the selected application. Choose the application inside the debugger after launch.',
  },
  {
    id: 'ilspy', name: 'ILSpy', category: '.NET', kind: '.NET assembly browser & decompiler',
    description: 'Browse .NET classes and methods, reconstruct readable C#, and export decompiled projects.',
    bestFor: 'Reading managed .NET executables and DLLs.',
    platforms: 'See release-specific packages', license: 'Free · open source',
    website: 'https://github.com/icsharpcode/ILSpy/releases', docs: 'https://github.com/icsharpcode/ILSpy',
    setup: 'Install or extract an official desktop release and link ILSpy.exe or its Windows shortcut.',
    note: 'Designed for managed .NET assemblies. Native machine-code binaries need a native-code analysis tool.',
  },
  {
    id: 'dnspyex', name: 'dnSpyEx', category: '.NET', kind: '.NET debugger & assembly editor',
    description: 'Inspect, debug and edit .NET assemblies, including supported Unity managed assemblies.',
    bestFor: 'Following managed code while it runs and reviewing changes to .NET assemblies.',
    platforms: 'Windows', license: 'Free · open source',
    website: 'https://github.com/dnSpyEx/dnSpy/releases', docs: 'https://github.com/dnSpyEx/dnSpy',
    setup: 'Extract the official dnSpyEx release and link dnSpy.exe or its shortcut.',
    note: 'A continuation of dnSpy. Unity debugging needs the documented Mono support; native IL2CPP builds require a different workflow.',
  },
  {
    id: 'jadx', name: 'JADX', category: 'Android', kind: 'Android / Java decompiler',
    description: 'Inspect APK and DEX bytecode as Java-like source alongside the manifest and application resources.',
    bestFor: 'Understanding Android application code and resources.',
    platforms: 'Windows · macOS · Linux', license: 'Free · open source',
    website: 'https://github.com/skylot/jadx/releases', docs: 'https://github.com/skylot/jadx',
    setup: 'Use an official Windows bundle or the Java-based release. Link jadx-gui.exe, or create and link a shortcut to jadx-gui.bat.',
    note: 'Some methods cannot be fully decompiled. Native libraries inside an APK need a native-code tool such as Ghidra.',
  },
  {
    id: 'frida', name: 'Frida', category: 'Runtime analysis', kind: 'Dynamic instrumentation toolkit',
    description: 'Use scripts to trace function calls, inspect values and change behavior while an application runs.',
    bestFor: 'Scripted runtime investigation of desktop and mobile applications.',
    platforms: 'Desktop · Android · iOS', license: 'Free · open source',
    website: 'https://frida.re/', docs: 'https://frida.re/docs/home/',
    setup: 'Follow the official installation guide for frida-tools and your target platform. Link a Windows terminal shortcut prepared for your Frida environment.',
    note: 'Device setup and compatible target components may be required. Select processes and scripts in your Frida session.',
  },
];

export function filterReverseTools(query = '', category = '', linkedOnly = false, links = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return reverseTools.filter(tool => (!category || tool.category === category) && (!linkedOnly || links[tool.id])
    && terms.every(term => [tool.name, tool.category, tool.kind, tool.description, tool.bestFor, tool.platforms, tool.setup]
      .join(' ').toLocaleLowerCase().includes(term)));
}

export function validateReverseLinks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved tool launchers could not be read.');
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!reverseTools.some(tool => tool.id === key) || !entry || typeof entry.id !== 'string'
      || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(entry.id)
      || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 260) {
      throw new Error('Saved tool launchers could not be read.');
    }
    clean[key] = { id: entry.id, name: entry.name };
  }
  return clean;
}

export function loadReverseLinks(storage) {
  try {
    storage ??= globalThis.localStorage;
    if (!storage) return { links: {}, error: '' };
    const raw = storage.getItem(REVERSE_ENGINEER_KEY);
    return { links: raw === null ? {} : validateReverseLinks(JSON.parse(raw)), error: '' };
  } catch { return { links: {}, error: 'Saved tool launchers could not be read. Existing settings have been preserved. Retry after restoring browser storage.' }; }
}

export function saveReverseLinks(links, storage = globalThis.localStorage) {
  if (!storage) throw new Error('Tool launchers could not be saved. Browser storage is unavailable.');
  const clean = validateReverseLinks(links);
  storage.setItem(REVERSE_ENGINEER_KEY, JSON.stringify(clean));
  return clean;
}
