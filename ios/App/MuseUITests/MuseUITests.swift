import XCTest

// Explicit opt-in: these tests use a real account and may incur MA usage.
// Supply the key through the simulator clipboard, never source or launch env.
#if MUSE_LIVE_TESTS
final class MuseLiveUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.openmuse.mobile")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchEnvironment["MUSE_UI_TESTING"] = "1"
        app.launchEnvironment["MUSE_UI_TEST_ENDPOINT"] = "http://127.0.0.1:4313"
        app.launch()
    }

    private func tap(_ element: XCUIElement, timeout: TimeInterval = 20) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), app.debugDescription)
        element.tap()
    }

    private func contains(_ text: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func settings() {
        tap(app.buttons["Open sidebar"])
        tap(app.links.matching(NSPredicate(format: "label CONTAINS %@", "Settings & connections")).firstMatch)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRealAPIKeyConversationAndRelaunch() {
        settings()
        tap(app.switches["API Key"])
        let key = app.secureTextFields["Ark API Key"]
        tap(key)
        key.press(forDuration: 1.2)
        let paste = app.menuItems["Paste"]
        tap(paste)
        tap(app.buttons["Done"])
        tap(app.buttons["Connect with API Key"])
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 40), app.debugDescription)
        capture("live-01-api-key-connected")
        tap(app.links["Chat"])
        let input = app.textViews["Describe your task"]
        tap(input)
        input.typeText("Do not use tools. Remember the marker pine-918. Calculate 17 + 25. Reply exactly: pine-918 / 42")
        tap(app.buttons["Send task"])
        XCTAssertTrue(app.buttons["Save"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(app.staticTexts["pine-918 / 42"].exists, app.debugDescription)
        capture("live-02-real-answer")
        let followup = app.textViews["Continue conversation"]
        tap(followup)
        followup.typeText("Recall the marker and double the previous numeric result. Do not use tools. Reply in the same format.")
        tap(app.buttons["Send task"])
        XCTAssertTrue(contains("pine-918 / 84").waitForExistence(timeout: 120), app.debugDescription)
        capture("live-03-context")
        tap(app.buttons["Save"].firstMatch)
        XCTAssertTrue(contains("Saved to Library").waitForExistence(timeout: 10))
        tap(app.links["Library"])
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "pine-918")).firstMatch.waitForExistence(timeout: 15))
        capture("live-04-library")
        app.terminate()
        app.launch()
        settings()
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 20), "Login must survive iOS relaunch")
        capture("live-05-relaunch")
        tap(app.links["Library"])
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "pine-918")).firstMatch)
        tap(app.links["View source conversation"])
        XCTAssertTrue(contains("pine-918 / 84").waitForExistence(timeout: 30), app.debugDescription)
        capture("live-06-restored-conversation")
    }

    func testWebFetchAutoApproval() {
        // Requires the prior opt-in login test, or an existing Keychain session.
        settings()
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 20))
        tap(app.links["Chat"])
        let input = app.textViews["Describe your task"]
        tap(input)
        input.typeText("Use web_fetch to read https://example.com . Do not use other tools. Report the exact title and one sentence about the page. Do not answer from memory.")
        tap(app.buttons["Send task"])
        XCTAssertTrue(app.buttons["Save"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(contains("Example Domain").exists, app.debugDescription)
        XCTAssertFalse(app.buttons["Approve"].exists)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "View execution log")).firstMatch)
        XCTAssertTrue(contains("web_fetch").waitForExistence(timeout: 15), app.debugDescription)
        capture("live-07-web-fetch-auto-approval")
    }

    func testDirectToolExecution() {
        // Existing Keychain login; no credential injection or external writes.
        settings()
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 20))
        tap(app.links["Chat"])
        let input = app.textViews["Describe your task"]
        tap(input)
        input.typeText("Use bash to run this read-only command: printf 'muse-direct-%s\\n' 84 . Report its output. Do not modify any files or use other tools.")
        tap(app.buttons["Send task"])
        XCTAssertTrue(app.buttons["Save"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(contains("muse-direct-84").exists, app.debugDescription)
        XCTAssertFalse(app.buttons["Approve"].exists)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "View execution log")).firstMatch)
        XCTAssertTrue(contains("bash").waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(contains("Web tool auto-approved").exists)
        capture("live-direct-tool-execution")
    }
}
#endif

final class MuseUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.openmuse.mobile")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchEnvironment["MUSE_UI_TESTING"] = "1"
        app.launchEnvironment["MUSE_UI_TEST_ENDPOINT"] = "http://127.0.0.1:4312"
        app.launch()
    }

    private func tap(_ element: XCUIElement, timeout: TimeInterval = 15) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), app.debugDescription)
        element.tap()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testGoalsChatLibraryAndRelaunch() {
        XCTAssertTrue(app.links["Chat"].waitForExistence(timeout: 20))
        capture("01-chat-home")
        tap(app.links["Inspiration"])
        XCTAssertTrue(app.staticTexts["Starter ideas"].waitForExistence(timeout: 10))
        capture("02-ideas")
        tap(app.links["Goals"])
        tap(app.buttons["New goal"])
        let name = "iOS E2E Goal " + String(Int(Date().timeIntervalSince1970))
        let title = app.textFields["What do you want to accomplish?"]
        tap(title)
        title.typeText(name)
        tap(app.buttons["Create goal"])
        let step = app.textFields["New step"]
        tap(step)
        step.typeText("Confirm travel dates")
        tap(app.buttons["Add step"])
        XCTAssertTrue(app.staticTexts["Confirm travel dates"].waitForExistence(timeout: 10))
        capture("03-goal-detail")
        tap(app.buttons["Have Muse plan this for me"])
        tap(app.buttons["Send task"])
        XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 25), app.debugDescription)
        capture("04-chat-answer")
        tap(app.buttons["Save"])
        XCTAssertTrue(app.staticTexts["Saved to Library"].waitForExistence(timeout: 10))
        tap(app.links["Library"])
        let saved = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15), app.debugDescription)
        capture("05-library")
        tap(saved)
        XCTAssertTrue(app.links["View source conversation"].waitForExistence(timeout: 10))
        capture("06-saved-document")
        tap(app.buttons["Close"])
        tap(app.links["Activity"])
        XCTAssertTrue(app.links.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch.waitForExistence(timeout: 10))
        capture("07-feed")
        app.terminate()
        app.launch()
        tap(app.links["Goals"])
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch)
        XCTAssertTrue(app.staticTexts["Confirm travel dates"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Resume goal conversation"].exists)
        capture("08-goal-persisted")
        tap(app.buttons["Pause goal"])
        XCTAssertTrue(app.buttons["Resume goal"].waitForExistence(timeout: 10))
        tap(app.buttons["Resume goal"])
        tap(app.buttons["Mark as completed"])
        XCTAssertTrue(app.buttons["Reopen"].waitForExistence(timeout: 10))
        tap(app.buttons["Close"])
        tap(app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Completed")).firstMatch)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch)
        XCTAssertTrue(app.buttons["Reopen"].exists)
        capture("09-completed-goal")
    }

    func testApprovalDenyAndAllow() {
        for decision in ["Deny", "Approve"] {
            tap(app.links["Chat"])
            let input = app.textViews["Describe your task"]
            tap(input)
            input.typeText("help me write an email and ask for approval")
            capture(decision == "Deny" ? "10-composer-editing" : "13-composer-editing")
            tap(app.buttons["Send task"])
            XCTAssertTrue(app.buttons[decision].waitForExistence(timeout: 20))
            // Pending approvals replace the composer with an approval hint.
            XCTAssertFalse(app.buttons["Send task"].exists)
            capture(decision == "Deny" ? "11-approval-deny" : "14-approval-allow")
            tap(app.buttons[decision])
            let expected = decision == "Deny" ? "This action was denied" : "Approval received"
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch.waitForExistence(timeout: 20))
            XCTAssertFalse(app.buttons["Approve"].exists)
            capture(decision == "Deny" ? "12-rejected" : "15-approved")
        }
        tap(app.buttons["Open sidebar"])
        tap(app.links.matching(NSPredicate(format: "label CONTAINS %@", "Settings & connections")).firstMatch)
        capture("16-settings")
    }
}
