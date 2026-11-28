import AppKit
import Darwin
import Foundation
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private var serverProcess: Process?
    private var serverInput: Pipe?
    private var port = Int(ProcessInfo.processInfo.environment["PLEXY_SERVER_PORT"] ?? "") ?? 8765
    private var running = false
    private var starting = false
    private var usingExisting = false
    private var healthTimer: Timer?
    private var healthDeadline = Date.distantPast
    private var lastError: String?

    private var baseURL: URL {
        URL(string: "http://127.0.0.1:\(port)")!
    }

    private var dataDir: URL {
        envURL(
            "PLEXY_DATA_DIR",
            fallback: FileManager.default
                .urls(for: .applicationSupportDirectory, in: .userDomainMask)
                .first!
                .appendingPathComponent("Plexy")
        )
    }

    private var logDir: URL {
        envURL(
            "PLEXY_LOG_DIR",
            fallback: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Logs/Plexy")
        )
    }

    private func envURL(_ key: String, fallback: URL) -> URL {
        if let value = ProcessInfo.processInfo.environment[key], !value.isEmpty {
            return URL(fileURLWithPath: value)
        }
        return fallback
    }

    private var serverResources: URL? {
        if let value = ProcessInfo.processInfo.environment["PLEXY_SERVER_RESOURCES"], !value.isEmpty {
            return URL(fileURLWithPath: value)
        }
        if let resources = Bundle.main.resourceURL {
            let bundled = resources.appendingPathComponent("server")
            if FileManager.default.isExecutableFile(atPath: bundled.appendingPathComponent("plexy-server").path) {
                return bundled
            }
        }
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let development = cwd.appendingPathComponent("dist/server")
        if FileManager.default.isExecutableFile(atPath: development.appendingPathComponent("plexy-server").path) {
            return development
        }
        return nil
    }

    private func debugLog(_ message: String) {
        let directory = logDir
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("server-app.log")
        let line = "\(Date()) \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            if let iconURL = Bundle.main.url(forResource: "status-icon", withExtension: "png"),
               let image = NSImage(contentsOf: iconURL) {
                image.isTemplate = true
                button.image = image
            } else {
                button.image = NSImage(
                    systemSymbolName: "rectangle.on.rectangle",
                    accessibilityDescription: "Plexy Server"
                )
            }
            button.toolTip = "Plexy Server"
        }
        statusItem.menu = menu
        debugLog("launch variant resources=\(Bundle.main.resourceURL?.path ?? "nil")")
        rebuildMenu()
        checkExistingServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
    }

    private func checkExistingServer() {
        probe(port: port) { [weak self] ready in
            guard let self else { return }
            self.debugLog("probe \(self.port) ready=\(ready)")
            if ready {
                self.usingExisting = true
                self.running = true
                self.starting = false
                self.rebuildMenu()
                return
            }
            self.startServer()
        }
    }

    private func startServer() {
        guard !running, !starting, serverProcess == nil else { return }
        guard let serverDir = serverResources else {
            fail("The bundled Plexy Server is missing.")
            return
        }
        let binary = serverDir.appendingPathComponent("plexy-server")
        debugLog("server binary=\(binary.path) executable=\(FileManager.default.isExecutableFile(atPath: binary.path))")
        guard FileManager.default.isExecutableFile(atPath: binary.path) else {
            fail("The bundled Plexy Server is missing.")
            return
        }
        let preferred = port
        debugLog("preferred port=\(preferred) available=\(portAvailable(preferred))")
        guard let chosen = (preferred...(preferred + 30)).first(where: {
            portAvailable($0) && portAvailable($0 + 1)
        }) else {
            fail("No free port was available for Plexy Server.")
            return
        }

        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)

        let process = Process()
        process.executableURL = binary
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = "\(chosen)"
        environment["PLEXY_DATA_DIR"] = dataDir.path
        environment["PLEXY_LOG_DIR"] = logDir.path
        environment["PLEXY_FFMPEG"] = serverDir.appendingPathComponent("ffmpeg").path
        environment["PLEXY_RESOURCES_DIR"] = serverDir.path
        environment["PLEXY_DESKTOP"] = "1"
        process.environment = environment

        let input = Pipe()
        process.standardInput = input
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.serverProcess === finished {
                    self.serverProcess = nil
                    self.serverInput = nil
                }
                self.running = false
                self.starting = false
                self.usingExisting = false
                self.rebuildMenu()
            }
        }

        do {
            try process.run()
        } catch {
            debugLog("run failed: \(error.localizedDescription)")
            fail("Plexy Server could not start: \(error.localizedDescription)")
            return
        }

        port = chosen
        serverProcess = process
        serverInput = input
        running = false
        starting = true
        usingExisting = false
        lastError = nil
        rebuildMenu()
        healthDeadline = Date().addingTimeInterval(20)
        startHealthTimer()
    }

    private func stopServer() {
        healthTimer?.invalidate()
        healthTimer = nil
        if usingExisting {
            running = false
            starting = false
            usingExisting = false
            rebuildMenu()
            return
        }
        serverInput?.fileHandleForWriting.closeFile()
        serverInput = nil
        serverProcess?.terminationHandler = nil
        serverProcess?.terminate()
        serverProcess = nil
        running = false
        starting = false
        rebuildMenu()
    }

    private func startHealthTimer() {
        healthTimer?.invalidate()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            if self.running {
                timer.invalidate()
                return
            }
            if Date() > self.healthDeadline {
                timer.invalidate()
                self.fail("Plexy Server did not become ready.")
                self.stopServer()
                return
            }
            self.probe(port: self.port) { [weak self] ready in
                guard let self, ready else { return }
                self.running = true
                self.starting = false
                self.healthTimer?.invalidate()
                self.healthTimer = nil
                self.rebuildMenu()
            }
        }
    }

    private func probe(port: Int, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/server/status") else {
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { data, response, error in
            var ready = false
            if let http = response as? HTTPURLResponse,
               http.statusCode == 200,
               let data,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               object["serverId"] is String {
                ready = true
            }
            DispatchQueue.main.async { completion(ready) }
        }.resume()
    }

    private func portAvailable(_ port: Int) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(port).bigEndian)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }

    private func fail(_ message: String) {
        debugLog("fail: \(message)")
        lastError = message
        running = false
        starting = false
        rebuildMenu()
    }

    private var statusTitle: String {
        if starting { return "Starting Plexy Server…" }
        if running {
            return usingExisting
                ? "Using Plexy Server · port \(port)"
                : "Plexy Server · \(baseURL.absoluteString)"
        }
        if let lastError { return "Plexy Server · \(lastError)" }
        return "Plexy Server · Stopped"
    }

    private var loginEnabled: Bool {
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }
        return false
    }

    private func rebuildMenu() {
        statusItem?.button?.toolTip = statusTitle
        menu.removeAllItems()
        menu.autoenablesItems = false
        let status = NSMenuItem(title: statusTitle, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        let open = NSMenuItem(title: "Open Library", action: #selector(openLibrary), keyEquivalent: "o")
        open.target = self
        open.isEnabled = running
        menu.addItem(open)

        let setup = NSMenuItem(title: "Open Server Setup", action: #selector(openSetup), keyEquivalent: "")
        setup.target = self
        setup.isEnabled = running
        menu.addItem(setup)

        let copy = NSMenuItem(title: "Copy Server Address", action: #selector(copyAddress), keyEquivalent: "")
        copy.target = self
        copy.isEnabled = running
        menu.addItem(copy)
        menu.addItem(.separator())

        if !usingExisting {
            let toggle = NSMenuItem(
                title: running || starting ? "Stop Server" : "Start Server",
                action: #selector(toggleServer),
                keyEquivalent: ""
            )
            toggle.target = self
            toggle.isEnabled = !starting
            menu.addItem(toggle)
        }

        let login = NSMenuItem(title: "Start at Login", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = loginEnabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit Plexy Server", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    @objc private func openLibrary() {
        NSWorkspace.shared.open(baseURL)
    }

    @objc private func openSetup() {
        NSWorkspace.shared.open(baseURL.appendingPathComponent("setup"))
    }

    @objc private func copyAddress() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(baseURL.absoluteString, forType: .string)
    }

    @objc private func toggleServer() {
        if running || starting {
            stopServer()
        } else {
            startServer()
        }
    }

    @objc private func toggleLogin() {
        guard #available(macOS 13.0, *) else {
            lastError = "Start at Login requires macOS 13 or later."
            rebuildMenu()
            return
        }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
            lastError = nil
        } catch {
            lastError = "Login item: \(error.localizedDescription)"
        }
        rebuildMenu()
    }

    @objc private func quit() {
        stopServer()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
