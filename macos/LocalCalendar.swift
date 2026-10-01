import EventKit
import Foundation

// Answers the mac_calendar tool from the Calendar and Reminders apps on this
// Mac. It only reads: nothing is created, changed or deleted. Each kind needs
// its own macOS permission, and a refusal is reported as a result.
@MainActor
final class LocalCalendar {
    static let tool = "mac_calendar"
    // The longest event range one call may read.
    static let maxDays: Double = 92
    private let store = EKEventStore()

    static func state(_ type: EKEntityType) -> String {
        switch EKEventStore.authorizationStatus(for: type) {
        case .fullAccess: return "allowed"
        case .notDetermined: return "not-asked"
        default: return "denied"
        }
    }

    // Access callbacks arrive on a background queue, so their closures are made
    // outside the main actor and hop back to it.
    func request(_ type: EKEntityType, _ done: @escaping @Sendable () -> Void) {
        if type == .event {
            store.requestFullAccessToEvents(completion: Self.accessHandler(done))
        } else {
            store.requestFullAccessToReminders(completion: Self.accessHandler(done))
        }
    }
    nonisolated private static func accessHandler(
        _ done: @escaping @Sendable () -> Void
    ) -> @Sendable (Bool, Error?) -> Void {
        { _, _ in DispatchQueue.main.async { done() } }
    }

    struct Reminder: Sendable {
        let title: String
        let due: Date?
        let priority: Int
        let list: String
        let notes: String
    }
    nonisolated private static func remindersHandler(
        _ done: @escaping @Sendable ([Reminder]) -> Void
    ) -> @Sendable ([EKReminder]?) -> Void {
        { found in
            done((found ?? []).map { item in
                Reminder(
                    title: item.title ?? "",
                    due: item.dueDateComponents.flatMap { Calendar.current.date(from: $0) },
                    priority: item.priority,
                    list: item.calendar?.title ?? "",
                    notes: item.notes ?? "")
            })
        }
    }

    func run(_ input: [String: Any]) async -> (ok: Bool, text: String) {
        guard let kind = input["kind"] as? String, kind == "events" || kind == "reminders"
        else { return failure("kind must be events or reminders.") }
        let type: EKEntityType = kind == "events" ? .event : .reminder
        guard Self.state(type) == "allowed" else {
            return failure(kind == "events"
                ? "Open Muse is not allowed to read Calendar on this Mac."
                : "Open Muse is not allowed to read Reminders on this Mac.")
        }
        let from = (input["from"] as? String).flatMap(Self.date)
        let to = (input["to"] as? String).flatMap(Self.date)
        if (input["from"] != nil && from == nil) || (input["to"] != nil && to == nil) {
            return failure("from and to must be ISO 8601 dates.")
        }
        let limit = min(200, max(1, (input["limit"] as? NSNumber)?.intValue ?? 50))
        let query = ((input["query"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = { (fields: [String?]) in
            query.isEmpty || fields.contains { $0?.localizedCaseInsensitiveContains(query) == true }
        }
        if kind == "events" {
            let start = from ?? Date()
            let end = to ?? start.addingTimeInterval(7 * 86_400)
            guard end > start, end.timeIntervalSince(start) <= Self.maxDays * 86_400
            else { return failure("The range must end after it starts and span at most 92 days.") }
            let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
            let events = store.events(matching: predicate)
                .filter { matches([$0.title, $0.location, $0.notes]) }
                .sorted { $0.startDate < $1.startDate }
            let items = events.prefix(limit).map { event -> [String: Any] in
                var row: [String: Any] = [
                    "title": event.title ?? "",
                    "start": Self.stamp(event.startDate),
                    "end": Self.stamp(event.endDate),
                    "all_day": event.isAllDay,
                    "calendar": event.calendar?.title ?? "",
                ]
                if let location = event.location, !location.isEmpty { row["location"] = location }
                if let notes = event.notes, !notes.isEmpty { row["notes"] = String(notes.prefix(500)) }
                return row
            }
            return (true, json([
                "kind": "events", "from": Self.stamp(start), "to": Self.stamp(end),
                "time_zone": TimeZone.current.identifier, "total": events.count, "items": items,
            ]))
        }
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: to, calendars: nil)
        let found: [Reminder] = await withCheckedContinuation { continuation in
            _ = store.fetchReminders(matching: predicate, completion: Self.remindersHandler { continuation.resume(returning: $0) })
        }
        let reminders = found
            .filter { matches([$0.title, $0.notes]) }
            .sorted { ($0.due ?? .distantFuture, $0.title) < ($1.due ?? .distantFuture, $1.title) }
        let items = reminders.prefix(limit).map { item -> [String: Any] in
            var row: [String: Any] = ["title": item.title, "list": item.list]
            if let due = item.due { row["due"] = Self.stamp(due) }
            if item.priority > 0 { row["priority"] = item.priority }
            if !item.notes.isEmpty { row["notes"] = String(item.notes.prefix(500)) }
            return row
        }
        var result: [String: Any] = [
            "kind": "reminders", "time_zone": TimeZone.current.identifier,
            "total": reminders.count, "items": items,
        ]
        if let to { result["due_by"] = Self.stamp(to) }
        return (true, json(result))
    }

    // Accepts full ISO 8601 times, and local times or dates without a zone.
    nonisolated static func date(_ text: String) -> Date? {
        let iso = ISO8601DateFormatter()
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
            iso.formatOptions = options
            if let date = iso.date(from: text) { return date }
        }
        let local = DateFormatter()
        local.locale = Locale(identifier: "en_US_POSIX")
        local.timeZone = .current
        for format in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd"] {
            local.dateFormat = format
            if let date = local.date(from: text) { return date }
        }
        return nil
    }
    nonisolated static func stamp(_ date: Date) -> String {
        let iso = ISO8601DateFormatter()
        iso.timeZone = .current
        iso.formatOptions = [.withInternetDateTime]
        return iso.string(from: date)
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
