import XCTest

// Explicit opt-in: these tests use a real account and may incur MA usage.
// Supply the key through the simulator clipboard, never source or launch env.
#if MUSE_LIVE_TESTS
final class MuseLiveUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.openmuse.mobile")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchEnvironment["MUSE_UI_TESTING"] = "1"
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
        if !contains("Connected with API Key").waitForExistence(timeout: 3) {
            tap(app.switches["API Key"])
            let key = app.secureTextFields["Ark API Key"]
            tap(key)
            key.press(forDuration: 1.2)
            let paste = app.menuItems["Paste"]
            tap(paste)
            tap(app.buttons["Done"])
            tap(app.buttons["Connect with API Key"])
        }
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 40), app.debugDescription)
        capture("live-01-api-key-connected")
        tap(app.links["Chat"])
        let input = app.textViews["Describe your task"]
        tap(input)
        input.typeText("Do not use tools. Remember the marker pine-918. Calculate 17 + 25. Reply exactly: pine-918 / 42")
        tap(app.buttons["Send task"])
        XCTAssertTrue(app.buttons["Save"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(app.staticTexts["pine-918 / 42"].exists, app.debugDescription)
        XCTAssertFalse(contains("Demo content").exists)
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
        app.launchEnvironment["MUSE_UI_TEST_SIGNED_OUT"] = "1"
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

    func testSignedOutRequiresRealConnection() {
        let connect = app.links["Connect with SSO or API Key"]
        XCTAssertTrue(connect.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(app.buttons["Send task"].isEnabled)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Demo content")).firstMatch.exists)
        capture("signed-out-real-connection-required")
        tap(connect)
        XCTAssertTrue(app.buttons["Start SSO sign-in"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.switches["API Key"].exists)
        XCTAssertFalse(app.staticTexts["Service connection"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Advanced setup")).firstMatch.exists)
        capture("signed-out-login-options")
    }
}
