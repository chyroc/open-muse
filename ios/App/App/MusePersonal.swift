import Contacts
import EventKit
import Foundation
import WebKit

// Reads Calendar, Reminders and Contacts on this iPhone when the bundled app
// asks, after the person approved that request in the chat. It only reads:
// nothing is created, changed or deleted. Each source has its own iOS
// permission; a refusal is reported back as a result, never retried here.
final class MusePersonalHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let events = EKEventStore()
    private let contacts = CNContactStore()
    private static let maxDays: Double = 92

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              message.webView?.url?.scheme == "capacitor", message.webView?.url?.host == "localhost",
              let body = message.body as? [String: Any], let operation = body["operation"] as? String,
              let source = body["source"] as? String, ["calendar", "reminders", "contacts"].contains(source)
        else { replyHandler(nil, "Invalid request"); return }
        let reply: (Any?, String?) -> Void = { value, error in
            DispatchQueue.main.async { replyHandler(value, error) }
        }
        switch operation {
        case "access":
            reply(state(source), nil)
        case "authorize":
            authorize(source) { reply(self.state(source), nil) }
        case "read":
            guard state(source) == "allowed" else {
                reply(failure(source == "contacts"
                    ? "Open Muse is not allowed to read Contacts on this iPhone."
                    : source == "calendar"
                        ? "Open Muse is not allowed to read Calendar on this iPhone."
                        : "Open Muse is not allowed to read Reminders on this iPhone."), nil)
                return
            }
            let input = body["input"] as? [String: Any] ?? [:]
            if source == "contacts" {
                DispatchQueue.global(qos: .userInitiated).async {
                    reply(self.searchContacts(input), nil)
                }
            } else {
                readCalendar(source, input) { reply($0, nil) }
            }
        default:
            reply(nil, "Invalid request")
        }
    }

    private func state(_ source: String) -> String {
        if source == "contacts" {
            switch CNContactStore.authorizationStatus(for: .contacts) {
            case .authorized: return "allowed"
            case .notDetermined: return "not-asked"
            default:
                if #available(iOS 18.0, *), CNContactStore.authorizationStatus(for: .contacts) == .limited {
                    return "allowed"
                }
                return "denied"
            }
        }
        let status = EKEventStore.authorizationStatus(for: source == "calendar" ? .event : .reminder)
        if #available(iOS 17.0, *) {
            if status == .fullAccess { return "allowed" }
        } else if status == .authorized {
            return "allowed"
        }
        return status == .notDetermined ? "not-asked" : "denied"
    }

    private func authorize(_ source: String, _ done: @escaping () -> Void) {
        let finish: (Bool, Error?) -> Void = { _, _ in done() }
        if source == "contacts" {
            contacts.requestAccess(for: .contacts, completionHandler: finish)
        } else if #available(iOS 17.0, *) {
            if source == "calendar" { events.requestFullAccessToEvents(completion: finish) }
            else { events.requestFullAccessToReminders(completion: finish) }
        } else {
            events.requestAccess(to: source == "calendar" ? .event : .reminder, completion: finish)
        }
    }

    private func readCalendar(_ source: String, _ input: [String: Any], _ done: @escaping (String) -> Void) {
        let from = (input["from"] as? String).flatMap(Self.date)
        let to = (input["to"] as? String).flatMap(Self.date)
        if (input["from"] != nil && from == nil) || (input["to"] != nil && to == nil) {
            return done(failure("from and to must be ISO 8601 dates."))
        }
        let limit = min(200, max(1, (input["limit"] as? NSNumber)?.intValue ?? 50))
        let query = ((input["query"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = { (fields: [String?]) in
            query.isEmpty || fields.contains { $0?.localizedCaseInsensitiveContains(query) == true }
        }
        if source == "calendar" {
            let start = from ?? Date()
            let end = to ?? start.addingTimeInterval(7 * 86_400)
            guard end > start, end.timeIntervalSince(start) <= Self.maxDays * 86_400
            else { return done(failure("The range must end after it starts and span at most 92 days.")) }
            let found = events.events(matching: events.predicateForEvents(withStart: start, end: end, calendars: nil))
                .filter { matches([$0.title, $0.location, $0.notes]) }
                .sorted { $0.startDate < $1.startDate }
            let items = found.prefix(limit).map { event -> [String: Any] in
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
            return done(json([
                "kind": "events", "from": Self.stamp(start), "to": Self.stamp(end),
                "time_zone": TimeZone.current.identifier, "total": found.count, "items": items,
            ]))
        }
        let predicate = events.predicateForIncompleteReminders(withDueDateStarting: nil, ending: to, calendars: nil)
        events.fetchReminders(matching: predicate) { found in
            let reminders = (found ?? [])
                .filter { matches([$0.title, $0.notes]) }
                .map { item -> (title: String, due: Date?, priority: Int, list: String, notes: String) in
                    (item.title ?? "", item.dueDateComponents.flatMap { Calendar.current.date(from: $0) },
                     item.priority, item.calendar?.title ?? "", item.notes ?? "")
                }
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
            done(self.json(result))
        }
    }

    // By name first; a phone number or email is matched against every contact.
    private func searchContacts(_ input: [String: Any]) -> String {
        let query = ((input["query"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query.count <= 100 else { return failure("query must not be empty.") }
        let limit = min(20, max(1, (input["limit"] as? NSNumber)?.intValue ?? 10))
        let keys: [CNKeyDescriptor] = [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactJobTitleKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactBirthdayKey as CNKeyDescriptor,
        ]
        var found: [CNContact] = []
        do {
            found = try contacts.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: query), keysToFetch: keys)
            if found.isEmpty {
                let digits = query.filter(\.isNumber)
                let request = CNContactFetchRequest(keysToFetch: keys)
                try contacts.enumerateContacts(with: request) { contact, stop in
                    let phone = digits.count >= 4 && contact.phoneNumbers.contains {
                        $0.value.stringValue.filter(\.isNumber).contains(digits)
                    }
                    let email = contact.emailAddresses.contains {
                        ($0.value as String).localizedCaseInsensitiveContains(query)
                    }
                    if phone || email { found.append(contact) }
                    if found.count >= limit { stop.pointee = true }
                }
            }
        } catch {
            return failure("Contacts could not be read: \(error.localizedDescription)")
        }
        let items = found.prefix(limit).map { contact -> [String: Any] in
            var row: [String: Any] = ["name": CNContactFormatter.string(from: contact, style: .fullName) ?? ""]
            if !contact.organizationName.isEmpty { row["organization"] = contact.organizationName }
            if !contact.jobTitle.isEmpty { row["job_title"] = contact.jobTitle }
            let phones = contact.phoneNumbers.map { number -> [String: String] in
                ["label": CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: number.label ?? ""),
                 "number": number.value.stringValue]
            }
            if !phones.isEmpty { row["phones"] = phones }
            let emails = contact.emailAddresses.map { $0.value as String }
            if !emails.isEmpty { row["emails"] = emails }
            if let birthday = contact.birthday, let month = birthday.month, let day = birthday.day {
                row["birthday"] = birthday.year.map { String(format: "%04d-%02d-%02d", $0, month, day) }
                    ?? String(format: "--%02d-%02d", month, day)
            }
            return row
        }
        return json(["query": query, "total": found.count, "items": items])
    }

    // Accepts full ISO 8601 times, and local times or dates without a zone.
    private static func date(_ text: String) -> Date? {
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
    private static func stamp(_ date: Date) -> String {
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
    private func failure(_ message: String) -> String {
        json(["ok": false, "error": message])
    }
}
