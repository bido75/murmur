// SystemAudioCapture — streams this Mac's system audio (other apps: Zoom, Teams, browsers)
// to stdout as raw little-endian Float32 mono PCM at 48 kHz.
//
// - Status goes to stderr as one JSON object per line: {"event":"started"} / {"event":"error",...}
// - Exits when stdin closes, so it never outlives the Murmur app that started it.
// - Requires macOS 13+ and the "Screen & System Audio Recording" permission, which macOS
//   attributes to the parent app (Murmur), not to this helper.
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

func status(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

@available(macOS 13.0, *)
final class SystemAudio: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let stdout = FileHandle.standardOutput
    private let audioQueue = DispatchQueue(label: "murmur.audio")
    private let screenQueue = DispatchQueue(label: "murmur.screen")

    func start() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                status(["event": "error", "message": "No display found"])
                exit(2)
            }
            // Leave out Murmur's own sounds (the parent process).
            let parent = getppid()
            let excluded = content.applications.filter { $0.processID == parent }
            let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])

            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 48000
            config.channelCount = 1
            // ScreenCaptureKit always produces video too; keep it tiny and slow, and ignore it.
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            config.queueDepth = 5

            let s = SCStream(filter: filter, configuration: config, delegate: self)
            try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: screenQueue)
            try await s.startCapture()
            stream = s
            status(["event": "started", "sampleRate": 48000])
        } catch {
            // Most often: Screen & System Audio Recording permission not granted.
            status(["event": "error", "message": error.localizedDescription, "permission": true])
            exit(3)
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frames > 0 else { return }

        var sizeNeeded = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer, bufferListSizeNeededOut: &sizeNeeded, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        let raw = UnsafeMutableRawPointer.allocate(byteCount: sizeNeeded, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        let ablPointer = raw.assumingMemoryBound(to: AudioBufferList.self)
        var block: CMBlockBuffer?
        let err = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: ablPointer, bufferListSize: sizeNeeded,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block)
        guard err == noErr else { return }

        // Mix whatever channel layout arrives down to mono Float32.
        let buffers = UnsafeMutableAudioBufferListPointer(ablPointer)
        var mono = [Float](repeating: 0, count: frames)
        var sources: Float = 0
        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let samples = data.assumingMemoryBound(to: Float.self)
            let channels = max(1, Int(buffer.mNumberChannels))
            let available = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size / channels
            let n = min(frames, available)
            for i in 0..<n {
                var sum: Float = 0
                for c in 0..<channels { sum += samples[i * channels + c] }
                mono[i] += sum / Float(channels)
            }
            sources += 1
        }
        if sources > 1 { for i in 0..<frames { mono[i] /= sources } }
        mono.withUnsafeBufferPointer { stdout.write(Data(buffer: $0)) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        status(["event": "error", "message": error.localizedDescription])
        exit(4)
    }
}

// Writing to a closed pipe should end us quietly, not crash.
signal(SIGPIPE, SIG_IGN)

if #available(macOS 13.0, *) {
    let capture = SystemAudio()
    Task { await capture.start() }
    // Exit when the parent closes our stdin (or dies).
    DispatchQueue.global().async {
        _ = FileHandle.standardInput.readDataToEndOfFile()
        exit(0)
    }
    RunLoop.main.run()
} else {
    status(["event": "error", "message": "System audio capture needs macOS 13 or later"])
    exit(1)
}
