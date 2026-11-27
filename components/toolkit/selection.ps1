param([long]$TargetWindow)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'selection-copy.ps1')
function Has-Focus { [SelectionWindow]::GetForegroundWindow().ToInt64() -eq $TargetWindow }
# Only selected ranges of the focused control inside the captured top-level window.
if ($TargetWindow -le 0 -or !(Has-Focus)) { exit 0 }
try {
    . (Join-Path $PSScriptRoot 'selection-range.ps1')
    $uia=[FitBaySelection]::new()
    $state=''
    $text=$uia.Read($uia.Focused(),$TargetWindow,[ref]$state)
    if ($state -eq 'selected') {
        if (Has-Focus) { [Console]::Write($text) }
        exit 0
    }
    if ($state -in 'caret','private','tooLong') { exit 0 }
} catch { }

function Modifier-Held { foreach($key in 16,17,18,91,92){ if([SelectionWindow]::GetAsyncKeyState($key) -lt 0){return $true} };return $false }
# Wait for the invoking chord to release before sending ordinary Copy.
for ($i=0; $i -lt 25 -and (Modifier-Held); $i++) {
    Start-Sleep -Milliseconds 20
}
if (!(Has-Focus) -or (Modifier-Held)) { exit 0 }
$selection = Read-FitBayClipboardSelection $TargetWindow {Has-Focus} { [System.Windows.Forms.SendKeys]::SendWait('^c') }
if (![string]::IsNullOrWhiteSpace($selection)) { [Console]::Write($selection) }
