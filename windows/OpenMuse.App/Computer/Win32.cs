using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

namespace OpenMuse.Computer;

// Input, windows and power calls for computer use. The process is per-monitor
// DPI aware, so every coordinate here is in physical pixels.
public static class Win32
{
    public const uint EsContinuous = 0x80000000, EsSystemRequired = 0x1, EsDisplayRequired = 0x2;
    public const uint MouseLeftDown = 0x2, MouseLeftUp = 0x4, MouseRightDown = 0x8, MouseRightUp = 0x10;
    private const uint MouseWheel = 0x800;
    private const uint KeyUp = 0x2, KeyUnicode = 0x4;
    private const int InputMouse = 0, InputKeyboard = 1;

    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hwnd);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int X; public int Y; public uint Data; public uint Flags; public uint Time; public IntPtr Extra; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort Key; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT Mouse;
        [FieldOffset(0)] public KEYBDINPUT Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public int Type; public InputUnion Data; }

    public static Rectangle PrimaryScreen() => new(0, 0, GetSystemMetrics(0), GetSystemMetrics(1));

    // Visible top-level app windows, front to back, with their bounds.
    public static List<(IntPtr Window, Rectangle Bounds)> VisibleWindows()
    {
        var found = new List<(IntPtr, Rectangle)>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
            if (DwmGetWindowAttribute(hwnd, 14, out int cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
            var style = GetWindowLongPtr(hwnd, -20).ToInt64();
            const long ToolWindow = 0x80, AppWindow = 0x40000;
            var owner = GetWindow(hwnd, 4);
            if ((style & ToolWindow) != 0 && (style & AppWindow) == 0) return true;
            if (owner != IntPtr.Zero && (style & AppWindow) == 0) return true;
            if (GetWindowTextLength(hwnd) == 0) return true;
            if (DwmGetWindowAttribute(hwnd, 9, out RECT rect, Marshal.SizeOf<RECT>()) != 0) return true;
            if (rect.Right - rect.Left <= 1 || rect.Bottom - rect.Top <= 1) return true;
            found.Add((hwnd, Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom)));
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static string Title(IntPtr hwnd)
    {
        var length = GetWindowTextLength(hwnd);
        if (length == 0) return "";
        var text = new StringBuilder(length + 1);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }

    public static void MoveTo(Point point) => SetCursorPos(point.X, point.Y);

    private static void Send(params INPUT[] inputs) => SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());

    public static void Mouse(uint flags) =>
        Send(new INPUT { Type = InputMouse, Data = new InputUnion { Mouse = new MOUSEINPUT { Flags = flags } } });

    public static void Wheel(int delta) =>
        Send(new INPUT { Type = InputMouse, Data = new InputUnion { Mouse = new MOUSEINPUT { Flags = MouseWheel, Data = unchecked((uint)delta) } } });

    public static void TypeUnicode(string text)
    {
        var inputs = new List<INPUT>();
        foreach (var unit in text)
        {
            inputs.Add(new INPUT { Type = InputKeyboard, Data = new InputUnion { Keyboard = new KEYBDINPUT { Scan = unit, Flags = KeyUnicode } } });
            inputs.Add(new INPUT { Type = InputKeyboard, Data = new InputUnion { Keyboard = new KEYBDINPUT { Scan = unit, Flags = KeyUnicode | KeyUp } } });
        }
        Send(inputs.ToArray());
    }

    private static INPUT Key(ushort key, bool up) =>
        new() { Type = InputKeyboard, Data = new InputUnion { Keyboard = new KEYBDINPUT { Key = key, Flags = up ? KeyUp : 0 } } };

    // Presses the modifiers, the key, and releases all of them, so no
    // modifier stays held for the person's next click.
    public static void Press(ushort key, ushort[] modifiers)
    {
        var inputs = new List<INPUT>();
        foreach (var modifier in modifiers) inputs.Add(Key(modifier, false));
        inputs.Add(Key(key, false));
        inputs.Add(Key(key, true));
        for (var i = modifiers.Length - 1; i >= 0; i--) inputs.Add(Key(modifiers[i], true));
        Send(inputs.ToArray());
    }

    private static readonly Dictionary<string, ushort> Named = new()
    {
        ["enter"] = 0x0D, ["return"] = 0x0D, ["tab"] = 0x09, ["space"] = 0x20, ["escape"] = 0x1B, ["esc"] = 0x1B,
        ["backspace"] = 0x08, ["delete"] = 0x2E, ["forwarddelete"] = 0x2E, ["insert"] = 0x2D,
        ["up"] = 0x26, ["down"] = 0x28, ["left"] = 0x25, ["right"] = 0x27,
        ["home"] = 0x24, ["end"] = 0x23, ["pageup"] = 0x21, ["pagedown"] = 0x22,
        ["f1"] = 0x70, ["f2"] = 0x71, ["f3"] = 0x72, ["f4"] = 0x73, ["f5"] = 0x74, ["f6"] = 0x75,
        ["f7"] = 0x76, ["f8"] = 0x77, ["f9"] = 0x78, ["f10"] = 0x79, ["f11"] = 0x7A, ["f12"] = 0x7B,
        ["-"] = 0xBD, ["="] = 0xBB, [","] = 0xBC, ["."] = 0xBE, ["/"] = 0xBF, [";"] = 0xBA,
        ["["] = 0xDB, ["]"] = 0xDD, ["'"] = 0xDE, ["`"] = 0xC0, ["\\"] = 0xDC,
    };

    // "enter", "ctrl+c", "ctrl+shift+t", "win+d". The Mac's cmd is read as
    // Ctrl, its option as Alt.
    public static (ushort Key, ushort[] Modifiers)? Combo(string keys)
    {
        var modifiers = new List<ushort>();
        ushort? key = null;
        foreach (var raw in keys.ToLowerInvariant().Split('+'))
        {
            var part = raw.Trim();
            switch (part)
            {
                case "ctrl": case "control": case "cmd": case "command": Add(modifiers, 0x11); break;
                case "shift": Add(modifiers, 0x10); break;
                case "alt": case "option": case "opt": Add(modifiers, 0x12); break;
                case "win": case "windows": case "meta": case "super": Add(modifiers, 0x5B); break;
                default:
                    if (key is not null) return null;
                    if (Named.TryGetValue(part, out var named)) key = named;
                    else if (part.Length == 1 && char.IsAsciiLetterOrDigit(part[0])) key = char.ToUpperInvariant(part[0]);
                    else return null;
                    break;
            }
        }
        return key is null ? null : (key.Value, modifiers.ToArray());
    }

    private static void Add(List<ushort> list, ushort value)
    {
        if (!list.Contains(value)) list.Add(value);
    }
}
