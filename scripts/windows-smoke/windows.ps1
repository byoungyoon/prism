# Logs every window that newly becomes visible (checked every ~15 ms), so a console window that
# only blinks is still seen. Run in the background; stop by killing the process.
param([string]$Out)
Add-Type @"
using System; using System.Collections.Generic; using System.IO; using System.Runtime.InteropServices; using System.Text; using System.Threading; using System.Diagnostics;
public static class WinWatch {
  delegate bool Cb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Cb cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rr, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  public static void Run(string file) {
    var seen = new HashSet<IntPtr>(); bool first = true;
    while (true) {
      var now = new HashSet<IntPtr>();
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h)) return true;
        now.Add(h);
        if (seen.Contains(h)) return true;
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        var t = new StringBuilder(256); GetWindowText(h, t, 256);
        uint pid; GetWindowThreadProcessId(h, out pid); string name = "?";
        try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}
        R r; GetWindowRect(h, out r);
        File.AppendAllText(file, String.Format("{0:HH:mm:ss.fff}\t{1}\t{2}\t{3}\t{4}\t{5}x{6}\t{7}\n", DateTime.Now, first ? "base" : "new", c, name, pid, r.Rr - r.L, r.B - r.T, t));
        return true;
      }, IntPtr.Zero);
      seen = now; first = false; Thread.Sleep(15);
    }
  }
}
"@
[WinWatch]::Run($Out)
