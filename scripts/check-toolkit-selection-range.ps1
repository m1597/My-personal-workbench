param([string]$Marker,[long]$BrowserWindow,[string]$Expected)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,UIAutomationClient,UIAutomationTypes
. (Join-Path $PSScriptRoot '../components/toolkit/selection-range.ps1')
if(!$env:FITBAY_TEST_DESKTOP){throw 'Run on the private test desktop'}
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TestDesk {
    [DllImport("kernel32")] public static extern uint GetCurrentThreadId();
    [DllImport("user32")] public static extern IntPtr GetThreadDesktop(uint tid);
    [DllImport("user32",CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr d,int i,StringBuilder s,int len,out int needed);
}
"@
    $buf=[Text.StringBuilder]::new(256)
    [int]$needed=0
    $ok=[TestDesk]::GetUserObjectInformation([TestDesk]::GetThreadDesktop([TestDesk]::GetCurrentThreadId()),2,$buf,512,[ref]$needed)
    if(!$ok -or $buf.ToString() -ne $env:FITBAY_TEST_DESKTOP){throw 'Desktop mismatch'}


if($BrowserWindow){
    $uia=[FitBaySelection]::new()
    $window=$uia.Call('IUIAutomation',$uia.Automation,'ElementFromHandle',@([IntPtr]::new($BrowserWindow)))
    $condition=$uia.Call('IUIAutomation',$uia.Automation,'CreatePropertyCondition',@(30003,50030))
    $documents=$uia.Call('IUIAutomationElement',$window,'FindAll',@(4,$condition))
    $count=$uia.Call('IUIAutomationElementArray',$documents,'get_Length',@())
    for($i=0;$i -lt $count;$i++){
        $doc=$uia.Call('IUIAutomationElementArray',$documents,'GetElement',@($i))
        $state=''
        if(([string]$uia.Read($doc,$BrowserWindow,[ref]$state)).Trim() -ceq $Expected){Write-Output 'PASS browser selected sentence';exit 0}
    }
    throw ('No matching document selection from '+$count+' document elements')
}
if($Marker){
    Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
    $window=[Windows.Window]::new()
    $editor=[Windows.Controls.TextBox]::new()
    $editor.Text='Prefix with unrelated words. Exact middle sentence. Suffix must stay private.'
    $window.Content=$editor
    $window.Add_ContentRendered({
        $null=$editor.Focus()
        $editor.Select($editor.Text.IndexOf('Exact middle sentence.'),22)
        $hwnd=([Windows.Interop.WindowInteropHelper]::new($window)).Handle
        [IO.File]::WriteAllText($Marker,$hwnd.ToInt64().ToString())
    })
    $timer=[Windows.Threading.DispatcherTimer]::new()
    $timer.Interval=[TimeSpan]::FromMilliseconds(30)
    $timer.Add_Tick({
        if(Test-Path -LiteralPath ($Marker+'.copy')){
            Remove-Item -LiteralPath ($Marker+'.copy')
            [Windows.Input.ApplicationCommands]::Copy.Execute($null,$editor)
        }
    })
    $timer.Start()
    $null=$window.ShowDialog()
    $timer.Stop()
    exit 0
}
$ready=Join-Path $env:TEMP ('fitbay-range-'+[guid]::NewGuid()+'.txt')
$args='-NoProfile -STA -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Marker "'+$ready+'"'
$proc=Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden -PassThru
try{
    for($i=0;$i -lt 120 -and !(Test-Path -LiteralPath $ready);$i++){Start-Sleep -Milliseconds 50}
    $target=[IntPtr]::new([long][IO.File]::ReadAllText($ready))
    $uia=[FitBaySelection]::new()
    $window=$uia.Call('IUIAutomation',$uia.Automation,'ElementFromHandle',@($target))
    $condition=$uia.Call('IUIAutomation',$uia.Automation,'CreatePropertyCondition',@(30003,50004))
    $editor=$uia.Call('IUIAutomationElement',$window,'FindFirst',@(4,$condition))
    $state=''
    $selected=$uia.Read($editor,$target.ToInt64(),[ref]$state)
    if($selected -cne 'Exact middle sentence.'){throw ('Range: '+$state)}
    Write-Output 'PASS real WPF editor selected middle sentence only'
    if($env:FITBAY_CLIPBOARD_FIXTURE -eq '1'){
        . (Join-Path $PSScriptRoot '../components/toolkit/selection-copy.ps1')
        $old='Prior clipboard is deliberately unrelated.'
        [System.Windows.Forms.Clipboard]::SetText($old)
        $value=Read-FitBayClipboardSelection $target.ToInt64() {$true} { [IO.File]::WriteAllText($ready+'.copy','') }
        if ($value -cne 'Exact middle sentence.' -or [System.Windows.Forms.Clipboard]::GetText() -cne $old){throw 'Copy or restoration mismatch'}
        $empty=Read-FitBayClipboardSelection $target.ToInt64() {$true} {}
        if($empty -or [System.Windows.Forms.Clipboard]::GetText() -cne $old){throw 'Stale clipboard was used'}
        Write-Output 'PASS fresh copied middle sentence, prior clipboard restoration and no-copy rejection'
    }
}finally{
    if(!$proc.HasExited){$proc.Kill();$proc.WaitForExit()}
    if(Test-Path -LiteralPath $ready){Remove-Item -LiteralPath $ready}
}
