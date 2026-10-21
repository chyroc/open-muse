using System;
using System.Windows.Shell;

namespace OpenMuse;

// The taskbar button's right-click menu: a new side chat, Quick Chat, and
// search. Each starts OpenMuse.exe with a flag the running copy picks up
// (see Program), in the app's language.
public static class JumpList
{
    public static void Install(ShellApp app)
    {
        var exe = Environment.ProcessPath;
        if (exe is null) return;
        var profile = app.Profile.Name is null ? "" : $" --open-muse-profile {app.Profile.Name}";
        JumpTask Task(string title, string flag) => new()
        {
            Title = Strings.T(title),
            ApplicationPath = exe,
            Arguments = flag + profile,
            IconResourcePath = exe,
        };
        var list = new System.Windows.Shell.JumpList();
        list.JumpItems.Add(Task("New Side Chat", "--new-chat"));
        list.JumpItems.Add(Task("Quick chat", "--quick-chat"));
        list.JumpItems.Add(Task("Search", "--search"));
        list.ShowFrequentCategory = false;
        list.ShowRecentCategory = false;
        System.Windows.Shell.JumpList.SetJumpList(app, list);
        list.Apply();
    }
}
