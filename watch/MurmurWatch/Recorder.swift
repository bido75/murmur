import AVFoundation
import Foundation

/// AAC (.m4a), mono, 22 kHz — small files that transcribe well.
@MainActor
final class Recorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var isRecording = false
    @Published var startedAt: Date?
    private var recorder: AVAudioRecorder?
    private(set) var fileName = ""

    func start() async throws {
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else { throw NSError(domain: "Murmur", code: 1, userInfo: [NSLocalizedDescriptionKey: "Allow the microphone in the Watch app settings."]) }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        fileName = "rec-\(UUID().uuidString).m4a"
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 22050, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48000]
        let r = try AVAudioRecorder(url: Store.audioDir.appendingPathComponent(fileName), settings: settings)
        r.delegate = self
        guard r.record() else { throw NSError(domain: "Murmur", code: 2, userInfo: [NSLocalizedDescriptionKey: "Couldn't start the microphone."]) }
        recorder = r
        startedAt = Date()
        isRecording = true
    }

    /// Returns the duration in ms.
    func stop() -> Int {
        let ms = Int((recorder?.currentTime ?? 0) * 1000)
        recorder?.stop()
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
        return ms
    }
}
