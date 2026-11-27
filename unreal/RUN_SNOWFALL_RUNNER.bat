@echo off
rem Starts the Snowfall job runner minimized. Close its window (taskbar) to stop.
start "Snowfall runner" /min powershell.exe -NoExit -ExecutionPolicy Bypass -File "%~dp0Tools\sf_runner.ps1"
