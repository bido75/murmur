import SwiftUI
import WatchKit

struct LinkView: View {
    @EnvironmentObject var store: Store
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Link Murmur").font(.headline)
                Text("In the app: Settings → Devices → Show a code").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                TextField("Code", text: $code).textInputAutocapitalization(.characters)
                Button(busy ? "Linking…" : "Link") {
                    busy = true
                    Task {
                        do { store.setToken(try await Api.link(code: code)) } catch { self.error = error.localizedDescription }
                        busy = false
                    }
                }
                .disabled(code.count < 8 || busy)
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }
        }
    }
}

struct RecordView: View {
    @EnvironmentObject var store: Store
    @StateObject private var recorder = Recorder()
    @State private var consent: String?
    @State private var error: String?
    private let options: [(String, String)] = [("told_everyone", "I told everyone"), ("solo", "Just me"), ("not_confirmed", "Ask later")]

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if recorder.isRecording, let start = recorder.startedAt {
                    TimelineView(.periodic(from: start, by: 1)) { ctx in
                        Text(clock(ctx.date.timeIntervalSince(start))).font(.system(size: 34, weight: .semibold, design: .rounded)).monospacedDigit()
                    }
                    Button(role: .destructive) { stop() } label: { Label("Stop", systemImage: "stop.fill") }
                        .tint(.red)
                } else {
                    Text("Who knows it's recorded?").font(.footnote).foregroundStyle(.secondary)
                    ForEach(options, id: \.0) { o in
                        Button { consent = o.0 } label: {
                            HStack { Text(o.1); Spacer(); if consent == o.0 { Image(systemName: "checkmark") } }
                        }
                    }
                    Button { start() } label: { Label("Record", systemImage: "mic.fill") }
                        .tint(.red)
                        .disabled(consent == nil)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                if !store.pending.isEmpty {
                    Text("\(store.pending.count) waiting to upload").font(.footnote).foregroundStyle(.secondary)
                    if let e = store.pending.first?.lastError { Text(e).font(.footnote).foregroundStyle(.orange) }
                    Button("Retry upload") { Task { await store.flush() } }.disabled(store.uploading)
                }
            }
        }
        .onAppear { Task { await store.flush() } }
    }

    private func start() {
        Task {
            do {
                try await recorder.start()
                WKInterfaceDevice.current().play(.start)
            } catch { self.error = error.localizedDescription }
        }
    }

    private func stop() {
        let ms = recorder.stop()
        WKInterfaceDevice.current().play(.stop)
        guard ms > 1000 else { try? FileManager.default.removeItem(at: Store.audioDir.appendingPathComponent(recorder.fileName)); return }
        let title = "Watch recording " + Date().formatted(date: .abbreviated, time: .shortened)
        store.add(PendingUpload(id: UUID(), fileName: recorder.fileName, title: title, template: "general", consent: consent ?? "not_confirmed", durationMs: ms, recordingId: nil, lastError: nil))
    }

    private func clock(_ t: TimeInterval) -> String {
        let s = Int(t)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%02d:%02d", s / 60, s % 60)
    }
}
