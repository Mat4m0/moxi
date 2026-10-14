# PB9: real OS-level key presses on a Windows runner. Reads one JSON request per line on
# stdin, answers with one line that starts with "@@". Scan codes are sent with
# KEYEVENTF_SCANCODE so that Chromium derives the physical `code` from the scan code.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Native {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public MOUSEINPUT mi;
    [FieldOffset(8)] public KEYBDINPUT ki;
  }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder text, int max);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public static void ClickCentre(IntPtr h) {
    RECT r;
    GetWindowRect(h, out r);
    SetCursorPos((r.Left + r.Right) / 2, (r.Top + r.Bottom) / 2);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  public static string Title(IntPtr h) {
    System.Text.StringBuilder sb = new System.Text.StringBuilder(256);
    GetWindowText(h, sb, 256);
    return sb.ToString();
  }
  public static uint Key(ushort scan, bool up, bool ext) {
    INPUT[] a = new INPUT[1];
    a[0].type = 1;
    a[0].ki.wVk = 0;
    a[0].ki.wScan = scan;
    a[0].ki.dwFlags = 0x0008u | (up ? 0x0002u : 0u) | (ext ? 0x0001u : 0u);
    return SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }
}
'@

function Reply($obj) {
  [Console]::Out.WriteLine('@@' + ($obj | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

Reply @{ ready = $true; inputSize = [Native]::InputSize(); is64 = [Environment]::Is64BitProcess }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $req = $line | ConvertFrom-Json
    if ($req.cmd -eq 'focus') {
      $h = [Native]::FindWindow($null, [string]$req.title)
      if ($h -eq [IntPtr]::Zero) {
        Reply @{ ok = $false; error = 'window not found' }
      } else {
        [void][Native]::ShowWindow($h, 9)
        $fg = [Native]::GetForegroundWindow()
        $fgPid = [uint32]0
        $fgThread = [Native]::GetWindowThreadProcessId($fg, [ref]$fgPid)
        $cur = [Native]::GetCurrentThreadId()
        [void][Native]::AttachThreadInput($cur, $fgThread, $true)
        $returned = [Native]::SetForegroundWindow($h)
        [void][Native]::AttachThreadInput($cur, $fgThread, $false)
        $now = [Native]::GetForegroundWindow()
        $switched = $false
        if ($now -ne $h) {
          [Native]::SwitchToThisWindow($h, $true)
          Start-Sleep -Milliseconds 300
          $now = [Native]::GetForegroundWindow()
          $switched = $true
        }
        $clicked = $false
        if ($now -ne $h) {
          [Native]::ClickCentre($h)
          Start-Sleep -Milliseconds 300
          $now = [Native]::GetForegroundWindow()
          $clicked = $true
        }
        Reply @{ ok = $true; foreground = ($now -eq $h); setForegroundReturned = $returned; usedSwitchToThisWindow = $switched; usedClick = $clicked; hadForeground = ($fg -ne [IntPtr]::Zero); foregroundTitle = [Native]::Title($now) }
      }
    } elseif ($req.cmd -eq 'keys') {
      $sent = 0
      $failed = 0
      $lastError = 0
      foreach ($s in $req.steps) {
        $r = [Native]::Key([uint16]$s.scan, [bool]($s.op -eq 'up'), [bool]$s.ext)
        if ($r -eq 1) { $sent++ } else { $failed++; $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
        Start-Sleep -Milliseconds ([int]$req.gap)
      }
      Reply @{ ok = ($failed -eq 0); sent = $sent; failed = $failed; lastError = $lastError }
    } else {
      Reply @{ ok = $false; error = 'unknown cmd' }
    }
  } catch {
    Reply @{ ok = $false; error = $_.ToString() }
  }
}
