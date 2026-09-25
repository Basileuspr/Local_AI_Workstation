$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WorkstationGraphicsShortcut {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$shortcutKeys = [byte[]](0x5B, 0x11, 0x10, 0x42)
try {
    foreach ($shortcutKey in $shortcutKeys) {
        [WorkstationGraphicsShortcut]::keybd_event($shortcutKey, 0, 0, [UIntPtr]::Zero)
    }
} finally {
    for ($shortcutIndex = $shortcutKeys.Length - 1; $shortcutIndex -ge 0; $shortcutIndex--) {
        [WorkstationGraphicsShortcut]::keybd_event($shortcutKeys[$shortcutIndex], 0, 2, [UIntPtr]::Zero)
    }
}
