param([Parameter(Mandatory=$true)][string]$RequestBase64)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
  if ($request.action -eq 'launch') {
    switch ($request.target) {
      'task-manager' { Start-Process -FilePath "$env:SystemRoot\System32\Taskmgr.exe" }
      'settings' { Start-Process 'ms-settings:' }
      'settings-system' { Start-Process 'ms-settings:display' }
      'settings-sound' { Start-Process 'ms-settings:sound' }
      'phone-link' { Start-Process 'ms-settings:mobile-devices-addphone-direct' }
      'codex' {
        $apps = @(Get-StartApps | Where-Object { $_.Name -eq 'Codex' })
        if ($apps.Count -ne 1) { throw 'Select the Codex program or shortcut with Browse for program; a unique installed Codex app was not found.' }
        Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList ('shell:AppsFolder\' + $apps[0].AppID)
      }
      default { throw 'Unknown application.' }
    }
    @{ok=$true} | ConvertTo-Json -Compress
    exit
  }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FunctionPointer {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
}
'@
  [void][FunctionPointer]::SetProcessDPIAware()
  $root = [Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
  $records = @()
  foreach ($window in $windows) {
    try {
      $current = $window.Current
      if ($current.NativeWindowHandle -eq 0 -or -not $current.Name) { continue }
      $process = Get-Process -Id $current.ProcessId -ErrorAction Stop
      $records += [pscustomobject]@{process=$process.ProcessName;title=$current.Name;handle=$current.NativeWindowHandle; element=$window}
    } catch { }
  }
  if ($request.action -eq 'windows') {
    @{windows=@($records | Select-Object process,title)} | ConvertTo-Json -Compress -Depth 6
    exit
  }
  if ($request.action -eq 'pick-pointer') {
    Start-Sleep -Seconds 5
    $point = New-Object FunctionPointer+Point
    [void][FunctionPointer]::GetCursorPos([ref]$point)
    $handle = [FunctionPointer]::GetAncestor([FunctionPointer]::WindowFromPoint($point), 2)
    $pointed = @($records | Where-Object { [IntPtr]$_.handle -eq $handle })
    if ($pointed.Count -ne 1) { throw 'Point inside an existing application window. No matching window was found.' }
    $bounds = $pointed[0].element.Current.BoundingRectangle
    $x = $point.X - [int]$bounds.Left; $y = $point.Y - [int]$bounds.Top
    if ($x -lt 0 -or $y -lt 0 -or $x -ge [int]$bounds.Width -or $y -ge [int]$bounds.Height) { throw 'The pointer was outside the window.' }
    @{window=@{process=$pointed[0].process;title=$pointed[0].title};point=@{x=$x;y=$y;width=[int]$bounds.Width;height=[int]$bounds.Height}} | ConvertTo-Json -Compress -Depth 6
    exit
  }
  $matches = @($records | Where-Object { $_.process -ceq $request.window.process -and ((-not $request.window.title) -or $_.title -ceq $request.window.title) })
  if ($matches.Count -ne 1) { throw "Expected one matching window; found $($matches.Count). Refresh the window picker or use an exact title." }
  $record = $matches[0]
  if ($request.action -eq 'pointer-paste' -or $request.action -eq 'pointer-click') {
    $handle = [IntPtr]$record.handle
    [void][FunctionPointer]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 300
    if ([FunctionPointer]::GetForegroundWindow() -ne $handle) { throw 'Bring the selected application forward and try again.' }
    $bounds = $record.element.Current.BoundingRectangle
    if ([int]$bounds.Width -ne $request.point.width -or [int]$bounds.Height -ne $request.point.height) { throw 'The window size changed. Point at the target again before running.' }
    $x = [int]$bounds.Left + $request.point.x; $y = [int]$bounds.Top + $request.point.y
    $point = New-Object FunctionPointer+Point
    $point.X = $x; $point.Y = $y
    if ([FunctionPointer]::GetAncestor([FunctionPointer]::WindowFromPoint($point), 2) -ne $handle) { throw 'Another window covers the pointed target. Clear overlays and try again.' }
    [void][FunctionPointer]::SetCursorPos($x, $y)
    [FunctionPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [FunctionPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    if ($request.action -eq 'pointer-paste') {
      Start-Sleep -Milliseconds 150
      if ([FunctionPointer]::GetForegroundWindow() -ne $handle) { throw 'Focus changed after pointing. Paste was not sent.' }
      Add-Type -AssemblyName System.Windows.Forms
      $previous = [Windows.Forms.Clipboard]::GetDataObject()
      $clipboardSequence = $null
      try {
        [Windows.Forms.Clipboard]::SetText([string]$request.text)
        $clipboardSequence = [FunctionPointer]::GetClipboardSequenceNumber()
        if ([FunctionPointer]::GetForegroundWindow() -ne $handle) { throw 'Focus changed before paste. Paste was not sent.' }
        [Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 250
      } finally {
        if ($null -ne $clipboardSequence -and [FunctionPointer]::GetClipboardSequenceNumber() -eq $clipboardSequence) {
          if ($null -ne $previous) { [Windows.Forms.Clipboard]::SetDataObject($previous, $true) } else { [Windows.Forms.Clipboard]::Clear() }
        }
      }
    }
    @{ok=$true;detail='Pointer action delivered. Application acceptance is not verified; review the target application.'} | ConvertTo-Json -Compress
    exit
  }
  if ($request.action -eq 'capture') {
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FunctionWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
    [void][FunctionWindow]::SetProcessDPIAware()
    $handle = [IntPtr]$record.handle
    if ([FunctionWindow]::IsIconic($handle)) { [void][FunctionWindow]::ShowWindow($handle, 9) }
    [void][FunctionWindow]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 400
    if ([FunctionWindow]::GetForegroundWindow() -ne $handle) { throw 'Could not bring the selected window to the foreground. Bring it forward and try again.' }
    $bounds = $record.element.Current.BoundingRectangle
    $screen = [System.Drawing.Rectangle]::FromLTRB([int]$bounds.Left,[int]$bounds.Top,[int]$bounds.Right,[int]$bounds.Bottom)
    if ($screen.Width -le 0 -or $screen.Height -le 0 -or ([long]$screen.Width * $screen.Height) -gt 16000000) { throw 'Invalid or oversized window bounds.' }
    $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $memory = New-Object IO.MemoryStream
    try {
      $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
      if ([FunctionWindow]::GetForegroundWindow() -ne $handle) { throw 'Focus changed during capture. Try again.' }
      $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
      @{image=('data:image/png;base64,' + [Convert]::ToBase64String($memory.ToArray()));width=$screen.Width;height=$screen.Height} | ConvertTo-Json -Compress
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $memory.Dispose() }
    exit
  }
  $elements = $record.element.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  if ($elements.Count -gt 10000) { throw 'This window exposes too many controls. Open a smaller view and try again.' }
  $controls = @()
  $inspectionErrors = @()
  $offscreen = 0
  $samples = @()
  foreach ($element in $elements) {
    try {
      $current = $element.Current
      if ($request.diagnostics -and $samples.Count -lt 10) { $samples += @{name=$current.Name;type=$current.ControlType.ProgrammaticName;patterns=@($element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })} }
      if ($current.IsPassword -or $current.IsOffscreen) { $offscreen++; continue }
      $value = $null; $invoke = $null
      $canSet = $element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$value) -and -not $value.Current.IsReadOnly
      $canInvoke = $element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)
      if (($canSet -or $canInvoke) -and ($current.Name -or $current.AutomationId)) {
        $controls += [pscustomobject]@{name=$current.Name;automationId=$current.AutomationId;controlType=$current.ControlType.ProgrammaticName;canSet=$canSet;canInvoke=$canInvoke;enabled=$current.IsEnabled;element=$element}
      }
    } catch { if ($inspectionErrors.Count -lt 3) { $inspectionErrors += $_.Exception.Message } }
  }
  if ($request.action -eq 'controls') {
    @{controls=@($controls | Select-Object name,automationId,controlType,canSet,canInvoke,enabled);warnings=$inspectionErrors;total=$elements.Count;hidden=$offscreen;samples=$samples} | ConvertTo-Json -Compress -Depth 6
    exit
  }
  $selected = @($controls | Where-Object { $_.name -ceq $request.control.name -and $_.automationId -ceq $request.control.automationId -and $_.controlType -ceq $request.control.controlType })
  if ($selected.Count -ne 1) { throw "Expected one matching control; found $($selected.Count). Choose a unique accessible control." }
  if (-not $selected[0].enabled) { throw 'The selected control is disabled. The function stopped before interacting with it.' }
  if ($request.action -eq 'set') {
    if (-not $selected[0].canSet) { throw 'This control cannot accept text through Windows accessibility. Use Copy result and paste manually.' }
    $pattern = $selected[0].element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    if ($pattern.Current.Value) { throw 'The selected text field contains a draft. Clear it before running this function.' }
    $pattern.SetValue([string]$request.text)
    if ($pattern.Current.Value -cne $request.text) { throw 'The application did not accept the complete text. Review the field before sending.' }
  } elseif ($request.action -eq 'invoke') {
    if (-not $selected[0].canInvoke) { throw 'This control cannot be pressed through Windows accessibility.' }
    $selected[0].element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  } else { throw 'Unknown automation action.' }
  @{ok=$true} | ConvertTo-Json -Compress
} catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress }
