using System;
using System.Diagnostics;
using System.Media;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;
using OpenMuse.Core;
using Windows.Globalization;
using Windows.Media.SpeechRecognition;

namespace OpenMuse.Handlers;

// museDictation: voice input for the composer, recognized by Windows. The
// whole text heard so far streams to the window that started it as
// muse-dictation {text, final}, then {ended, error?}. Windows dictation needs
// microphone access for desktop apps and online speech recognition, both in
// Settings > Privacy; the default input device is used.
public sealed class DictationHandler(ShellApp app) : IHandler
{
    private SpeechRecognizer? recognizer;
    private ShellWindow? listener;
    private string heard = "";
    private bool cues;
    private bool quickReady;
    private string? pendingQuick;

    public bool Running => recognizer is not null;

    public async Task<object?> Handle(ShellWindow from, Message message)
    {
        var language = message.Get("language") is { } asked && Regex.IsMatch(asked, "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$") ? asked : "en-US";
        switch (message.Get("operation"))
        {
            case "status":
            case "request":
            case "device":
                return State(language);
            case "settings":
                Open(Microphone() == "allowed" ? "ms-settings:privacy-speech" : "ms-settings:privacy-microphone");
                return State(language);
            case "start":
                if (from.Kind == WindowKind.Settings) throw new ShellError("Dictation is not available here");
                await Start(from, language, message.Get("cues") == "true");
                return State(language);
            case "stop":
                Stop(message.Get("cancel") == "true");
                return State(language);
            default:
                throw new ShellError("Invalid dictation operation");
        }
    }

    private JsonObject State(string language) => new()
    {
        ["microphone"] = Microphone(),
        ["speech"] = OnlineSpeech(),
        ["onDevice"] = false,
        ["running"] = Running,
        ["device"] = "",
        ["devices"] = new JsonArray(),
    };

    // Settings > Privacy > Microphone, for desktop apps.
    private static string Microphone()
    {
        const string store = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
        var all = Registry.CurrentUser.OpenSubKey(store)?.GetValue("Value") as string;
        var desktop = Registry.CurrentUser.OpenSubKey(store + @"\NonPackaged")?.GetValue("Value") as string;
        if (all == "Deny" || desktop == "Deny") return "denied";
        return "allowed";
    }

    // Settings > Privacy > Speech, online speech recognition.
    private static string OnlineSpeech()
    {
        var value = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy")?.GetValue("HasAccepted");
        return value is int accepted ? (accepted == 1 ? "allowed" : "denied") : "not-asked";
    }

    private static void Open(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch (Exception) { /* Settings could not open. */ }
    }

    private async Task Start(ShellWindow from, string language, bool sounds)
    {
        Stop(cancel: true);
        if (Microphone() == "denied") throw new ShellError(Strings.T("Allow Open Muse to use the microphone in Windows Settings > Privacy & security > Microphone."));
        if (OnlineSpeech() != "allowed") throw new ShellError(Strings.T("Turn on online speech recognition in Windows Settings > Privacy & security > Speech, then try again."));
        SpeechRecognizer created;
        try
        {
            var target = new Language(language);
            created = SpeechRecognizer.SupportedTopicLanguages.Count > 0 && Contains(target)
                ? new SpeechRecognizer(target)
                : new SpeechRecognizer();
            created.Constraints.Add(new SpeechRecognitionTopicConstraint(SpeechRecognitionScenario.Dictation, "dictation"));
            var compiled = await created.CompileConstraintsAsync();
            if (compiled.Status != SpeechRecognitionResultStatus.Success) throw new InvalidOperationException();
        }
        catch (Exception)
        {
            throw new ShellError(Strings.T("Windows speech recognition is not available for this language."));
        }
        recognizer = created;
        listener = from;
        heard = "";
        cues = sounds;
        // The microphone must not hear a reply being read aloud.
        app.Speech.StopSpeaking();
        created.HypothesisGenerated += (_, e) => app.Dispatcher.BeginInvoke(() =>
            Send(new JsonObject { ["text"] = Join(heard, e.Hypothesis.Text), ["final"] = false }));
        created.ContinuousRecognitionSession.ResultGenerated += (_, e) => app.Dispatcher.BeginInvoke(() =>
        {
            if (e.Result.Status == SpeechRecognitionResultStatus.Success && e.Result.Text.Length > 0)
                heard = Join(heard, e.Result.Text);
            Send(new JsonObject { ["text"] = heard, ["final"] = false });
        });
        created.ContinuousRecognitionSession.Completed += (_, e) => app.Dispatcher.BeginInvoke(() =>
            Finish(e.Status is SpeechRecognitionResultStatus.Success or SpeechRecognitionResultStatus.UserCanceled
                ? null
                : Strings.T("Dictation stopped.")));
        try
        {
            await created.ContinuousRecognitionSession.StartAsync();
        }
        catch (Exception)
        {
            recognizer = null;
            created.Dispose();
            throw new ShellError(Strings.T("Allow Open Muse to use the microphone in Windows Settings > Privacy & security > Microphone."));
        }
        if (cues) SystemSounds.Asterisk.Play();
    }

    private static bool Contains(Language language)
    {
        foreach (var supported in SpeechRecognizer.SupportedTopicLanguages)
            if (supported.LanguageTag.Equals(language.LanguageTag, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // Chinese runs on without spaces; other languages get one between parts.
    private static string Join(string before, string after)
    {
        if (before.Length == 0) return after;
        if (after.Length == 0) return before;
        var cjk = Regex.IsMatch(before[^1].ToString(), @"[　-鿿]") || Regex.IsMatch(after[0].ToString(), @"[　-鿿]");
        return cjk ? before + after : before + " " + after;
    }

    // Stopping keeps what was heard; cancelling drops it.
    public async void Stop(bool cancel)
    {
        var current = recognizer;
        if (current is null) return;
        try
        {
            if (cancel) await current.ContinuousRecognitionSession.CancelAsync();
            else await current.ContinuousRecognitionSession.StopAsync();
        }
        catch (Exception)
        {
            Finish(null);
        }
    }

    private void Send(JsonObject detail) => app.Dispatch(listener, "muse-dictation", detail);

    private void Finish(string? error)
    {
        if (recognizer is null) return;
        var current = recognizer;
        recognizer = null;
        if (heard.Length > 0) Send(new JsonObject { ["text"] = heard, ["final"] = true });
        if (cues) SystemSounds.Beep.Play();
        var ended = new JsonObject { ["ended"] = true };
        if (error is not null) ended["error"] = error;
        Send(ended);
        current.Dispose();
    }

    // The dictation shortcuts speak into the Quick Chat card, opening it
    // first; an action that arrives before the card is ready waits for it.
    public void QuickDictate(string action)
    {
        if (action != "stop" && app.QuickWindow?.IsVisible != true) app.ToggleQuickChat();
        if (!quickReady || app.QuickWindow is null)
        {
            pendingQuick = action == "stop" && pendingQuick == "start" ? null : action;
            return;
        }
        app.Dispatch(app.QuickWindow, "muse-quick-dictate", action);
    }

    public void QuickReady()
    {
        quickReady = true;
        if (pendingQuick is null) return;
        var action = pendingQuick;
        pendingQuick = null;
        QuickDictate(action);
    }
}
