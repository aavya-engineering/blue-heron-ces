@echo off
rem G-STACKSIM-2 iteration 4: fake `az` CLI entry point. Only reachable when
rem azshim\ is prepended to PATH in a shadowed coverage-harness session
rem (src/coverage/psHarness.ts's buildShadowedEnv) - the real Azure CLI stays
rem installed elsewhere on PATH, just never reached first in that session.
rem Forwards straight through to az-shim.ps1 (all real parsing/routing lives
rem there); never silently succeeds on its own.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0az-shim.ps1" %*
exit /b %ERRORLEVEL%
