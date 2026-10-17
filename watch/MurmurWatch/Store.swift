import Foundation
import Security

struct PendingUpload: Codable, Identifiable {
    let id: UUID
    let fileName: String
    let title: String
    let template: String
    let consent: String
    let durationMs: Int
    var recordingId: String?
    var lastError: String?
    var fileURL: URL { Store.audioDir.appendingPathComponent(fileName) }
}

/// The device token (Keychain) and recordings waiting to upload (kept until the upload succeeds).
@MainActor
final class Store: ObservableObject {
    static weak var shared: Store?
    static let audioDir: URL = {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("pending", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    @Published var token: String? = Keychain.read()
    @Published var pending: [PendingUpload] = []
    @Published var uploading = false
    private let key = "pending.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: key), let list = try? JSONDecoder().decode([PendingUpload].self, from: data) {
            pending = list.filter { FileManager.default.fileExists(atPath: $0.fileURL.path) }
        }
        Store.shared = self
    }

    func setToken(_ t: String?) {
        if let t { Keychain.write(t) } else { Keychain.delete() }
        token = t
    }

    func add(_ p: PendingUpload) {
        pending.append(p)
        save()
        Task { await flush() }
    }

    nonisolated func setRecordingId(_ id: UUID, _ rid: String) {
        Task { @MainActor in
            if let i = pending.firstIndex(where: { $0.id == id }) { pending[i].recordingId = rid; save() }
        }
    }

    func flush() async {
        guard let token, !uploading else { return }
        uploading = true
        defer { uploading = false }
        for item in pending {
            do {
                _ = try await Api.upload(item, token: token)
                try? FileManager.default.removeItem(at: item.fileURL)
                pending.removeAll { $0.id == item.id }
            } catch let e as Api.ApiError where e.status == 401 {
                setToken(nil) // unlinked from the app
                return
            } catch {
                if let i = pending.firstIndex(where: { $0.id == item.id }) { pending[i].lastError = error.localizedDescription }
            }
            save()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(pending) { UserDefaults.standard.set(data, forKey: key) }
    }
}

enum Keychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "murmur.device", kSecAttrAccount as String: "token"]

    static func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func write(_ v: String) {
        delete()
        var q = query
        q[kSecValueData as String] = Data(v.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() { SecItemDelete(query as CFDictionary) }
}
