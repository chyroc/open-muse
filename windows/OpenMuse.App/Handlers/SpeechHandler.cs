using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using OpenMuse.Core;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;

namespace OpenMuse.Handlers;

// museSpeech: a reply read aloud with Windows' own voices. One utterance plays
// at a time; each ends once, reported to the window that asked as
// muse-speech {id, finished} (false when stopped or replaced).
public sealed class SpeechHandler(ShellApp app) : IHandler
{
    private readonly MediaPlayer player = new() { AudioCategory = MediaPlayerAudioCategory.Speech };
    private string? playing;
    private ShellWindow? speaker;
    private bool hooked;

    public async Task<object?> Handle(ShellWindow from, Message message)
    {
        switch (message.Get("operation"))
        {
            case "speak":
                var text = message.Get("text") ?? "";
                var id = message.Get("id") ?? "";
                if (text.Length == 0 || text.Length > 20000 || !Policy.IsSpeechId(id)) throw new ShellError("Invalid speech request");
                var language = message.Get("language") is { } asked && Regex.IsMatch(asked, "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$") ? asked : "en-US";
                await Speak(from, id, text, language);
                return true;
            case "stop":
                Stop();
                return true;
            default:
                throw new ShellError("Invalid speech operation");
        }
    }

    private async Task Speak(ShellWindow from, string id, string text, string language)
    {
        Stop();
        if (!hooked)
        {
            hooked = true;
            player.MediaEnded += (_, _) => app.Dispatcher.BeginInvoke(() => Ended(true));
            player.MediaFailed += (_, _) => app.Dispatcher.BeginInvoke(() => Ended(false));
        }
        using var synthesizer = new SpeechSynthesizer();
        var voice = SpeechSynthesizer.AllVoices.FirstOrDefault(v => v.Language.Equals(language, StringComparison.OrdinalIgnoreCase))
            ?? SpeechSynthesizer.AllVoices.FirstOrDefault(v => v.Language.StartsWith(language.Split('-')[0], StringComparison.OrdinalIgnoreCase));
        if (voice is not null) synthesizer.Voice = voice;
        var stream = await synthesizer.SynthesizeTextToStreamAsync(text);
        playing = id;
        speaker = from;
        player.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
        player.Play();
    }

    public void StopSpeaking() => Stop();

    private void Stop()
    {
        if (playing is null) return;
        player.Pause();
        player.Source = null;
        Ended(false);
    }

    private void Ended(bool finished)
    {
        if (playing is null) return;
        var id = playing;
        playing = null;
        app.Dispatch(speaker, "muse-speech", new { id, finished });
    }
}
