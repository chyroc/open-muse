import Foundation
import HealthKit
import WebKit

private enum MuseHealthFailure: Error {
    case unreadable
}

// Reads one Apple Health metric over one time range when the bundled app asks,
// after the person shared that request in the chat. HealthKit shows its own
// per-type permission sheet and never reveals a read denial, so a denied type
// reads as no data. Nothing is written to Health.
final class MuseHealthHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let store = HKHealthStore()
    private static let day: TimeInterval = 86_400
    private static let cumulative: Set<String> = [
        "steps", "active_energy", "exercise_minutes", "walking_running_distance",
    ]

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "capacitor", origin.host == "localhost",
              message.webView?.url?.scheme == "capacitor", message.webView?.url?.host == "localhost",
              let body = message.body as? [String: Any], let operation = body["operation"] as? String
        else { replyHandler(nil, "Invalid health request"); return }
        if operation == "available" {
            replyHandler(HKHealthStore.isHealthDataAvailable(), nil)
            return
        }
        // Connecting asks once for every metric this app reads. HealthKit
        // reports only whether it has asked, never what the person allowed.
        if operation == "access" {
            guard HKHealthStore.isHealthDataAvailable() else { replyHandler("unavailable", nil); return }
            store.getRequestStatusForAuthorization(toShare: [], read: Self.allTypes) { status, error in
                DispatchQueue.main.async {
                    replyHandler(error == nil && status == .unnecessary ? "requested" : "not_requested", nil)
                }
            }
            return
        }
        if operation == "authorize" {
            guard HKHealthStore.isHealthDataAvailable()
            else { replyHandler(nil, "Health data is not available on this device"); return }
            store.requestAuthorization(toShare: [], read: Self.allTypes) { granted, error in
                DispatchQueue.main.async {
                    if granted, error == nil { replyHandler(true, nil) }
                    else { replyHandler(nil, "Health access was not granted") }
                }
            }
            return
        }
        guard operation == "read" else { replyHandler(nil, "Invalid health request"); return }
        guard HKHealthStore.isHealthDataAvailable()
        else { replyHandler(nil, "Health data is not available on this device"); return }
        guard let metric = body["metric"] as? String, let type = Self.objectType(metric),
              let startMs = (body["start"] as? NSNumber)?.doubleValue,
              let endMs = (body["end"] as? NSNumber)?.doubleValue,
              let granularity = body["granularity"] as? String,
              ["total", "day", "hour"].contains(granularity),
              endMs > startMs, endMs - startMs <= 366 * Self.day * 1000,
              granularity != "hour" || endMs - startMs <= 16 * Self.day * 1000
        else { replyHandler(nil, "Invalid health request"); return }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        store.requestAuthorization(toShare: [], read: [type]) { [weak self] granted, error in
            guard let self, granted, error == nil else {
                DispatchQueue.main.async { replyHandler(nil, "Health access was not granted") }
                return
            }
            self.read(metric: metric, type: type, start: start, end: end, granularity: granularity) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let json): replyHandler(json, nil)
                    case .failure: replyHandler(nil, "Health data could not be read")
                    }
                }
            }
        }
    }

    private static let metrics = [
        "steps", "active_energy", "exercise_minutes", "walking_running_distance",
        "heart_rate", "resting_heart_rate", "sleep", "workouts", "body_mass",
    ]
    private static let allTypes = Set(metrics.compactMap(objectType))

    private static func objectType(_ metric: String) -> HKObjectType? {
        switch metric {
        case "steps": return HKObjectType.quantityType(forIdentifier: .stepCount)
        case "active_energy": return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)
        case "exercise_minutes": return HKObjectType.quantityType(forIdentifier: .appleExerciseTime)
        case "walking_running_distance": return HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)
        case "heart_rate": return HKObjectType.quantityType(forIdentifier: .heartRate)
        case "resting_heart_rate": return HKObjectType.quantityType(forIdentifier: .restingHeartRate)
        case "body_mass": return HKObjectType.quantityType(forIdentifier: .bodyMass)
        case "sleep": return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
        case "workouts": return HKObjectType.workoutType()
        default: return nil
        }
    }

    private static func unit(_ metric: String) -> (HKUnit, String) {
        switch metric {
        case "active_energy": return (.kilocalorie(), "kcal")
        case "exercise_minutes": return (.minute(), "min")
        case "walking_running_distance": return (.meterUnit(with: .kilo), "km")
        case "heart_rate", "resting_heart_rate": return (HKUnit.count().unitDivided(by: .minute()), "bpm")
        case "body_mass": return (.gramUnit(with: .kilo), "kg")
        default: return (.count(), "count")
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter
    }()

    private static func round(_ value: Double) -> Double { (value * 10).rounded() / 10 }

    // Bucket boundaries in the current calendar; the first and last are clipped.
    private static func buckets(_ start: Date, _ end: Date, _ granularity: String) -> [(Date, Date)] {
        guard granularity != "total" else { return [(start, end)] }
        let calendar = Calendar.current
        let component: Calendar.Component = granularity == "hour" ? .hour : .day
        var cursor = granularity == "hour"
            ? calendar.dateInterval(of: .hour, for: start)?.start ?? start
            : calendar.startOfDay(for: start)
        var result: [(Date, Date)] = []
        while cursor < end, result.count < 400 {
            guard let next = calendar.date(byAdding: component, value: 1, to: cursor) else { break }
            result.append((max(cursor, start), min(next, end)))
            cursor = next
        }
        return result
    }

    private func read(metric: String, type: HKObjectType, start: Date, end: Date, granularity: String,
                      completion: @escaping (Result<String, MuseHealthFailure>) -> Void) {
        let finish: ([String: Any]) -> Void = { payload in
            var body = payload
            body["metric"] = metric
            body["start"] = Self.iso.string(from: start)
            body["end"] = Self.iso.string(from: end)
            body["time_zone"] = TimeZone.current.identifier
            guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8)
            else { completion(.failure(.unreadable)); return }
            completion(.success(json))
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        if let quantity = type as? HKQuantityType {
            readQuantity(metric: metric, type: quantity, predicate: predicate, start: start, end: end,
                         granularity: granularity, finish: finish, failed: { completion(.failure(.unreadable)) })
        } else if let category = type as? HKCategoryType {
            let query = HKSampleQuery(sampleType: category, predicate: predicate, limit: HKObjectQueryNoLimit,
                                      sortDescriptors: nil) { _, samples, error in
                guard error == nil || (error as? HKError)?.code == .errorNoData
                else { completion(.failure(.unreadable)); return }
                finish(Self.sleep(samples as? [HKCategorySample] ?? [], start, end, granularity))
            }
            store.execute(query)
        } else {
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
            let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 50,
                                      sortDescriptors: [sort]) { _, samples, error in
                guard error == nil || (error as? HKError)?.code == .errorNoData
                else { completion(.failure(.unreadable)); return }
                finish(Self.workouts(samples as? [HKWorkout] ?? []))
            }
            store.execute(query)
        }
    }

    private func readQuantity(metric: String, type: HKQuantityType, predicate: NSPredicate, start: Date, end: Date,
                              granularity: String, finish: @escaping ([String: Any]) -> Void,
                              failed: @escaping () -> Void) {
        let (unit, unitName) = Self.unit(metric)
        let sum = Self.cumulative.contains(metric)
        let options: HKStatisticsOptions = sum ? .cumulativeSum : [.discreteAverage, .discreteMin, .discreteMax]
        let row: (HKStatistics?, Date, Date) -> [String: Any] = { statistics, from, to in
            var value: [String: Any] = ["start": Self.iso.string(from: from), "end": Self.iso.string(from: to)]
            if sum {
                value["sum"] = Self.round(statistics?.sumQuantity()?.doubleValue(for: unit) ?? 0)
            } else if let average = statistics?.averageQuantity() {
                value["average"] = Self.round(average.doubleValue(for: unit))
                value["min"] = Self.round(statistics?.minimumQuantity()?.doubleValue(for: unit) ?? 0)
                value["max"] = Self.round(statistics?.maximumQuantity()?.doubleValue(for: unit) ?? 0)
            }
            return value
        }
        let done: ([[String: Any]]) -> Void = { values in
            finish(["unit": unitName, "granularity": granularity, "values": values])
        }
        if granularity == "total" {
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate,
                                          options: options) { _, statistics, error in
                guard error == nil || (error as? HKError)?.code == .errorNoData else { failed(); return }
                done([row(statistics, start, end)])
            }
            store.execute(query)
            return
        }
        let ranges = Self.buckets(start, end, granularity)
        guard let anchor = ranges.first?.0 else { done([]); return }
        let interval = granularity == "hour" ? DateComponents(hour: 1) : DateComponents(day: 1)
        let anchorDate = granularity == "hour"
            ? Calendar.current.dateInterval(of: .hour, for: anchor)?.start ?? anchor
            : Calendar.current.startOfDay(for: anchor)
        let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                                                options: options, anchorDate: anchorDate,
                                                intervalComponents: interval)
        query.initialResultsHandler = { _, collection, error in
            guard error == nil || (error as? HKError)?.code == .errorNoData else { failed(); return }
            done(ranges.map { from, to in row(collection?.statistics(for: from), from, to) })
        }
        store.execute(query)
    }

    // Overlapping samples from several sources are merged before summing.
    private static func sleep(_ samples: [HKCategorySample], _ start: Date, _ end: Date,
                              _ granularity: String) -> [String: Any] {
        // Raw values: 0 in bed, 1 asleep (unspecified), 2 awake, 3 core, 4 deep, 5 REM.
        func merged(_ values: Set<Int>) -> [(Date, Date)] {
            let intervals = samples
                .filter { values.contains($0.value) }
                .map { (max($0.startDate, start), min($0.endDate, end)) }
                .filter { $0.0 < $0.1 }
                .sorted { $0.0 < $1.0 }
            var result: [(Date, Date)] = []
            for interval in intervals {
                if let last = result.last, interval.0 <= last.1 {
                    result[result.count - 1].1 = max(last.1, interval.1)
                } else {
                    result.append(interval)
                }
            }
            return result
        }
        let asleep = merged([1, 3, 4, 5])
        let inBed = merged([0, 1, 2, 3, 4, 5])
        // A night belongs to the bucket in which it ends.
        let values: [[String: Any]] = buckets(start, end, granularity).map { from, to in
            func minutes(_ intervals: [(Date, Date)]) -> Double {
                round(intervals.filter { $0.1 > from && $0.1 <= to }
                    .reduce(0) { $0 + $1.1.timeIntervalSince($1.0) } / 60)
            }
            return ["start": iso.string(from: from), "end": iso.string(from: to),
                    "asleep_minutes": minutes(asleep), "in_bed_minutes": minutes(inBed)]
        }
        return ["unit": "min", "granularity": granularity, "values": values]
    }

    private static func workouts(_ samples: [HKWorkout]) -> [String: Any] {
        let rows: [[String: Any]] = samples.map { workout in
            var row: [String: Any] = [
                "type": activityName(workout.workoutActivityType),
                "start": iso.string(from: workout.startDate),
                "end": iso.string(from: workout.endDate),
                "minutes": round(workout.duration / 60),
            ]
            if let energy = workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) {
                row["active_kcal"] = round(energy)
            }
            if let distance = workout.totalDistance?.doubleValue(for: .meterUnit(with: .kilo)) {
                row["km"] = round(distance)
            }
            return row
        }
        return ["workouts": rows, "truncated": samples.count >= 50]
    }

    private static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .hiking: return "hiking"
        case .yoga: return "yoga"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "strength training"
        case .highIntensityIntervalTraining: return "high-intensity interval training"
        case .elliptical: return "elliptical"
        case .rowing: return "rowing"
        case .coreTraining: return "core training"
        case .pilates: return "pilates"
        case .dance, .cardioDance, .socialDance: return "dance"
        case .tennis: return "tennis"
        case .basketball: return "basketball"
        case .soccer: return "soccer"
        case .stairClimbing, .stairs: return "stairs"
        case .mixedCardio: return "mixed cardio"
        case .cooldown: return "cooldown"
        default: return "other"
        }
    }
}
