"""Launch a fixture on an unselected Win32 desktop; the fixture only queries its own controls."""
import os
import subprocess
import sys
import uuid
import win32api
import win32con
import win32event
import win32process
import win32service

name='FitBayTest'+uuid.uuid4().hex
desktop=win32service.CreateDesktop(name,0,win32con.GENERIC_ALL,None)
startup=win32process.STARTUPINFO()
startup.lpDesktop='WinSta0'+chr(92)+name
startup.dwFlags=win32con.STARTF_USESTDHANDLES
startup.hStdOutput=win32api.GetStdHandle(-11)
startup.hStdError=win32api.GetStdHandle(-12)
startup.hStdInput=win32api.GetStdHandle(-10)
proc,thread,_,_=win32process.CreateProcess(None,subprocess.list2cmdline(sys.argv[1:]),None,None,True,win32con.CREATE_NO_WINDOW,dict(os.environ,FITBAY_TEST_DESKTOP=name),os.getcwd(),startup)
if win32event.WaitForSingleObject(proc,60000) != win32con.WAIT_OBJECT_0:
    win32process.TerminateProcess(proc,2)
    raise SystemExit('Private desktop fixture timed out')
raise SystemExit(win32process.GetExitCodeProcess(proc))
