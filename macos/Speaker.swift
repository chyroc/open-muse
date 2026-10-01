import AVFoundation

// Reads text aloud with the system voices on this Mac; nothing leaves it.
// One utterance plays at a time, and each is reported once: finished on its
// own, or stopped. A stop for an utterance that was already replaced is
// ignored, so it cannot end the one playing now.
@MainActor
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var current: (utterance: ObjectIdentifier, id: String)?
    var onEnd: ((String, Bool) -> Void)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    var speaking: Bool { current != nil }

    func speak(_ text: String, language: String, id: String) {
        stop()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language) ?? AVSpeechSynthesisVoice(language: "en-US")
        current = (ObjectIdentifier(utterance), id)
        synthesizer.speak(utterance)
    }

    func stop() {
        guard let playing = current else { return }
        current = nil
        synthesizer.stopSpeaking(at: .immediate)
        onEnd?(playing.id, false)
    }

    private func ended(_ utterance: ObjectIdentifier, finished: Bool) {
        guard let playing = current, playing.utterance == utterance else { return }
        current = nil
        onEnd?(playing.id, finished)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.ended(id, finished: true) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.ended(id, finished: false) }
    }
}
