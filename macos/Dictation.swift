import AVFoundation
import Speech

// Voice input for the composer. Speech is recognized on this Mac whenever the
// language supports it; otherwise Apple's speech service handles it, and the
// settings window says so. Text streams to the page while the person talks.
@MainActor
final class Dictation {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private(set) var onDevice = false
    private var tapped = false
    var onText: ((String, Bool) -> Void)?
    var onEnd: ((String?) -> Void)?

    var running: Bool { task != nil }

    static func microphoneState() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "allowed"
        case .denied, .restricted: return "denied"
        default: return "not-asked"
        }
    }
    static func speechState() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return "allowed"
        case .denied, .restricted: return "denied"
        default: return "not-asked"
        }
    }
    static func onDeviceSupported(_ language: String) -> Bool {
        SFSpeechRecognizer(locale: Locale(identifier: language))?.supportsOnDeviceRecognition ?? false
    }

    // Audio and recognition callbacks arrive on background queues, so their
    // closures are made outside the main actor and hop back to it.
    nonisolated static func requestAccess(_ done: @escaping @Sendable (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { microphone in
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async { done(microphone && status == .authorized) }
            }
        }
    }
    nonisolated private static func tap(_ request: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in request.append(buffer) }
    }
    nonisolated private static func handler(
        _ deliver: @escaping @Sendable (String?, Bool, Bool) -> Void
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, error in
            deliver(result?.bestTranscription.formattedString, result?.isFinal ?? false, error != nil)
        }
    }

    func start(language: String) -> String? {
        stop(cancel: true)
        guard Self.microphoneState() == "allowed", Self.speechState() == "allowed"
        else { return "Allow the microphone and speech recognition for Open Muse in System Settings." }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)) ?? SFSpeechRecognizer(),
              recognizer.isAvailable
        else { return "Speech recognition is not available right now." }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        onDevice = recognizer.supportsOnDeviceRecognition
        if onDevice { request.requiresOnDeviceRecognition = true }
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0), block: Self.tap(request))
        tapped = true
        engine.prepare()
        do { try engine.start() } catch {
            release()
            return "The microphone could not start."
        }
        self.request = request
        let id = ObjectIdentifier(request)
        task = recognizer.recognitionTask(with: request, resultHandler: Self.handler { [weak self] text, final, failed in
            Task { @MainActor in self?.deliver(id, text, final, failed) }
        })
        return nil
    }

    private func deliver(_ id: ObjectIdentifier, _ text: String?, _ final: Bool, _ failed: Bool) {
        guard let current = request, ObjectIdentifier(current) == id else { return }
        if let text { onText?(text, final) }
        if final || failed { finish(failed && !final ? "Dictation stopped." : nil) }
    }

    // Stopping keeps what was heard so far; cancelling discards it.
    func stop(cancel: Bool = false) {
        guard request != nil || task != nil else { return }
        release()
        request?.endAudio()
        if cancel {
            task?.cancel()
            finish(nil)
        }
    }

    private func release() {
        if engine.isRunning { engine.stop() }
        if tapped { engine.inputNode.removeTap(onBus: 0) }
        tapped = false
    }

    private func finish(_ error: String?) {
        release()
        request = nil
        task = nil
        onEnd?(error)
    }
}
