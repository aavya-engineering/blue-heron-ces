# conpty-run.ps1 (Blue Heron Defense, CES team; FIN-29 E8T, check V116): run one command inside a Windows pseudo-console
# (ConPTY, CreatePseudoConsole, Windows 10 1809+) so the child sees a real terminal (process.stdin.isTTY is true), while
# this script relays its own piped stdin into the console and the console's output (VT text) to its stdout. The harness
# (ces-tester src/flow/fin29-stamper.ts) drives the Stamper CLI through it like a person at a terminal: it waits for a
# prompt in the output and writes the answer. Simulator runs only; nothing is installed (Add-Type compiles the host).
#   powershell -NoProfile -ExecutionPolicy Bypass -File conpty-run.ps1 [-CommandLine '<command line>'] [-Cwd <dir>]
# Without -CommandLine the command line comes from $env:CES_CONPTY_CMDLINE (the harness's way: no quoted command line
# on this script's argv). The child inherits this process's environment. Exit code = the child's exit code (or 255 when the console fails).
param(
  [string]$CommandLine = $env:CES_CONPTY_CMDLINE,
  [string]$Cwd = (Get-Location).Path,
  [int]$Cols = 160,
  [int]$Rows = 50
)
$ErrorActionPreference = 'Stop'
if (-not $CommandLine) { [Console]::Error.WriteLine('conpty-run: no command line (-CommandLine or CES_CONPTY_CMDLINE)'); exit 255 }
$src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public static class CesConPty {
  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars;
    public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);
  [DllImport("kernel32.dll", SetLastError = true)] static extern void ClosePseudoConsole(IntPtr hPC);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);
  [DllImport("kernel32.dll", SetLastError = true)] static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr hObject);
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  static readonly IntPtr PSEUDOCONSOLE = (IntPtr)0x00020016;

  public static int Run(string commandLine, string cwd, short cols, short rows) {
    SafeFileHandle inRead, inWrite, outRead, outWrite;
    if (!CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0)) return 255;
    if (!CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0)) return 255;
    IntPtr hPC;
    COORD size; size.X = cols; size.Y = rows;
    if (CreatePseudoConsole(size, inRead, outWrite, 0, out hPC) != 0) return 255;
    inRead.Dispose(); outWrite.Dispose();
    IntPtr attrSize = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
    IntPtr attrs = Marshal.AllocHGlobal(attrSize);
    if (!InitializeProcThreadAttributeList(attrs, 1, 0, ref attrSize)) return 255;
    if (!UpdateProcThreadAttribute(attrs, 0, PSEUDOCONSOLE, hPC, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) return 255;
    STARTUPINFOEX si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
    si.lpAttributeList = attrs;
    si.StartupInfo.dwFlags = 0x00000100; // STARTF_USESTDHANDLES with null handles: the child uses the pseudo-console, not this process's redirected stdio
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(null, commandLine, IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref si, out pi)) {
      Console.Error.WriteLine("conpty-run: CreateProcess failed: " + Marshal.GetLastWin32Error());
      return 255;
    }
    Stream stdout = Console.OpenStandardOutput();
    Stream stdin = Console.OpenStandardInput();
    FileStream ptyOut = new FileStream(outRead, FileAccess.Read);
    FileStream ptyIn = new FileStream(inWrite, FileAccess.Write);
    Thread reader = new Thread(() => {
      byte[] buf = new byte[4096]; int n;
      try { while ((n = ptyOut.Read(buf, 0, buf.Length)) > 0) { stdout.Write(buf, 0, n); stdout.Flush(); } } catch { }
    });
    reader.IsBackground = true; reader.Start();
    Thread writer = new Thread(() => {
      byte[] buf = new byte[1024]; int n;
      try { while ((n = stdin.Read(buf, 0, buf.Length)) > 0) { ptyIn.Write(buf, 0, n); ptyIn.Flush(); } } catch { }
    });
    writer.IsBackground = true; writer.Start();
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    Thread.Sleep(300);
    ClosePseudoConsole(hPC);
    reader.Join(2000);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs);
    return (int)code;
  }
}
'@
# PH-5 (V116): module-qualified, because the simulator's PSModulePath (the Stamper env) puts first a fake
# Microsoft.Graph.Authentication that exports an Add-Type function, which shadows the cmdlet and compiles nothing.
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $src -Language CSharp
exit [CesConPty]::Run($CommandLine, $Cwd, [int16]$Cols, [int16]$Rows)
