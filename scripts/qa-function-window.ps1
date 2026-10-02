param([string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
$form = New-Object Windows.Window
$form.Title = 'LAW Function QA ' + (Split-Path $FixtureDirectory -Leaf)
$form.Width = 700; $form.Height = 360
$form.ShowInTaskbar = $false
$panel = New-Object Windows.Controls.Canvas
$field = New-Object Windows.Controls.TextBox
[Windows.Controls.Canvas]::SetLeft($field, 30); [Windows.Controls.Canvas]::SetTop($field, 45)
$field.Width = 500; $field.Height = 30
[Windows.Automation.AutomationProperties]::SetName($field, 'QA request field')
$button = New-Object Windows.Controls.Button
[Windows.Controls.Canvas]::SetLeft($button, 30); [Windows.Controls.Canvas]::SetTop($button, 100)
$button.Width = 150; $button.Height = 30; $button.Content = 'Record QA request'
[Windows.Automation.AutomationProperties]::SetName($button, 'Record QA request')
$button.Add_Click({ [IO.File]::WriteAllText((Join-Path $FixtureDirectory 'received.txt'), $field.Text) })
[void]$panel.Children.Add($field); [void]$panel.Children.Add($button)
$form.Content = $panel
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(200)
$deadline = (Get-Date).AddSeconds(60)
$timer.Add_Tick({ if ((Test-Path (Join-Path $FixtureDirectory 'close.flag')) -or (Get-Date) -gt $deadline) { $form.Close() } })
$form.Add_ContentRendered({ $timer.Start(); [IO.File]::WriteAllText((Join-Path $FixtureDirectory 'ready.flag'), 'ready') })
try { [void]$form.ShowDialog() } finally { $timer.Stop() }
