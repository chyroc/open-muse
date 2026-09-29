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
        tap(app.buttons["打开侧边栏"])
        tap(app.links.matching(NSPredicate(format: "label CONTAINS %@", "设置与连接")).firstMatch)
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
        let key = app.secureTextFields["方舟 API Key"]
        tap(key)
        key.press(forDuration: 1.2)
        let paste = app.menuItems.matching(NSPredicate(format: "label IN %@", ["Paste", "粘贴"])).firstMatch
        tap(paste)
        tap(app.buttons["Done"])
        tap(app.buttons["连接 API Key"])
        XCTAssertTrue(contains("API Key 已连接").waitForExistence(timeout: 40), app.debugDescription)
        capture("live-01-api-key-connected")
        tap(app.links["聊天"])
        let input = app.textViews["描述你的任务"]
        tap(input)
        input.typeText("Do not use tools. Remember the marker pine-918. Calculate 17 + 25. Reply exactly: pine-918 / 42")
        tap(app.buttons["发送任务"])
        XCTAssertTrue(app.buttons["收藏"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(app.staticTexts["pine-918 / 42"].exists, app.debugDescription)
        capture("live-02-real-answer")
        let followup = app.textViews["继续对话"]
        tap(followup)
        followup.typeText("Recall the marker and double the previous numeric result. Do not use tools. Reply in the same format.")
        tap(app.buttons["发送任务"])
        XCTAssertTrue(contains("pine-918 / 84").waitForExistence(timeout: 120), app.debugDescription)
        capture("live-03-context")
        tap(app.buttons["收藏"].firstMatch)
        XCTAssertTrue(contains("已收藏到资料库").waitForExistence(timeout: 10))
        tap(app.links["资料库"])
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "pine-918")).firstMatch.waitForExistence(timeout: 15))
        capture("live-04-library")
        app.terminate()
        app.launch()
        settings()
        XCTAssertTrue(contains("API Key 已连接").waitForExistence(timeout: 20), "Login must survive iOS relaunch")
        capture("live-05-relaunch")
        tap(app.links["资料库"])
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "pine-918")).firstMatch)
        tap(app.links["查看来源对话"])
        XCTAssertTrue(contains("pine-918 / 84").waitForExistence(timeout: 30), app.debugDescription)
        capture("live-06-restored-conversation")
    }

    func testWebFetchAutoApproval() {
        // Requires the prior opt-in login test, or an existing Keychain session.
        settings()
        XCTAssertTrue(contains("API Key 已连接").waitForExistence(timeout: 20))
        tap(app.links["聊天"])
        let input = app.textViews["描述你的任务"]
        tap(input)
        input.typeText("Use web_fetch to read https://example.com . Do not use other tools. Report the exact title and one sentence about the page. Do not answer from memory.")
        tap(app.buttons["发送任务"])
        XCTAssertTrue(app.buttons["收藏"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(contains("Example Domain").exists, app.debugDescription)
        XCTAssertFalse(app.buttons["允许这一次"].exists)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "查看执行记录")).firstMatch)
        XCTAssertTrue(contains("web_fetch").waitForExistence(timeout: 15), app.debugDescription)
        capture("live-07-web-fetch-auto-approval")
    }

    func testDirectToolExecution() {
        // Existing Keychain login; no credential injection or external writes.
        settings()
        XCTAssertTrue(contains("API Key 已连接").waitForExistence(timeout: 20))
        tap(app.links["聊天"])
        let input = app.textViews["描述你的任务"]
        tap(input)
        input.typeText("Use bash to run this read-only command: printf 'muse-direct-%s\\n' 84 . Report its output. Do not modify any files or use other tools.")
        tap(app.buttons["发送任务"])
        XCTAssertTrue(app.buttons["收藏"].firstMatch.waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertTrue(contains("muse-direct-84").exists, app.debugDescription)
        XCTAssertFalse(app.buttons["允许这一次"].exists)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "查看执行记录")).firstMatch)
        XCTAssertTrue(contains("bash").waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(contains("已自动批准网页工具").exists)
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
        XCTAssertTrue(app.links["聊天"].waitForExistence(timeout: 20))
        capture("01-chat-home")
        tap(app.links["灵感"])
        XCTAssertTrue(app.staticTexts["起步建议"].waitForExistence(timeout: 10))
        capture("02-ideas")
        tap(app.links["目标"])
        tap(app.buttons["新建目标"])
        let name = "iOS E2E Goal " + String(Int(Date().timeIntervalSince1970))
        let title = app.textFields["想完成什么？"]
        tap(title)
        title.typeText(name)
        tap(app.buttons["创建目标"])
        let step = app.textFields["新步骤"]
        tap(step)
        step.typeText("Confirm travel dates")
        tap(app.buttons["添加步骤"])
        XCTAssertTrue(app.staticTexts["Confirm travel dates"].waitForExistence(timeout: 10))
        capture("03-goal-detail")
        tap(app.buttons["让 Muse 帮我规划"])
        tap(app.buttons["发送任务"])
        XCTAssertTrue(app.buttons["收藏"].waitForExistence(timeout: 25), app.debugDescription)
        capture("04-chat-answer")
        tap(app.buttons["收藏"])
        XCTAssertTrue(app.staticTexts["已收藏到资料库"].waitForExistence(timeout: 10))
        tap(app.links["资料库"])
        let saved = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15), app.debugDescription)
        capture("05-library")
        tap(saved)
        XCTAssertTrue(app.links["查看来源对话"].waitForExistence(timeout: 10))
        capture("06-saved-document")
        tap(app.buttons["关闭"])
        tap(app.links["动态"])
        XCTAssertTrue(app.links.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch.waitForExistence(timeout: 10))
        capture("07-feed")
        app.terminate()
        app.launch()
        tap(app.links["目标"])
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch)
        XCTAssertTrue(app.staticTexts["Confirm travel dates"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["继续目标对话"].exists)
        capture("08-goal-persisted")
        tap(app.buttons["暂停目标"])
        XCTAssertTrue(app.buttons["恢复目标"].waitForExistence(timeout: 10))
        tap(app.buttons["恢复目标"])
        tap(app.buttons["标记完成"])
        XCTAssertTrue(app.buttons["重新开启"].waitForExistence(timeout: 10))
        tap(app.buttons["关闭"])
        tap(app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "已完成")).firstMatch)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch)
        XCTAssertTrue(app.buttons["重新开启"].exists)
        capture("09-completed-goal")
    }

    func testApprovalDenyAndAllow() {
        for decision in ["拒绝", "允许这一次"] {
            tap(app.links["聊天"])
            let input = app.textViews["描述你的任务"]
            tap(input)
            input.typeText("帮我写一封邮件并请求批准")
            capture(decision == "拒绝" ? "10-composer-editing" : "13-composer-editing")
            tap(app.buttons["发送任务"])
            XCTAssertTrue(app.buttons[decision].waitForExistence(timeout: 20))
            // Pending approvals replace the composer with an approval hint.
            XCTAssertFalse(app.buttons["发送任务"].exists)
            capture(decision == "拒绝" ? "11-approval-deny" : "14-approval-allow")
            tap(app.buttons[decision])
            let expected = decision == "拒绝" ? "已拒绝这次操作" : "已收到批准"
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch.waitForExistence(timeout: 20))
            XCTAssertFalse(app.buttons["允许这一次"].exists)
            capture(decision == "拒绝" ? "12-rejected" : "15-approved")
        }
        tap(app.buttons["打开侧边栏"])
        tap(app.links.matching(NSPredicate(format: "label CONTAINS %@", "设置与连接")).firstMatch)
        capture("16-settings")
    }
}
