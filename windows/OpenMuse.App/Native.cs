using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace OpenMuse;

// The few Win32 and DWM calls the windows need.
public static class Native
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT point, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFO
    {
        public int Size;
        public RECT Monitor;
        public RECT Work;
        public uint Flags;
    }

    private const int ImmersiveDarkMode = 20;
    private const uint NoMoveSizeZorderActivate = 0x0001 | 0x0002 | 0x0004 | 0x0010, FrameChanged = 0x0020;

    public static IntPtr Handle(Window window) => new WindowInteropHelper(window).Handle;

    public static void DarkTitleBar(Window window, bool dark)
    {
        var handle = Handle(window);
        if (handle == IntPtr.Zero) return;
        var value = dark ? 1 : 0;
        DwmSetWindowAttribute(handle, ImmersiveDarkMode, ref value, sizeof(int));
        // An inactive window repaints its title bar only once its frame changes.
        SetWindowPos(handle, IntPtr.Zero, 0, 0, 0, 0, NoMoveSizeZorderActivate | FrameChanged);
    }

    public static void ForceForeground(Window window)
    {
        var handle = Handle(window);
        if (handle != IntPtr.Zero) SetForegroundWindow(handle);
    }

    // The work area of the monitor under the pointer, in the window's units.
    public static Rect WorkAreaUnderCursor(Window window)
    {
        GetCursorPos(out var point);
        var monitor = MonitorFromPoint(point, 2);
        var info = new MONITORINFO { Size = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref info)) return SystemParameters.WorkArea;
        var handle = Handle(window);
        var scale = handle == IntPtr.Zero ? 1.0 : GetDpiForWindow(handle) / 96.0;
        if (scale <= 0) scale = 1;
        return new Rect(info.Work.Left / scale, info.Work.Top / scale,
            (info.Work.Right - info.Work.Left) / scale, (info.Work.Bottom - info.Work.Top) / scale);
    }

    public static POINT Cursor()
    {
        GetCursorPos(out var point);
        return point;
    }
}
