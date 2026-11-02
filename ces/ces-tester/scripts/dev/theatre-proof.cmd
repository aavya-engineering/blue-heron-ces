@echo off
REM Operator proof run — build, unit-test, --check every deck, then run the
REM mini decks headed while scripts\dev\grab-mirror.mjs records what the app
REM pane streams. Double-click from File Explorer or run from any shell.
REM Everything lands in runs\theatre-proof\ (build/test/check logs, then one
REM folder per deck with demo.log, state.log and frame-*.jpg).
setlocal EnableDelayedExpansion
cd /d "%~dp0..\.."
if exist runs\theatre-proof rmdir /s /q runs\theatre-proof
mkdir runs\theatre-proof
echo [%time%] build > runs\theatre-proof\status.txt
call npm run build > runs\theatre-proof\build.log 2>&1
echo build exit %errorlevel% >> runs\theatre-proof\status.txt
echo [%time%] test >> runs\theatre-proof\status.txt
call npx vitest run > runs\theatre-proof\test.log 2>&1
echo test exit %errorlevel% >> runs\theatre-proof\status.txt
echo [%time%] check >> runs\theatre-proof\status.txt
for %%D in (demos\*.xlsx) do (
  call node bin\ces-tester.mjs demo:show --check "%%D" >> runs\theatre-proof\check.log 2>&1
  echo check %%~nD exit !errorlevel! >> runs\theatre-proof\status.txt
)
for %%D in (mini-sim-muster mini-muster-gui) do call :run %%D
echo [%time%] done >> runs\theatre-proof\status.txt
endlocal
goto :eof

:run
echo [%time%] demo %1 >> runs\theatre-proof\status.txt
mkdir runs\theatre-proof\%1
start "ces-theatre-demo" /min cmd /c "node bin\ces-tester.mjs demo:show demos\%1.xlsx > runs\theatre-proof\%1\demo.log 2>&1"
node scripts\dev\grab-mirror.mjs runs\theatre-proof\%1 600 > runs\theatre-proof\%1\grab.log 2>&1
echo demo %1 grab exit %errorlevel% >> runs\theatre-proof\status.txt
REM let the show's teardown release the ports before the next deck arms
timeout /t 8 /nobreak > nul
goto :eof
