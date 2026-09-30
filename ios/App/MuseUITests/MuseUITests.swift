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

    private func enterMessage(_ text: String) {
        let input = app.textViews["Message Muse"]
        tap(input, timeout: 40)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) {
            input.tap()
        }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "Message field must have keyboard focus before typing")
        input.typeText(text)
    }

    private func settings() {
        tap(app.buttons["Open sidebar"])
        if !app.links["Settings"].waitForExistence(timeout: 3) {
            tap(app.buttons["Open sidebar"])
        }
        tap(app.links["Settings"])
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRealAPIKeyConversationAndRelaunch() {
        let marker = "saved-" + String(UUID().uuidString.prefix(8)).lowercased()
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
            XCTAssertTrue(app.buttons["Open sidebar"].waitForExistence(timeout: 40))
            settings()
        }
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 40), app.debugDescription)
        capture("live-01-api-key-connected")
        tap(app.links["Chat"])
        enterMessage("Do not use tools. Remember the marker \(marker). Calculate 17 + 25. Reply exactly: \(marker) / 42")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["\(marker) / 42"].waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertFalse(contains("Demo content").exists)
        capture("live-02-real-answer")
        enterMessage("Recall the marker and double the previous numeric result. Do not use tools. Reply in the same format.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(contains("\(marker) / 84").waitForExistence(timeout: 120), app.debugDescription)
        capture("live-03-context")
        app.staticTexts["\(marker) / 84"].press(forDuration: 1.2)
        tap(app.buttons["Save reply"])
        XCTAssertTrue(contains("Saved to Library").waitForExistence(timeout: 10))
        tap(app.links["Library"])
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Main chat")).firstMatch.waitForExistence(timeout: 15))
        capture("live-04-library")
        app.terminate()
        app.launch()
        settings()
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 20), "Login must survive iOS relaunch")
        capture("live-05-relaunch")
        tap(app.links["Library"])
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Main chat")).firstMatch)
        tap(app.links["View source conversation"])
        XCTAssertTrue(contains("\(marker) / 84").waitForExistence(timeout: 30), app.debugDescription)
        capture("live-06-restored-conversation")
    }

    func testWebFetchAutoApproval() {
        // Requires the prior opt-in login test, or an existing Keychain session.
        settings()
        XCTAssertTrue(contains("Connected with API Key").waitForExistence(timeout: 20))
        tap(app.links["Chat"])
        let input = app.textViews["Message Muse"]
        tap(input)
        input.typeText("Use web_fetch to read https://example.com . Do not use other tools. Report the exact title and one sentence about the page. Do not answer from memory.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(contains("Example Domain").waitForExistence(timeout: 180), app.debugDescription)
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
        let input = app.textViews["Message Muse"]
        tap(input)
        input.typeText("Use bash to run this read-only command: printf 'muse-direct-%s\\n' 84 . Report its output. Do not modify any files or use other tools.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["muse-direct-84"].waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertFalse(app.buttons["Approve"].exists)
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "View execution log")).firstMatch)
        XCTAssertTrue(contains("bash").waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(contains("Web tool auto-approved").exists)
        capture("live-direct-tool-execution")
    }

    func testPersistentMainAndSideChats() {
        let marker = "main-" + String(UUID().uuidString.prefix(8)).lowercased()
        enterMessage("Do not use tools. Remember the marker \(marker). Calculate 17 + 25. Reply exactly: \(marker) / 42")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["\(marker) / 42"].waitForExistence(timeout: 180), app.debugDescription)
        capture("main-chat-first-reply")
        enterMessage("Recall the marker from my last message and double the result. No tools. Reply only in the same format.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["\(marker) / 84"].waitForExistence(timeout: 120), app.debugDescription)
        tap(app.buttons["Open sidebar"])
        capture("main-chat-sidebar")
        tap(app.buttons["New side chat"])
        let sideMarker = "side-" + marker
        let sidePrompt = "No tools. Reply with only \(sideMarker)."
        enterMessage(sidePrompt)
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts[sideMarker].waitForExistence(timeout: 180), app.debugDescription)
        capture("side-chat-reply")
        tap(app.links["Chat"])
        XCTAssertTrue(app.staticTexts["\(marker) / 84"].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(app.staticTexts[sideMarker].exists)
        tap(app.buttons["Open sidebar"])
        tap(app.buttons["Archive \(String(sidePrompt.prefix(60)))"])
        tap(app.switches["Show archived chats"])
        XCTAssertTrue(app.links[sidePrompt].waitForExistence(timeout: 20), app.debugDescription)
        capture("side-chat-archived")
        tap(app.buttons["Restore \(String(sidePrompt.prefix(60)))"])
        tap(app.switches["Show side chats"])
        XCTAssertTrue(app.links[sidePrompt].waitForExistence(timeout: 20), app.debugDescription)
        tap(app.buttons["Close sidebar"])
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["\(marker) / 84"].waitForExistence(timeout: 40), app.debugDescription)
        capture("main-chat-after-relaunch")
    }

    private func openIdentity() {
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", " status: ")).firstMatch, timeout: 40)
        tap(app.buttons["Identity"])
        XCTAssertTrue(app.buttons["Open MEMORY.md"].waitForExistence(timeout: 40))
        let ready = NSPredicate(format: "isEnabled == true")
        expectation(for: ready, evaluatedWith: app.buttons["Open MEMORY.md"])
        waitForExpectations(timeout: 40)
    }

    private func replaceDocument(_ file: String, with content: String) {
        tap(app.buttons["Edit \(file)"])
        let field = app.textViews["Edit \(file) content"]
        tap(field)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        field.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 3) { tap(app.menuItems["Select All"]) }
        else {
            // The hardware-style select-all shortcut is supported by Simulator.
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count))
        }
        field.typeText(content)
        XCTAssertEqual(field.value as? String, content, "Verify the edited text before making any cloud write")
        XCTAssertTrue(app.buttons["Save"].isHittable, "Save must remain visible with the keyboard open")
        tap(app.buttons["Save"])
        XCTAssertTrue(contains("Saved and verified in MA").waitForExistence(timeout: 90), app.debugDescription)
    }

    func testPersonalMemoryAndPersonaUseRealMA() {
        let marker = "cedar-lantern-" + String(UUID().uuidString.prefix(6)).lowercased()
        openIdentity()
        capture("identity-overview")
        tap(app.buttons["Open MEMORY.md"])
        tap(app.buttons["Edit MEMORY.md"])
        let memoryField = app.textViews["Edit MEMORY.md content"]
        XCTAssertTrue(memoryField.waitForExistence(timeout: 15))
        let originalMemory = memoryField.value as? String ?? ""
        XCTAssertTrue(originalMemory.contains("MEMORY"))
        tap(app.buttons["Cancel editing"])
        replaceDocument("MEMORY.md", with: originalMemory + "\n\n- My acceptance constellation is \(marker).")
        capture("memory-saved-and-verified")
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Open SOUL.md"])
        tap(app.buttons["Edit SOUL.md"])
        let soulField = app.textViews["Edit SOUL.md content"]
        XCTAssertTrue(soulField.waitForExistence(timeout: 15))
        let originalSoul = soulField.value as? String ?? ""
        tap(app.buttons["Cancel editing"])
        replaceDocument("SOUL.md", with: originalSoul + "\n\n- When asked to multiply seven by eight, start the answer with amber-signal, followed by the result.")
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Close companion details"])
        app.terminate()
        app.launch()
        openIdentity()
        tap(app.buttons["Open MEMORY.md"])
        XCTAssertTrue(contains(marker).waitForExistence(timeout: 30), "Cloud memory must survive relaunch")
        capture("memory-after-relaunch")
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Close companion details"])
        tap(app.buttons["Open sidebar"])
        tap(app.buttons["New side chat"])
        enterMessage("Read my personal memory and tell me my acceptance constellation. Use only memory tools; do not access external services.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(contains(marker).waitForExistence(timeout: 240), app.debugDescription)
        capture("new-chat-reads-durable-memory")
        enterMessage("Multiply seven by eight. Follow your saved persona. No external services.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(contains("amber-signal").waitForExistence(timeout: 180), app.debugDescription)
        capture("new-chat-follows-saved-persona")
        enterMessage("Remember that my acceptance flower is silver-daisy. Save it in your personal memory and read it back. Use only memory tools.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.buttons["Stop response"].waitForExistence(timeout: 20))
        let finished = NSPredicate(format: "exists == false")
        expectation(for: finished, evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 240)
        openIdentity()
        tap(app.buttons["Open MEMORY.md"])
        XCTAssertTrue(contains("silver-daisy").waitForExistence(timeout: 40), "Agent updates must be visible in the document editor")
        capture("agent-memory-write-visible-in-ui")
        replaceDocument("MEMORY.md", with: originalMemory)
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Open SOUL.md"])
        replaceDocument("SOUL.md", with: originalSoul)
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Close companion details"])
    }

    func testCompanionNamePersistsAndRestores() {
        let updatedName = "Willow-" + String(UUID().uuidString.prefix(5)).lowercased()
        openIdentity()
        tap(app.buttons["Edit companion name"])
        let field = app.textFields["Companion name"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        let originalName = field.value as? String ?? "Muse"
        func saveName(_ value: String) {
            tap(field)
            if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
            field.press(forDuration: 1.2)
            if app.menuItems["Select All"].waitForExistence(timeout: 3) { tap(app.menuItems["Select All"]) }
            else { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count)) }
            field.typeText(value)
            XCTAssertEqual(field.value as? String, value)
            tap(app.buttons["Save"])
            XCTAssertTrue(contains("Saved and verified in MA").waitForExistence(timeout: 90), app.debugDescription)
            tap(app.buttons["Close identity document"])
            tap(app.buttons["Close companion details"])
        }
        saveName(updatedName)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", updatedName + " status:")).firstMatch.waitForExistence(timeout: 20))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", updatedName + " status:")).firstMatch.waitForExistence(timeout: 40))
        capture("companion-name-after-relaunch")
        openIdentity()
        tap(app.buttons["Edit companion name"])
        saveName(originalName)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", originalName + " status:")).firstMatch.waitForExistence(timeout: 20))
    }

    // Run against the previous installed bundle before syncing the continuation
    // implementation. This creates a real legacy context, not a fake transcript.
    func testSeedLegacyMainForContinuation() {
        enterMessage("For our handoff test, the marker is oak-river-731 and the result is 42. Keep this in this conversation only, not durable memory. Do not use tools. Reply exactly: oak-river-731 / 42")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["oak-river-731 / 42"].waitForExistence(timeout: 180), app.debugDescription)
        capture("legacy-main-context-before-update")
    }

    func testMainContinuationPreservesContextAndMemory() {
        XCTAssertTrue(app.staticTexts["oak-river-731 / 42"].waitForExistence(timeout: 40), "The original main history must be loaded before migration")
        openIdentity()
        tap(app.buttons["Open MEMORY.md"])
        tap(app.buttons["Edit MEMORY.md"])
        let originalMemory = app.textViews["Edit MEMORY.md content"].value as? String ?? ""
        XCTAssertTrue(originalMemory.contains("MEMORY"))
        tap(app.buttons["Cancel editing"])
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Close companion details"])
        enterMessage("Recall the handoff marker I gave you and double that earlier numeric result. Use only memory tools. Reply in the same marker / result format.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["oak-river-731 / 84"].waitForExistence(timeout: 240), app.debugDescription)
        XCTAssertTrue(app.staticTexts["oak-river-731 / 42"].exists, "Earlier bubbles must remain in the same chat")
        capture("continued-main-preserves-history-and-context")
        openIdentity()
        XCTAssertTrue(contains("Personal memory is attached to this conversation.").waitForExistence(timeout: 40))
        capture("main-personal-memory-attached")
        tap(app.buttons["Close companion details"])
        enterMessage("Remember that my main-chat testing color is dawn-copper. Save it to personal memory and read it back. Use only memory tools.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.buttons["Stop response"].waitForExistence(timeout: 20))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 240)
        openIdentity()
        tap(app.buttons["Open MEMORY.md"])
        XCTAssertTrue(contains("dawn-copper").waitForExistence(timeout: 40), app.debugDescription)
        capture("main-agent-writes-personal-memory")
        replaceDocument("MEMORY.md", with: originalMemory)
        tap(app.buttons["Close identity document"])
        tap(app.buttons["Close companion details"])
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["oak-river-731 / 84"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.staticTexts["oak-river-731 / 42"].exists)
        capture("continued-main-after-relaunch")
    }

    func testGoalStateSurvivesRelaunch() {
        tap(app.links["Goals"], timeout: 40)
        if !app.buttons["Goals options"].waitForExistence(timeout: 3) { tap(app.links["Goals"]) }
        tap(app.buttons["Goals options"])
        tap(app.buttons["Completed goals"])
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Open goal: Goal-check-")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 60))
        let originalName = saved.label.replacingOccurrences(of: "Open goal: ", with: "")
        tap(saved, timeout: 60)
        XCTAssertTrue(app.buttons["Mark as active"].waitForExistence(timeout: 15))
        let checkboxes = app.checkBoxes
        if checkboxes.count == 2 {
            XCTAssertEqual(checkboxes.element(boundBy: 0).value as? String, "1")
            XCTAssertEqual(checkboxes.element(boundBy: 1).value as? String, "1")
        } else {
            XCTAssertEqual(app.switches["Read one screen-break tip"].value as? String, "1")
            XCTAssertEqual(app.switches["Write one reminder note"].value as? String, "1")
        }
        capture("goals-latest-build-persisted-cloud-progress")
        // Only rename the synthetic acceptance goal, then restore its name.
        func renameGoal(_ name: String) {
            tap(app.buttons["Rename goal"])
            let field = app.textFields["Goal name"]
            tap(field)
            if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
            let previous = field.value as? String ?? ""
            field.press(forDuration: 1.2)
            if app.menuItems["Select All"].waitForExistence(timeout: 3) { tap(app.menuItems["Select All"]) }
            else { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count)) }
            field.typeText(name)
            XCTAssertEqual(field.value as? String, name)
            XCTAssertTrue(app.buttons["Save name"].isHittable)
            XCTAssertLessThan(app.buttons["Save name"].frame.maxY, app.keyboards.firstMatch.frame.minY)
            capture("goal-rename-keyboard-save-visible")
            tap(app.buttons["Save name"])
            XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 60))
        }
        renameGoal(originalName + "-edited")
        app.terminate()
        app.launch()
        tap(app.links["Goals"], timeout: 40)
        if !app.buttons["Goals options"].waitForExistence(timeout: 3) { tap(app.links["Goals"]) }
        tap(app.buttons["Goals options"])
        tap(app.buttons["Completed goals"])
        tap(app.buttons["Open goal: \(originalName)-edited"], timeout: 60)
        renameGoal(originalName)
        capture("goals-name-restore-verified")
        tap(app.buttons["Close"])
        tap(app.buttons["Close"])
        app.terminate()
        app.launch()
        tap(app.links["Goals"], timeout: 40)
        if !app.staticTexts["Tracking"].waitForExistence(timeout: 3) { tap(app.links["Goals"]) }
        XCTAssertTrue(app.staticTexts["Nothing is being tracked yet"].waitForExistence(timeout: 60))
        capture("goals-latest-build-categories")
    }

    func testGoalConversationAndCloudProgress() {
        let marker = "Goal-check-" + String(UUID().uuidString.prefix(6)).lowercased()
        tap(app.links["Goals"], timeout: 40)
        if !app.buttons["Create a health goal"].waitForExistence(timeout: 3) { tap(app.links["Goals"]) }
        XCTAssertTrue(app.staticTexts["Tracking"].waitForExistence(timeout: 20))
        capture("goals-categories")
        tap(app.buttons["Create a health goal"])
        XCTAssertTrue(contains("First, we’ll work out your goal together in chat.").waitForExistence(timeout: 15))
        capture("goal-category-chat-introduction")
        tap(app.buttons["Continue in chat"])
        let input = app.textViews["Message Muse"]
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        XCTAssertTrue((input.value as? String ?? "").contains("before saving a plan"))
        capture("goal-editable-conversation-starter")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.buttons["Stop response"].waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 240)
        capture("goal-real-clarification")
        enterMessage("This is a synthetic app acceptance goal, not medical advice. Save this agreed plan to personal goals now. Title: \(marker). Category: health. Outcome: learn to take a short screen break over the next week. Exactly two steps: Read one screen-break tip; Write one reminder note. Both steps are not done yet. Use only personal memory tools, preserve all other goals, and read the saved goal back. Do not schedule anything or use external services.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.buttons["Stop response"].waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 240)
        capture("goal-plan-saved-by-real-ma")
        tap(app.links["Goals"])
        tap(app.buttons["Open goal: \(marker)"], timeout: 60)
        XCTAssertTrue(app.staticTexts["Read one screen-break tip"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Write one reminder note"].exists)
        capture("goal-cloud-plan-details")
        let firstStep = app.checkBoxes["Read one screen-break tip"]
        if firstStep.exists { tap(firstStep) }
        else { tap(app.switches["Read one screen-break tip"]) }
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: app.buttons["Talk about this goal"])
        waitForExpectations(timeout: 60)
        tap(app.buttons["Talk about this goal"])
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        tap(input)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { input.tap() }
        let existing = input.value as? String ?? ""
        input.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 3) { tap(app.menuItems["Select All"]) }
        else { input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count)) }
        let progress = "For the saved goal \(marker), report which step is already complete from personal memory, then record that I have now finished Write one reminder note too. Keep the goal active so I can complete it in the app. Read back the updated record. Use only memory tools; preserve all other goals."
        input.typeText(progress)
        XCTAssertEqual(input.value as? String, progress)
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.buttons["Stop response"].waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 240)
        capture("goal-agent-reads-and-updates-progress")
        tap(app.links["Goals"])
        tap(app.buttons["Open goal: \(marker)"], timeout: 60)
        capture("goal-all-steps-completed")
        tap(app.buttons["Mark as completed"])
        XCTAssertTrue(app.buttons["Mark as active"].waitForExistence(timeout: 60))
        tap(app.buttons["Close"])
        app.terminate()
        app.launch()
        tap(app.links["Goals"], timeout: 40)
        if !app.buttons["Goals options"].waitForExistence(timeout: 3) { tap(app.links["Goals"]) }
        tap(app.buttons["Goals options"])
        tap(app.buttons["Completed goals"])
        tap(app.buttons["Open goal: \(marker)"], timeout: 60)
        XCTAssertTrue(app.buttons["Mark as active"].exists)
        capture("goal-completion-survives-relaunch")
        tap(app.buttons["Close"])
        tap(app.buttons["Close"])
    }

    func testPersonalizedFeedAndIdeasUseRealMA() {
        tap(app.links["Feed"])
        tap(app.buttons["Edit feed instructions"])
        let field = app.textViews["Feed instructions text"]
        XCTAssertTrue(field.waitForExistence(timeout: 40))
        let original = field.value as? String ?? ""
        XCTAssertFalse(original.isEmpty)
        let marker = "field-guide-" + String(UUID().uuidString.prefix(6)).lowercased()
        func replaceInstructions(_ value: String) {
            tap(field)
            if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
            field.press(forDuration: 1.2)
            if app.menuItems["Select All"].waitForExistence(timeout: 3) { tap(app.menuItems["Select All"]) }
            else { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count)) }
            field.typeText(value)
            XCTAssertEqual(field.value as? String, value)
            XCTAssertTrue(app.buttons["Save"].isHittable)
            tap(app.buttons["Save"])
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: field)
            waitForExpectations(timeout: 90)
        }
        replaceInstructions("Write in English. Include \(marker) in every post title. Use web_fetch to read https://example.com and write exactly two concise posts about its purpose. Include that page as a source. Do not invent personal facts or take external actions.")
        app.terminate()
        app.launch()
        tap(app.links["Feed"])
        tap(app.buttons["Edit feed instructions"])
        XCTAssertTrue(field.waitForExistence(timeout: 40))
        XCTAssertTrue((field.value as? String ?? "").contains(marker))
        tap(app.buttons["Close feed instructions"])
        // The instruction card can place the first-generation button below the fold.
        for _ in 0..<4 {
            if app.buttons["Find new posts"].isHittable { break }
            app.swipeUp()
        }
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: app.buttons["Find new posts"])
        waitForExpectations(timeout: 300)
        tap(app.buttons["Find new posts"])
        let generatedPost = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Feed post:", marker)).firstMatch
        XCTAssertTrue(generatedPost.waitForExistence(timeout: 300), app.debugDescription)
        let liked = app.switches["Like post"].firstMatch
        // Restore cloud preferences before asserting generated content details.
        tap(app.buttons["Edit feed instructions"])
        XCTAssertTrue(field.waitForExistence(timeout: 40))
        replaceInstructions(original)
        for _ in 0..<4 { app.swipeUp() }
        capture("personalized-feed-real-ma")
        XCTAssertTrue(contains(marker).exists, app.debugDescription)
        if !liked.isHittable { app.swipeDown() }
        tap(liked)
        XCTAssertTrue(app.switches["Unlike post"].firstMatch.waitForExistence(timeout: 20))
        app.terminate()
        app.launch()
        tap(app.links["Feed"])
        XCTAssertTrue(app.switches["Unlike post"].firstMatch.waitForExistence(timeout: 30))
        if app.buttons["Got it"].exists { tap(app.buttons["Got it"]) }
        tap(app.buttons["Discuss"].firstMatch)
        let message = app.textViews["Message Muse"]
        XCTAssertTrue(message.waitForExistence(timeout: 30))
        XCTAssertTrue((message.value as? String ?? "").contains(marker))
        XCTAssertTrue((message.value as? String ?? "").contains("example.com"))
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.buttons["Stop response"].waitForExistence(timeout: 30))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 240)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Reply options")).firstMatch.exists)
        capture("feed-discussion-real-ma")
        tap(app.links["Ideas"])
        tap(app.buttons["Find new ideas"])
        let idea = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "View idea")).firstMatch
        XCTAssertTrue(idea.waitForExistence(timeout: 300), app.debugDescription)
        tap(idea)
        XCTAssertTrue(app.buttons["Talk about this"].waitForExistence(timeout: 20))
        capture("personalized-idea-detail")
        tap(app.buttons["Close"])
    }

    func testInspirationPersistsWithoutNewGeneration() {
        tap(app.links["Feed"])
        if !app.buttons["Edit feed instructions"].waitForExistence(timeout: 3) {
            // Confirm navigation after the initial WKWebView activation.
            tap(app.links["Feed"])
        }
        XCTAssertTrue(app.buttons["Edit feed instructions"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(app.switches["Unlike post"].firstMatch.waitForExistence(timeout: 40), app.debugDescription)
        XCTAssertFalse(app.buttons["Got it"].exists, "Dismissed instruction card must stay dismissed")
        capture("feed-after-relaunch")
        tap(app.buttons["Edit feed instructions"])
        let field = app.textViews["Feed instructions text"]
        XCTAssertTrue(field.waitForExistence(timeout: 40))
        XCTAssertFalse((field.value as? String ?? "").contains("field-guide-"), "Synthetic test preferences must be restored")
        tap(app.buttons["Close feed instructions"])
        tap(app.links["Ideas"])
        let idea = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "View idea:")).firstMatch
        XCTAssertTrue(idea.waitForExistence(timeout: 40))
        let title = idea.label
        capture("ideas-after-relaunch")
        tap(idea)
        XCTAssertTrue(app.buttons["Talk about this"].waitForExistence(timeout: 15))
        capture("idea-detail-after-relaunch")
        tap(app.buttons["Close"])
        app.terminate()
        app.launch()
        tap(app.links["Ideas"])
        XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 40))
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
        let connect = app.links["Connect with SSO or API Key to start chatting"]
        XCTAssertTrue(connect.waitForExistence(timeout: 20), app.debugDescription)
        let input = app.textViews["Message Muse"]
        tap(input)
        input.typeText("Hello")
        XCTAssertFalse(app.buttons["Send message"].isEnabled)
        XCTAssertGreaterThanOrEqual(app.buttons["Open sidebar"].frame.minY, 40)
        XCTAssertLessThan(input.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Demo content")).firstMatch.exists)
        capture("signed-out-real-connection-required")
        tap(connect)
        XCTAssertTrue(app.buttons["Start SSO sign-in"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.switches["API Key"].exists)
        XCTAssertFalse(app.staticTexts["Service connection"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Advanced setup")).firstMatch.exists)
        capture("signed-out-login-options")
    }

    func testKeyboardKeepsChatControlsVisible() {
        let input = app.textViews["Message Muse"]
        tap(input, timeout: 30)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { input.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        input.typeText("A longer thought that wraps onto several lines, so the composer grows while the header stays visible above the conversation.")
        XCTAssertGreaterThanOrEqual(app.buttons["Open sidebar"].frame.minY, 40)
        XCTAssertTrue(app.buttons["Open sidebar"].isHittable)
        XCTAssertLessThan(input.frame.maxY, app.keyboards.firstMatch.frame.minY)
        capture("keyboard-visible-chat-layout")
        tap(app.buttons["Done"])
        XCTAssertTrue(app.links["Chat"].waitForExistence(timeout: 10))
        capture("keyboard-dismissed-chat-layout")
    }

    func testSignedOutIdentityIsReadOnly() {
        tap(app.buttons["Muse status: Not connected"], timeout: 30)
        tap(app.buttons["Identity"])
        tap(app.buttons["Open MEMORY.md"])
        XCTAssertTrue(app.staticTexts["Starting template — not saved to the cloud yet."].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Edit MEMORY.md"].isEnabled)
        capture("signed-out-memory-template")
        tap(app.buttons["Close identity document"])
        capture("signed-out-identity-cards")
        tap(app.buttons["Close companion details"])
        XCTAssertTrue(app.buttons["Open sidebar"].exists)
    }
}
