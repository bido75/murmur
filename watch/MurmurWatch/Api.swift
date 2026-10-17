import Foundation

/// Calls the Murmur `ingest` function. The device token can only create and upload recordings.
enum Api {
    static var base: String {
        let url = (Bundle.main.object(forInfoDictionaryKey: "MurmurServerURL") as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return "\(url)/functions/v1/ingest"
    }
    static var anonKey: String { Bundle.main.object(forInfoDictionaryKey: "MurmurAnonKey") as? String ?? "" }

    struct ApiError: LocalizedError {
        let message: String
        let status: Int
        var errorDescription: String? { message }
    }

    static func call(_ path: String, _ body: [String: Any], token: String?) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: "\(base)/\(path)")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if status >= 300 || json["error"] != nil {
            throw ApiError(message: json["error"] as? String ?? "Request failed (\(status))", status: status)
        }
        return json
    }

    static func link(code: String) async throws -> String {
        let r = try await call("link", ["code": code, "name": "Apple Watch", "kind": "watch"], token: nil)
        guard let t = r["token"] as? String else { throw ApiError(message: "No token", status: 0) }
        return t
    }

    /// Start → signed upload URL → PUT the file → finish. Safe to retry: each step is idempotent.
    static func upload(_ item: PendingUpload, token: String) async throws -> String {
        var recordingId = item.recordingId
        if recordingId == nil {
            let r = try await call("start", ["title": item.title, "template": item.template, "consent_method": item.consent], token: token)
            recordingId = r["recording_id"] as? String
        }
        guard let id = recordingId else { throw ApiError(message: "No recording id", status: 0) }
        Store.shared?.setRecordingId(item.id, id)
        let u = try await call("upload-url", ["recording_id": id, "idx": 1, "content_type": "audio/mp4"], token: token)
        guard let s = u["url"] as? String, let url = URL(string: s) else { throw ApiError(message: "No upload URL", status: 0) }
        var put = URLRequest(url: url)
        put.httpMethod = "PUT"
        put.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        put.setValue("true", forHTTPHeaderField: "x-upsert")
        let (_, res) = try await URLSession.shared.upload(for: put, fromFile: item.fileURL)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        if status >= 300 { throw ApiError(message: "Upload failed (\(status))", status: status) }
        _ = try await call("finish", ["recording_id": id, "duration_ms": item.durationMs, "segments": [["idx": 1, "ext": "m4a", "duration_ms": item.durationMs]]], token: token)
        return id
    }
}
