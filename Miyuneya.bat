@echo off
setlocal
chcp 65001 >nul
title Miyuneya
pushd "%~dp0" || goto path_error
if exist ".runtime\node\node.exe" (
  set "MIYUNEYA_NODE=%CD%\.runtime\node\node.exe"
) else (
  where node.exe >nul 2>nul
  if errorlevel 1 goto no_node
  set "MIYUNEYA_NODE=node.exe"
)
"%MIYUNEYA_NODE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 goto old_node
"%MIYUNEYA_NODE%" scripts\start.mjs --open
if errorlevel 1 (
  echo.
  echo Не удалось запустить Miyuneya. Подробности ошибки указаны выше.
  pause
)
popd
exit /b
:no_node
echo Для запуска нужен Node.js 22.18 или новее.
echo Установите LTS с https://nodejs.org/ или распакуйте официальный Windows ZIP
echo в .runtime\node, чтобы внутри появился node.exe. Права администратора не нужны.
echo Затем снова откройте Miyuneya.bat.
pause
popd
exit /b 1
:old_node
echo Найден устаревший Node.js. Нужна версия 22.18 или новее.
echo Обновите Node.js или положите portable-версию в .runtime\node.
pause
popd
exit /b 1
:path_error
echo Не удалось открыть папку проекта. Распакуйте ZIP и повторите запуск.
pause
exit /b 1
