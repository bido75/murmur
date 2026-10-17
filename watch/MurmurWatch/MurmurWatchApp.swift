import SwiftUI

@main
struct MurmurWatchApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup {
            if store.token == nil {
                LinkView().environmentObject(store)
            } else {
                RecordView().environmentObject(store)
            }
        }
    }
}
