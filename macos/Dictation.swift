import AudioToolbox
import AVFoundation
import CoreAudio
import Speech

// Voice input for the composer. Speech is recognized on this Mac whenever the
// language supports it; otherwise Apple's speech service handles it, and the
// settings window says so. Text streams to the page while the person talks.
@MainActor
final class Dictation {
    // A fresh engine per session picks up the chosen microphone and its format.
    private var engine = AVAudioEngine()
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

    // Microphones are Core Audio devices with input streams; the UID is stable
    // across launches and reconnects, so it is what a saved choice refers to.
    struct InputDevice { let id: AudioDeviceID; let uid: String; let name: String }
    static func inputDevices() -> [InputDevice] {
        let system = AudioObjectID(kAudioObjectSystemObject)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { id in
            var streams = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreams,
                mScope: kAudioDevicePropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain)
            var streamSize: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(id, &streams, 0, nil, &streamSize) == noErr, streamSize > 0,
                  let uid = text(id, kAudioDevicePropertyDeviceUID),
                  let name = text(id, kAudioObjectPropertyName)
            else { return nil }
            return InputDevice(id: id, uid: uid, name: name)
        }
    }
    private static func text(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        let status = withUnsafeMutablePointer(to: &value) {
            AudioObjectGetPropertyData(id, &address, 0, nil, &size, $0)
        }
        guard status == noErr, let value else { return nil }
        return value.takeRetainedValue() as String
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

    // An empty or disconnected device choice falls back to the system input.
    func start(language: String, device: String = "") -> String? {
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
        engine = AVAudioEngine()
        let input = engine.inputNode
        if !device.isEmpty, let chosen = Self.inputDevices().first(where: { $0.uid == device }),
           let unit = input.audioUnit {
            var id = chosen.id
            AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                                 &id, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
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
