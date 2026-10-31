export const REVERSE_ENGINEER_KEY = 'local-ai-workstation-reverse-engineer-v1';
export const reverseCategories = ['Native code', '.NET', 'Android', 'Runtime analysis'];
const retiredTools = ['ida', 'binary-ninja', 'cutter', 'radare2', 'ilspy'];

export const reverseTools = [
  {
    id: 'ghidra', name: 'Ghidra', category: 'Native code', kind: 'Read compiled programs', level: 'Start here for native code',
    task: 'Understand a Windows program or firmware',
    description: 'Turns machine instructions into readable, C-like code so you can explore what a program does.',
    bestFor: 'An EXE, DLL or firmware file when you do not have its source code.',
    example: 'Find how your own C/C++ application reads a file or handles a particular message.',
    files: 'Native EXE · DLL · firmware', outcome: 'A project with functions, strings and reconstructed code you can browse.',
    launch: 'Opens the Ghidra project manager. No target program runs when you import it for analysis.',
    steps: ['Choose File → New Project → Non-Shared Project, then pick a folder and name.',
      'Choose File → Import File and select a copy of your EXE or DLL. Accept the detected format.',
      'Double-click the imported file, choose Yes to analyze it, then select a function to read the Decompiler pane.'],
    platforms: 'Windows · macOS · Linux', license: 'Free · open source',
    website: 'https://github.com/NationalSecurityAgency/ghidra/releases', docs: 'https://github.com/NationalSecurityAgency/ghidra',
    note: 'Reconstructed code will not contain the original comments and may have unfamiliar names. Use dnSpyEx for managed .NET files.',
  },
  {
    id: 'dnspyex', name: 'dnSpyEx', category: '.NET', kind: 'Read and debug C# / .NET apps', level: 'Good first tool for .NET',
    task: 'Read the C# code inside a .NET app',
    description: 'Shows the classes and methods inside a .NET program as readable C#. It can also pause the program while it runs.',
    bestFor: 'Managed .NET EXE and DLL files, including supported Unity Mono assemblies.',
    example: 'Open your own .NET utility and find the method behind one of its buttons.',
    files: 'Managed .NET EXE · DLL', outcome: 'A tree of namespaces, classes and methods with reconstructed C#.',
    launch: 'Opens the dnSpyEx assembly browser. Opening a file for reading does not start that file.',
    steps: ['Choose File → Open and select a copy of your .NET EXE or DLL.',
      'Expand the assembly tree, choose a class, then click a method to read its C# code.',
      'Start by reading only. For a program you trust, Debug → Start Debugging lets you use breakpoints to follow execution.'],
    platforms: 'Windows', license: 'Free · open source',
    website: 'https://github.com/dnSpyEx/dnSpy/releases', docs: 'https://github.com/dnSpyEx/dnSpy',
    note: 'Native C/C++ and Unity IL2CPP builds need a native-code workflow such as Ghidra. Editing assemblies changes the file when you save.',
  },
  {
    id: 'jadx', name: 'JADX', category: 'Android', kind: 'Read Android app packages', level: 'Good first tool for Android',
    task: 'Look inside an Android APK',
    description: 'Opens an Android app package and shows Java-like code, its manifest and packaged resources.',
    bestFor: 'An APK or DEX file you want to understand without installing the app on a phone.',
    example: 'Inspect your own APK to see its declared permissions, screens and bundled images.',
    files: 'APK · DEX · Java archives', outcome: 'Browsable code and resources, including AndroidManifest.xml.',
    launch: 'Opens the graphical JADX window. Opening an APK here does not install or run the app.',
    steps: ['Choose File → Open and select your APK.',
      'Expand Resources and open AndroidManifest.xml to see the app entry points and requested permissions.',
      'Expand Source code to browse classes. Use search to locate text or a class name that interests you.'],
    platforms: 'Windows · macOS · Linux', license: 'Free · open source',
    website: 'https://github.com/skylot/jadx/releases', docs: 'https://github.com/skylot/jadx',
    note: 'Some code cannot be fully reconstructed. Native .so libraries inside an APK are a job for Ghidra.',
  },
  {
    id: 'x64dbg', name: 'x64dbg', category: 'Runtime analysis', kind: 'Step through a Windows program', level: 'Intermediate · runs your target',
    task: 'Pause a Windows program and inspect it',
    description: 'A Windows debugger: pause a program, step through its instructions and inspect memory as it runs.',
    bestFor: 'Finding what a native Windows EXE does at a particular moment, such as just before a crash.',
    example: 'Run your own small Windows program, pause it and inspect the instruction where it stops.',
    files: '32-bit or 64-bit Windows EXE', outcome: 'A live view of instructions, registers, memory and the call stack.',
    launch: 'Opens the architecture chooser. Choose x64dbg for a 64-bit target or x32dbg for a 32-bit target.',
    steps: ['Choose the debugger matching your program: x64dbg (64-bit) or x32dbg (32-bit).',
      'Choose File → Open and select an EXE you trust. The debugger starts it in a paused state.',
      'Use Debug → Run to continue, Pause to stop, or Step over to advance one instruction. Stop debugging when finished.'],
    platforms: 'Windows', license: 'Free · open source',
    website: 'https://x64dbg.com/', docs: 'https://help.x64dbg.com/',
    note: 'Debugging executes the target. Start with your own test program; use Ghidra first if you only want to read a file.',
  },
  {
    id: 'frida', name: 'Frida', category: 'Runtime analysis', kind: 'Trace live behavior with scripts', level: 'Advanced · scripting',
    task: 'Record function calls with a script',
    description: 'Runs your JavaScript probes inside a selected process to observe function calls and values while it runs.',
    bestFor: 'Repeatable tracing across many calls, after you know what part of a program you want to observe.',
    example: 'Write a probe that logs each call to a known function in your own test application.',
    files: 'Running processes · JavaScript probes', outcome: 'A terminal showing process information or the output of your tracing script.',
    launch: 'Opens a prepared terminal with Frida commands and a small help menu. It does not attach to a process automatically.',
    steps: ['In the Frida terminal, enter frida-ps to list local processes and note the ID of your own test app.',
      'Follow the official JavaScript API guide to create a probe for a function you understand.',
      'Load your probe with frida -p <PID> -l <script.js>, replacing both placeholders. Enter exit to leave the session.'],
    platforms: 'Windows desktop · Android / iOS with extra setup', license: 'Free · open source',
    website: 'https://frida.re/', docs: 'https://frida.re/docs/home/',
    note: 'The local desktop tools are sufficient for Windows tracing. Phone tracing needs separate device setup; this launcher does not configure a phone.',
  },
];

export function filterReverseTools(query = '', category = '', linkedOnly = false, links = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return reverseTools.filter(tool => (!category || tool.category === category) && (!linkedOnly || links[tool.id])
    && terms.every(term => [tool.name, tool.category, tool.kind, tool.description, tool.bestFor, tool.platforms, tool.task, tool.example, tool.files]
      .join(' ').toLocaleLowerCase().includes(term)));
}

export function validateReverseLinks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved tool launchers could not be read.');
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((!reverseTools.some(tool => tool.id === key) && !retiredTools.includes(key)) || !entry || typeof entry.id !== 'string'
      || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(entry.id)
      || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 260) {
      throw new Error('Saved tool launchers could not be read.');
    }
    if (!retiredTools.includes(key)) clean[key] = { id: entry.id, name: entry.name };
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
