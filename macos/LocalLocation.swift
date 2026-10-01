import CoreLocation
import Foundation

// Answers the mac_location tool with this Mac's approximate location: a
// position rounded to about a kilometre, and the place and time zone macOS
// finds for it. It needs its own macOS permission and asks for one fix per call.
@MainActor
final class LocalLocation: NSObject, CLLocationManagerDelegate {
    static let tool = "mac_location"
    // How long one call waits for macOS to find the Mac.
    static let timeout: UInt64 = 15_000_000_000
    private let manager = CLLocationManager()
    private var waiting: [CheckedContinuation<Fix?, Never>] = []
    private var round = 0
    private var accessDone: [() -> Void] = []

    struct Fix: Sendable {
        let latitude: Double
        let longitude: Double
        let accuracy: Double
        let time: Date
    }
    struct Place: Sendable {
        let locality: String?
        let area: String?
        let country: String?
        let timeZone: String?
    }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    var state: String {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "allowed"
        case .notDetermined: return "not-asked"
        default: return "denied"
        }
    }

    func request(_ done: @escaping () -> Void) {
        accessDone.append(done)
        manager.requestWhenInUseAuthorization()
    }

    func run() async -> (ok: Bool, text: String) {
        guard state == "allowed" else { return failure("Open Muse is not allowed to use Location Services on this Mac.") }
        round += 1
        let current = round
        let fix: Fix? = await withCheckedContinuation { continuation in
            waiting.append(continuation)
            if waiting.count == 1 { manager.requestLocation() }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: Self.timeout)
                if self.round == current { self.deliver(nil) }
            }
        }
        guard let fix else { return failure("macOS could not find this Mac's location right now.") }
        let place: Place? = await withCheckedContinuation { continuation in
            CLGeocoder().reverseGeocodeLocation(
                CLLocation(latitude: fix.latitude, longitude: fix.longitude),
                completionHandler: Self.placeHandler { continuation.resume(returning: $0) })
        }
        var result: [String: Any] = [
            "latitude": (fix.latitude * 100).rounded() / 100,
            "longitude": (fix.longitude * 100).rounded() / 100,
            "accuracy_meters": max(1000, Int(fix.accuracy.rounded())),
            "measured_at": LocalCalendar.stamp(fix.time),
            "time_zone": place?.timeZone ?? TimeZone.current.identifier,
        ]
        if let locality = place?.locality { result["locality"] = locality }
        if let area = place?.area { result["region"] = area }
        if let country = place?.country { result["country"] = country }
        return (true, json(result))
    }

    private func deliver(_ fix: Fix?) {
        round += 1
        let resumed = waiting
        waiting = []
        for continuation in resumed { continuation.resume(returning: fix) }
    }
    private func accessChanged() {
        let done = accessDone
        accessDone = []
        for callback in done { callback() }
    }

    // Location callbacks arrive off the main actor; only plain values cross.
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let fix = Fix(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude,
                      accuracy: last.horizontalAccuracy, time: last.timestamp)
        Task { @MainActor in self.deliver(fix) }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.deliver(nil) }
    }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.accessChanged() }
    }
    nonisolated private static func placeHandler(
        _ done: @escaping @Sendable (Place?) -> Void
    ) -> @Sendable ([CLPlacemark]?, Error?) -> Void {
        { marks, _ in
            done(marks?.first.map {
                Place(locality: $0.locality, area: $0.administrativeArea, country: $0.country,
                      timeZone: $0.timeZone?.identifier)
            })
        }
    }

    private func json(_ value: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }
    private func failure(_ message: String) -> (ok: Bool, text: String) {
        (false, json(["ok": false, "error": message]))
    }
}
