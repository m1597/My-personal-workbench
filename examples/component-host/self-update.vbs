Option Explicit
Dim shell, environment, command
Set shell = CreateObject("WScript.Shell")
Set environment = shell.Environment("Process")
command = Chr(34) & environment("SystemRoot") & "\System32\WindowsPowerShell\v1.0\powershell.exe" & Chr(34)
command = command & " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & WScript.Arguments(0) & Chr(34)
WScript.Quit shell.Run(command, 0, True)