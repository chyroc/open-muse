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

    func testInlineChoicesUseRealMAAndSurviveRelaunch() {
        let marker = "Choice-check-" + String(UUID().uuidString.prefix(6)).lowercased()
        tap(app.buttons["Open sidebar"], timeout: 40)
        tap(app.buttons["New side chat"])
        let prompt = "\(marker): Ask me when to take a short walk. Offer Morning, After lunch, and Evening as tappable options. Do not use tools or save personal memory. After I choose, reply exactly: \(marker) / followed by my chosen label."
        enterMessage(prompt)
        tap(app.buttons["Send message"])
        let option = app.switches["Choose After lunch"]
        XCTAssertTrue(option.waitForExistence(timeout: 180), app.debugDescription)
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: option)
        waitForExpectations(timeout: 60)
        XCTAssertFalse(contains("```muse-choice").exists)
        capture("choice-real-ma-question")
        tap(option)
        XCTAssertTrue(app.staticTexts["After lunch"].waitForExistence(timeout: 20), "One tap must send the visible option as a user message")
        XCTAssertTrue(app.staticTexts["\(marker) / After lunch"].waitForExistence(timeout: 180), app.debugDescription)
        XCTAssertEqual(option.value as? String, "1")
        XCTAssertFalse(option.isEnabled)
        XCTAssertFalse(app.switches["Choose Morning"].isEnabled)
        capture("choice-real-ma-confirmed")
        app.terminate()
        app.launch()
        tap(app.buttons["Open sidebar"], timeout: 40)
        tap(app.links[String(prompt.prefix(60))], timeout: 30)
        XCTAssertTrue(option.waitForExistence(timeout: 40))
        XCTAssertEqual(option.value as? String, "1")
        XCTAssertFalse(option.isEnabled)
        XCTAssertTrue(app.staticTexts["\(marker) / After lunch"].exists)
        capture("choice-selection-after-relaunch")
        enterMessage("Now ask which color I prefer. Offer Blue and Green as tappable choices. I may type another answer. Do not use tools or save memory. After I answer, reply exactly: \(marker) / followed by my answer.")
        tap(app.buttons["Send message"])
        let blue = app.switches["Choose Blue"]
        XCTAssertTrue(blue.waitForExistence(timeout: 180), app.debugDescription)
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: blue)
        waitForExpectations(timeout: 60)
        enterMessage("Violet")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["\(marker) / Violet"].waitForExistence(timeout: 180))
        XCTAssertFalse(blue.isEnabled)
        XCTAssertEqual(blue.value as? String, "0")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 60)
        capture("choice-custom-answer-keeps-history")
    }

    func testAutomaticWelcomeNamingAndMemoryUseRealMA() {
        // A fresh profile isolates cloud resources, memory and local mappings,
        // while using the existing authorized Keychain login and production flow.
        let profile = "welcome-" + String(UUID().uuidString.prefix(8)).lowercased()
        UserDefaults.standard.set(profile, forKey: "lastWelcomeAcceptanceProfile")
        app.terminate()
        app.launchEnvironment["MUSE_UI_TEST_PROFILE"] = profile
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        capture("welcome-profile-\(profile)")
        let kit = app.switches["Choose Kit"]
        XCTAssertTrue(kit.waitForExistence(timeout: 240), app.debugDescription)
        XCTAssertTrue(app.switches["Choose Milo"].exists)
        XCTAssertTrue(app.switches["Choose Muse"].exists)
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: kit)
        waitForExpectations(timeout: 60)
        XCTAssertFalse(contains("<open-muse-welcome>").exists)
        XCTAssertFalse(contains("```muse-choice").exists)
        capture("welcome-real-first-greeting-and-name-options")
        tap(kit)
        XCTAssertTrue(app.staticTexts["Kit"].waitForExistence(timeout: 20), "One tap must submit the selected name")
        XCTAssertTrue(app.textViews["Message Kit"].waitForExistence(timeout: 180), "The header and composer must reflect the saved cloud name")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Stop response"])
        waitForExpectations(timeout: 120)
        XCTAssertEqual(kit.value as? String, "1")
        XCTAssertFalse(kit.isEnabled)
        let followUp = app.staticTexts.matching(NSPredicate(format: "label CONTAINS '?' AND NOT (label CONTAINS[c] 'call')"))
        XCTAssertGreaterThan(followUp.count, 0, "A real focused follow-up must follow the saved name: \(app.debugDescription)")
        capture("welcome-name-saved-with-proactive-follow-up")
        let marker = "welcome-color-" + String(UUID().uuidString.prefix(6)).lowercased()
        let input = app.textViews["Message Kit"]
        tap(input)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { input.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        input.typeText("Remember that my favorite imaginary color is \(marker). Save it in personal memory, then reply with only MEMORY SAVED. Do not use external services.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].waitForExistence(timeout: 180), app.debugDescription)
        let greetingCount = app.switches.matching(identifier: "Choose Kit").count
        app.terminate()
        app.launch()
        XCTAssertTrue(app.textViews["Message Kit"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.switches["Choose Kit"].waitForExistence(timeout: 60), "Wait for actual chat history, not only the independently restored name")
        XCTAssertEqual(app.switches.matching(identifier: "Choose Kit").count, greetingCount)
        XCTAssertEqual(app.switches["Choose Kit"].value as? String, "1")
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].exists)
        capture("welcome-name-and-chat-survive-relaunch")
        tap(app.buttons["Open sidebar"])
        tap(app.buttons["New side chat"])
        let sideInput = app.textViews["Message Kit"]
        tap(sideInput)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { sideInput.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        sideInput.typeText("Read my personal memory and reply with only my favorite imaginary color. No external services or memory changes.")
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 180), "A new MA session must read the saved preference: \(app.debugDescription)")
        capture("welcome-preference-recalled-in-new-ma-session")
        app.terminate()
        app.launchEnvironment.removeValue(forKey: "MUSE_UI_TEST_PROFILE")
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.textViews["Message Muse"].waitForExistence(timeout: 60), "The original identity must remain unchanged")
    }

    func testMainInstructionRefreshUsesRealMA() {
        guard let profile = UserDefaults.standard.string(forKey: "lastWelcomeAcceptanceProfile") else {
            XCTFail("Run the real automatic welcome case before this isolated main-chat refresh check")
            return
        }
        app.terminate()
        app.launchEnvironment["MUSE_UI_TEST_PROFILE"] = profile
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer {
            app.terminate()
            app.launchEnvironment.removeValue(forKey: "MUSE_UI_TEST_PROFILE")
            app.launchArguments = []
            app.launch()
        }
        XCTAssertTrue(app.textViews["Message Kit"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.switches["Choose Kit"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].exists)
        let input = app.textViews["Message Kit"]
        tap(input)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { input.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        if let savedDraft = input.value as? String, !savedDraft.isEmpty {
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: savedDraft.count))
        }
        input.typeText("Recall my favorite imaginary color and calculate 21 doubled. Use only memory tools; do not change any memory. Reply exactly with the color, followed by / 42.")
        tap(app.buttons["Send message"])
        let answer = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "welcome-color-[a-f0-9]{6} / 42")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 240), app.debugDescription)
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].exists, "Original chapter bubbles must remain in the same main chat")
        XCTAssertEqual(app.switches.matching(identifier: "Choose Kit").count, 1)
        XCTAssertEqual(app.switches["Choose Kit"].value as? String, "1")
        XCTAssertFalse(app.switches["Choose Kit"].isEnabled)
        capture("main-refresh-context-and-original-choice")
        let marker = "Refresh-choice-" + String(UUID().uuidString.prefix(6)).lowercased()
        UserDefaults.standard.set(marker, forKey: "lastPromptRefreshChoiceMarker")
        tap(input)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { input.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        input.typeText("\(marker): Ask when I would like a short walk, with Morning and Evening as tappable options. Do not use tools, save preferences or schedule anything. After I choose, reply exactly: \(marker) / followed by my chosen label.")
        tap(app.buttons["Send message"])
        let evening = app.switches["Choose Evening"]
        XCTAssertTrue(evening.waitForExistence(timeout: 180), app.debugDescription)
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: evening)
        waitForExpectations(timeout: 60)
        tap(evening)
        XCTAssertTrue(app.staticTexts["\(marker) / Evening"].waitForExistence(timeout: 180), app.debugDescription)
        capture("main-refresh-new-inline-choice")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["\(marker) / Evening"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].exists)
        XCTAssertEqual(app.switches["Choose Evening"].value as? String, "1")
        XCTAssertFalse(app.switches["Choose Evening"].isEnabled)
        capture("main-refresh-after-relaunch")
    }

    func testMainInstructionRefreshRestoresWithoutGeneration() {
        guard let profile = UserDefaults.standard.string(forKey: "lastWelcomeAcceptanceProfile"),
              let marker = UserDefaults.standard.string(forKey: "lastPromptRefreshChoiceMarker") else {
            XCTFail("Run the isolated main-chat refresh check before this restoration case")
            return
        }
        app.terminate()
        app.launchEnvironment["MUSE_UI_TEST_PROFILE"] = profile
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer {
            app.terminate()
            app.launchEnvironment.removeValue(forKey: "MUSE_UI_TEST_PROFILE")
            app.launchArguments = []
            app.launch()
        }
        XCTAssertTrue(app.staticTexts["\(marker) / Evening"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].exists)
        XCTAssertEqual(app.switches["Choose Kit"].value as? String, "1")
        XCTAssertEqual(app.switches["Choose Evening"].value as? String, "1")
        XCTAssertFalse(app.switches["Choose Evening"].isEnabled)
        XCTAssertFalse(app.buttons["Stop response"].exists)
        capture("main-refresh-read-only-restoration")
    }

    func testWelcomeRestoresWithoutNewGeneration() {
        guard let profile = UserDefaults.standard.string(forKey: "lastWelcomeAcceptanceProfile") else {
            XCTFail("Run the real automatic welcome case before this read-only restoration check")
            return
        }
        app.terminate()
        app.launchEnvironment["MUSE_UI_TEST_PROFILE"] = profile
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.textViews["Message Kit"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.switches["Choose Kit"].waitForExistence(timeout: 60))
        XCTAssertEqual(app.switches.matching(identifier: "Choose Kit").count, 1)
        XCTAssertEqual(app.switches["Choose Kit"].value as? String, "1")
        XCTAssertFalse(app.switches["Choose Kit"].isEnabled)
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].exists)
        XCTAssertFalse(contains("<open-muse-welcome>").exists)
        XCTAssertFalse(app.buttons["Stop response"].exists)
        capture("welcome-restored-without-new-generation")
        app.webViews.firstMatch.swipeDown()
        app.webViews.firstMatch.swipeDown()
        capture("welcome-restored-greeting-bubble-layout")
        app.terminate()
        app.launchEnvironment.removeValue(forKey: "MUSE_UI_TEST_PROFILE")
        app.launchArguments = []
        app.launch()
    }

    func testInlineChoiceStateRestoresWithoutNewGeneration() {
        tap(app.buttons["Open sidebar"], timeout: 40)
        let saved = app.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Choice-check-")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 30))
        let marker = saved.label.components(separatedBy: ":")[0]
        tap(saved)
        XCTAssertTrue(app.staticTexts["\(marker) / Violet"].waitForExistence(timeout: 40))
        XCTAssertEqual(app.switches["Choose After lunch"].value as? String, "1")
        XCTAssertFalse(app.switches["Choose After lunch"].isEnabled)
        XCTAssertFalse(app.switches["Choose Blue"].isEnabled)
        XCTAssertFalse(app.buttons["Stop response"].exists)
        capture("choice-restored-custom-answer")
        app.staticTexts["\(marker) / Violet"].press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Save reply"].waitForExistence(timeout: 10))
        capture("choice-reply-long-press-actions")
        tap(app.buttons["Close"])
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

    private func relaunch(language: String = "en", locale: String = "en_US") {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(\(language))", "-AppleLocale", locale]
        app.launch()
    }

    private func openLibrary() {
        tap(app.links["Library"], timeout: 40)
        if !app.buttons["Artifacts"].waitForExistence(timeout: 3) { tap(app.links["Library"]) }
        XCTAssertTrue(app.buttons["Artifacts"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(app.buttons["Media"].exists)
    }

    // MA exports sandbox outputs asynchronously, so refresh a bounded number of times.
    private func libraryFile(_ name: String, section: String, attempts: Int = 12) -> XCUIElement {
        let card = app.buttons["Open file: \(name)"]
        for _ in 0..<attempts {
            tap(app.buttons[section])
            if card.waitForExistence(timeout: 10) { return card }
            tap(app.buttons["Refresh Library"])
        }
        XCTAssertTrue(card.waitForExistence(timeout: 20), app.debugDescription)
        return card
    }

    private func deliverablePrompt(_ marker: String) -> String {
        "\(marker): please make me a short packing checklist for a weekend hike as a Markdown file I can keep, named \(marker)-packing-checklist.md, under 15 lines. Do not use the network and do not read or change memory."
    }

    // The request never names a directory; the app-owned instructions must.
    private func verifyDeliverable(_ marker: String, source: String?) {
        openLibrary()
        let name = "\(marker)-packing-checklist.md"
        let card = libraryFile(name, section: "Artifacts", attempts: 30)
        capture("deliverable-in-library")
        tap(card)
        if let source = source {
            XCTAssertTrue(contains(source).exists, "The source conversation must be shown")
        }
        tap(app.buttons["Preview file"])
        XCTAssertTrue(app.otherElements["QLPreviewControllerView"].waitForExistence(timeout: 60))
        let text = app.textViews.matching(NSPredicate(format: "label CONTAINS[c] %@", "hike")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 30), "The previewed checklist must be the generated file")
        capture("deliverable-preview")
        app.buttons["museFilePreviewClose"].tap()
        XCTAssertTrue(app.buttons["Preview file"].waitForExistence(timeout: 15))
        tap(app.buttons["Close"])
    }

    func testNormalDeliverableReachesLibrary() {
        let marker = "deliver-" + String(UUID().uuidString.prefix(6)).lowercased()
        UserDefaults.standard.set(marker, forKey: "lastDeliverableMarker")
        relaunch()
        tap(app.buttons["Open sidebar"], timeout: 40)
        tap(app.buttons["New side chat"])
        enterMessage(deliverablePrompt(marker))
        tap(app.buttons["Send message"])
        capture("deliverable-requested")
        verifyDeliverable(marker, source: "\(marker): please make me")
    }

    // Uses the isolated acceptance profile's main chat, never the user's own.
    func testExistingMainDeliverableReachesLibrary() {
        guard let profile = UserDefaults.standard.string(forKey: "lastWelcomeAcceptanceProfile")
                ?? ProcessInfo.processInfo.environment["MUSE_ACCEPTANCE_PROFILE"] else {
            XCTFail("Run the real automatic welcome case before this isolated main-chat check")
            return
        }
        XCTAssertNotNil(profile.range(of: "^welcome-[a-z0-9-]{1,60}$", options: .regularExpression))
        let marker = "main-deliver-" + String(UUID().uuidString.prefix(6)).lowercased()
        app.terminate()
        app.launchEnvironment["MUSE_UI_TEST_PROFILE"] = profile
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer {
            app.terminate()
            app.launchEnvironment.removeValue(forKey: "MUSE_UI_TEST_PROFILE")
            app.launchArguments = []
            app.launch()
        }
        let input = app.textViews["Message Kit"]
        XCTAssertTrue(input.waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].waitForExistence(timeout: 60), "Existing main history must be present before the request")
        tap(input)
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { input.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        if let draft = input.value as? String, !draft.isEmpty, draft != "Message Kit" {
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: draft.count))
        }
        input.typeText(deliverablePrompt(marker))
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].waitForExistence(timeout: 60), "Earlier bubbles stay in the same main chat")
        capture("main-deliverable-requested")
        verifyDeliverable(marker, source: nil)
        tap(app.links["Chat"])
        XCTAssertTrue(app.staticTexts["MEMORY SAVED"].waitForExistence(timeout: 30))
        capture("main-deliverable-history")
    }

    // Quick Look must show the downloaded bytes, not only an empty controller:
    // text files expose their content, the synthetic PNG renders at 64x64.
    // The app-owned close control must be visible without first revealing
    // Quick Look's own controls, including in the black image view.
    private func openPreview(file: String, content: String?, close: String = "Close preview") -> XCUIElement {
        let preview = app.otherElements["QLPreviewControllerView"]
        XCTAssertTrue(preview.waitForExistence(timeout: 60), "Quick Look must open the downloaded file")
        let button = app.buttons["museFilePreviewClose"]
        XCTAssertTrue(button.waitForExistence(timeout: 5), app.debugDescription)
        if let content = content {
            let text = app.textViews.matching(NSPredicate(format: "label == %@", content)).firstMatch
            XCTAssertTrue(text.waitForExistence(timeout: 30), "Quick Look must render the real file content")
            XCTAssertFalse(text.frame.intersects(button.frame), "Close must not cover the first line")
        } else {
            XCTAssertTrue(preview.images.firstMatch.waitForExistence(timeout: 30), "Quick Look must render the real image")
            XCTAssertTrue(preview.images.allElementsBoundByIndex.contains { $0.frame.size == CGSize(width: 64, height: 64) }, app.debugDescription)
        }
        XCTAssertGreaterThanOrEqual(preview.frame.minY, button.frame.maxY, "Preview content starts below the close bar")
        XCTAssertTrue(app.staticTexts[file].exists, "The bar names the previewed file")
        XCTAssertEqual(button.label, close)
        XCTAssertTrue(button.isHittable, "Close must be visible and tappable")
        XCTAssertGreaterThanOrEqual(button.frame.width, 44)
        XCTAssertGreaterThanOrEqual(button.frame.minY, app.windows.firstMatch.frame.minY + 44, "Close must sit below the status bar")
        XCTAssertFalse(app.buttons["Preview file"].isHittable)
        capture("library-preview-\(file)")
        return button
    }

    private func closePreview(_ button: XCUIElement, detail: String = "Preview file") {
        button.tap()
        XCTAssertTrue(app.otherElements["QLPreviewControllerView"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.buttons[detail].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons[detail].isHittable, "Closing returns to the file details")
    }

    private func previewAndShare(_ card: XCUIElement, file: String, content: String? = nil) {
        tap(card)
        tap(app.buttons["Preview file"])
        closePreview(openPreview(file: file, content: content))
        capture("library-preview-closed-\(file)")
        tap(app.buttons["Share file"])
        let sheet = app.otherElements["ActivityListView"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 60), "Share sheet must open with the file")
        capture("library-share-\(file)")
        if sheet.buttons["Close"].exists { sheet.buttons["Close"].tap() }
        else { app.buttons["Close"].firstMatch.tap() }
        XCTAssertTrue(sheet.waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Share file"].isEnabled, "Native bridge must release after dismissal")
        // Cancelling the share sheet must leave the file previewable again.
        tap(app.buttons["Preview file"])
        closePreview(openPreview(file: file, content: content))
    }

    private func verifyLibraryOutputs(_ marker: String) {
        openLibrary()
        let document = libraryFile("\(marker).md", section: "Artifacts")
        XCTAssertFalse(app.buttons["Open file: \(marker).png"].exists, "Images stay out of Artifacts")
        capture("library-artifacts")
        previewAndShare(document, file: "\(marker).md", content: "# Library check \(marker)")
        XCTAssertTrue(contains("Acceptance test \(marker)").exists, "The source conversation title must be shown")
        tap(app.buttons["Close"])
        let image = libraryFile("\(marker).png", section: "Media")
        XCTAssertFalse(app.buttons["Open file: \(marker).md"].exists, "Documents stay out of Media")
        capture("library-media")
        previewAndShare(image, file: "\(marker).png")
        tap(app.links["View source conversation"])
        XCTAssertTrue(app.staticTexts["saved \(marker)"].waitForExistence(timeout: 60), app.debugDescription)
        capture("library-source-conversation")
        relaunch()
        openLibrary()
        XCTAssertTrue(libraryFile("\(marker).md", section: "Artifacts").exists)
        capture("library-after-relaunch")
    }

    func testLibraryShowsRealSessionOutputs() {
        let marker = "library-check-" + String(UUID().uuidString.prefix(6)).lowercased()
        relaunch()
        tap(app.buttons["Open sidebar"], timeout: 40)
        tap(app.buttons["New side chat"])
        let prompt = "Acceptance test \(marker). Use bash to write two synthetic files into /mnt/session/outputs: \(marker).md containing exactly '# Library check \(marker)', and \(marker).png, a 64x64 solid teal PNG generated with only Python's standard library (zlib and struct). Verify both files exist, do not read or change memory, do not use the network, then reply exactly: saved \(marker)"
        enterMessage(prompt)
        tap(app.buttons["Send message"])
        XCTAssertTrue(app.staticTexts["saved \(marker)"].waitForExistence(timeout: 300), app.debugDescription)
        capture("library-side-chat-created-files")
        verifyLibraryOutputs(marker)
    }

    // Samples the rendered cover of one card. Element screenshots keep other
    // Library files out of the evidence.
    private func coverColor(_ card: XCUIElement) -> (r: Int, g: Int, b: Int)? {
        guard let image = card.screenshot().image.cgImage else { return nil }
        let x = image.width / 2, y = image.height * 3 / 10
        var pixel = [UInt8](repeating: 0, count: 4)
        guard let context = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(image, in: CGRect(x: -x, y: y - image.height + 1, width: image.width, height: image.height))
        return (Int(pixel[0]), Int(pixel[1]), Int(pixel[2]))
    }

    private func waitForTealCover(_ card: XCUIElement, _ message: String) {
        var last: (r: Int, g: Int, b: Int)?
        for _ in 0..<40 {
            last = coverColor(card)
            if let c = last, c.r < 40, (100...160).contains(c.g), (100...160).contains(c.b), abs(c.g - c.b) < 20 { return }
            Thread.sleep(forTimeInterval: 1)
        }
        XCTFail("\(message); last cover color \(String(describing: last))")
    }

    // Reuses the synthetic 64x64 teal PNG; sends nothing to MA and opens no other file.
    func testMediaThumbnailRendersRealImage() {
        relaunch()
        openLibrary()
        let card = libraryFile("library-check-b352a1.png", section: "Media")
        waitForTealCover(card, "The Media card must show the real image, not a type icon")
        add({ let a = XCTAttachment(screenshot: card.screenshot()); a.name = "thumbnail-card"; a.lifetime = .keepAlways; return a }())
        tap(app.buttons["Artifacts"])
        let document = libraryFile("library-check-b352a1.md", section: "Artifacts")
        XCTAssertNil(coverColor(document).flatMap { $0.r < 40 && $0.g > 100 ? $0 : nil }, "Documents keep their type icon")
        tap(app.buttons["Media"])
        tap(card)
        XCTAssertTrue(app.buttons["Preview file"].waitForExistence(timeout: 15))
        let cards = app.buttons.matching(NSPredicate(format: "label == %@", "Open file: library-check-b352a1.png"))
        // The modal sheet hides the grid from accessibility, leaving the details card.
        XCTAssertEqual(cards.count, 1)
        let detail = cards.element(boundBy: 0)
        XCTAssertGreaterThan(detail.frame.minY, app.buttons["Close"].frame.maxY, "The remaining card is the one in the sheet")
        waitForTealCover(detail, "The details card reuses the thumbnail")
        add({ let a = XCTAttachment(screenshot: detail.screenshot()); a.name = "thumbnail-detail"; a.lifetime = .keepAlways; return a }())
        tap(app.buttons["Preview file"])
        let close = app.buttons["museFilePreviewClose"]
        XCTAssertTrue(close.waitForExistence(timeout: 60))
        close.tap()
        XCTAssertTrue(app.buttons["Preview file"].waitForExistence(timeout: 15))
        tap(app.buttons["Close"])
        // Nothing is persisted: after relaunch the thumbnail is fetched and rendered again.
        relaunch()
        openLibrary()
        let again = libraryFile("library-check-b352a1.png", section: "Media")
        waitForTealCover(again, "The thumbnail must render again after relaunch")
        add({ let a = XCTAttachment(screenshot: again.screenshot()); a.name = "thumbnail-after-relaunch"; a.lifetime = .keepAlways; return a }())
    }

    // Reuses the synthetic outputs from a previous real run; sends nothing to MA.
    func testLibraryOutputsRestoreWithoutGeneration() {
        relaunch()
        openLibrary()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "Open file: library-check-", ".md")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 60), app.debugDescription)
        let name = card.label.replacingOccurrences(of: "Open file: ", with: "")
        verifyLibraryOutputs((name as NSString).deletingPathExtension)
        relaunch(language: "zh-Hans,en", locale: "zh_CN")
        tap(app.links["资料库"], timeout: 40)
        if !app.buttons["构件"].waitForExistence(timeout: 3) { tap(app.links["资料库"]) }
        XCTAssertTrue(app.buttons["影音内容"].waitForExistence(timeout: 20), app.debugDescription)
        let localized = app.buttons["打开文件：\(name)"]
        XCTAssertTrue(localized.waitForExistence(timeout: 60), app.debugDescription)
        tap(localized)
        XCTAssertTrue(app.buttons["预览文件"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["分享文件"].exists)
        capture("library-simplified-chinese")
        tap(app.buttons["预览文件"])
        closePreview(openPreview(file: name, content: "# Library check \((name as NSString).deletingPathExtension)", close: "关闭预览"), detail: "预览文件")
    }
}
#endif

final class MuseUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.openmuse.mobile")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchEnvironment["MUSE_UI_TESTING"] = "1"
        app.launchEnvironment["MUSE_UI_TEST_SIGNED_OUT"] = "1"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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

    func testSignedOutLibraryShowsNoFiles() {
        tap(app.links["Library"], timeout: 30)
        tap(app.buttons["Artifacts"])
        XCTAssertTrue(app.staticTexts["Nothing created yet"].waitForExistence(timeout: 20), app.debugDescription)
        tap(app.buttons["Media"])
        XCTAssertTrue(app.staticTexts["No media yet"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Open file: ")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Couldn't load")).firstMatch.exists)
        capture("signed-out-library-empty")
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

    func testChineseFollowsSystemLanguage() {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans,en)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.textViews["给 Muse 发消息"].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(app.links["对话"].exists)
        XCTAssertTrue(app.links["目标"].exists)
        tap(app.buttons["Muse 的状态：未连接"])
        tap(app.buttons["身份"])
        XCTAssertTrue(app.buttons["打开 MEMORY.md"].exists)
        tap(app.buttons["关闭伙伴详情"])
        tap(app.links["通过 SSO 或 API Key 连接后开始对话"])
        XCTAssertTrue(app.buttons["开始 SSO 登录"].waitForExistence(timeout: 10))
        capture("system-language-chinese")
    }

    func testUnsupportedLanguageFallsBackToEnglish() {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR"]
        app.launch()
        XCTAssertTrue(app.textViews["Message Muse"].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(app.links["Chat"].exists)
        XCTAssertTrue(app.links["Connect with SSO or API Key to start chatting"].exists)
        capture("system-language-english-fallback")
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
