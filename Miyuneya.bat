@echo off
setlocal DisableDelayedExpansion
title Miyuneya
if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" goto no_powershell
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
set "MIYUNEYA_EXIT=%ERRORLEVEL%"
if "%MIYUNEYA_EXIT%"=="0" exit /b 0
echo.
echo Miyuneya failed. Exit code: %MIYUNEYA_EXIT%
echo See .runtime\logs in the project folder.
if not "%MIYUNEYA_NO_PAUSE%"=="1" pause
exit /b %MIYUNEYA_EXIT%
:no_powershell
echo Windows PowerShell 5.1 was not found. Repair Windows PowerShell.
if not "%MIYUNEYA_NO_PAUSE%"=="1" pause
exit /b 10
