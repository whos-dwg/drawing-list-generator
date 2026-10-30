@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%~dp0app\workers\diagnose-autocad.ps1' -ErrorAction SilentlyContinue; & '%~dp0app\workers\diagnose-autocad.ps1'"
