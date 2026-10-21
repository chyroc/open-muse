namespace OpenMuse.Core;

// Global shortcuts, kept in the page's own encoding (a macOS virtual key code
// and Carbon modifier flags, see macos/ui/shortcut.ts) so the same settings
// UI records and shows them on both systems. Registering translates them to
// a Win32 virtual key and RegisterHotKey modifiers; the page's Command key is
// the Windows key.
public static class Shortcuts
{
    public const int Command = 256, Shift = 512, Option = 2048, Control = 4096;

    // RegisterHotKey modifier flags.
    public const uint ModAlt = 0x1, ModControl = 0x2, ModShift = 0x4, ModWin = 0x8, ModNoRepeat = 0x4000;

    public sealed record Default(int Code, int Modifiers);

    // Alt+Space opens the window menu on Windows, so Quick Chat defaults to
    // Ctrl+Alt+Space; the dictation shortcuts start unset, as on the Mac.
    public static readonly IReadOnlyDictionary<string, Default> Defaults = new Dictionary<string, Default>
    {
        ["quickChat"] = new(49, Control | Option),
        ["dictationHold"] = new(-1, 0),
        ["dictationToggle"] = new(-1, 0),
    };

    // macOS virtual key code to Win32 virtual key, for the keys the page lets
    // a shortcut use.
    private static readonly Dictionary<int, uint> Keys = new()
    {
        [0] = 'A', [1] = 'S', [2] = 'D', [3] = 'F', [4] = 'H', [5] = 'G', [6] = 'Z', [7] = 'X',
        [8] = 'C', [9] = 'V', [11] = 'B', [12] = 'Q', [13] = 'W', [14] = 'E', [15] = 'R',
        [16] = 'Y', [17] = 'T', [18] = '1', [19] = '2', [20] = '3', [21] = '4', [22] = '6',
        [23] = '5', [24] = 0xBB, [25] = '9', [26] = '7', [27] = 0xBD, [28] = '8', [29] = '0',
        [30] = 0xDD, [31] = 'O', [32] = 'U', [33] = 0xDB, [34] = 'I', [35] = 'P', [36] = 0x0D,
        [37] = 'L', [38] = 'J', [39] = 0xDE, [40] = 'K', [41] = 0xBA, [42] = 0xDC, [43] = 0xBC,
        [44] = 0xBF, [45] = 'N', [46] = 'M', [47] = 0xBE, [48] = 0x09, [49] = 0x20, [50] = 0xC0,
    };

    public static bool IsKnownKey(int code) => Keys.ContainsKey(code);

    // A shortcut needs Command, Option or Control and a known key, as the page
    // requires when recording one.
    public static bool IsValid(int code, int modifiers) =>
        IsKnownKey(code) && (modifiers & (Command | Option | Control)) != 0 &&
        (modifiers & ~(Command | Shift | Option | Control)) == 0;

    public static (uint Key, uint Modifiers)? ToWin32(int code, int modifiers)
    {
        if (!IsValid(code, modifiers)) return null;
        uint flags = ModNoRepeat;
        if ((modifiers & Command) != 0) flags |= ModWin;
        if ((modifiers & Option) != 0) flags |= ModAlt;
        if ((modifiers & Control) != 0) flags |= ModControl;
        if ((modifiers & Shift) != 0) flags |= ModShift;
        return (Keys[code], flags);
    }
}
