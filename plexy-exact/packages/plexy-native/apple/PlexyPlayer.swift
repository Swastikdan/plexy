#if os(macOS)
import AVKit
import AppKit
import ExactPackage
import IOKit.ps
import Darwin

public final class PlexyNative: ExactPackage {
    let context: ExactPackageContext
    private var players: [String: PlexyPlayer] = [:]
    public init(context: ExactPackageContext) { self.context = context }
    public func later(_ name: String, _ args: [String: Any], preferred: Any?, reply: @escaping ([String: Any]) -> Void) {
        do {
            switch name {
            case "verifyPlayback":
                guard let path = args["path"] as? String else { throw ExactPackageRefusal("Invalid media") }
                let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : context.file(path)
                guard let url else { throw ExactPackageRefusal("Invalid media") }
                let asset = AVURLAsset(url: url)
                let player = AVPlayer(); player.isMuted = true
                var answered = false
                let finish: (Bool) -> Void = { ok in
                    DispatchQueue.main.async {
                        guard !answered else { return }; answered = true; player.pause()
                        reply(["ok": ok, "message": ok ? "AVPlayer seek verified" : "AVPlayer output verification failed or timed out"])
                    }
                }
                // Arm before asset loading: malformed/unreadable media must never hold a job indefinitely.
                DispatchQueue.main.asyncAfter(deadline: .now() + 20) { finish(false) }
                asset.loadValuesAsynchronously(forKeys: ["playable", "duration"]) {
                    DispatchQueue.main.async {
                        guard !answered, asset.isPlayable else { finish(false); return }
                        let duration = asset.duration.seconds
                        guard duration.isFinite, duration > 0 else { finish(false); return }
                        player.replaceCurrentItem(with: AVPlayerItem(asset: asset))
                        player.seek(to: CMTime(seconds: duration / 2, preferredTimescale: 600)) { seeked in
                            guard seeked else { finish(false); return }
                            player.preroll(atRate: 1) { finish($0) }
                        }
                    }
                }
            case "freeSpace":
                let path = args["path"] as? String ?? ""
                let attributes = try FileManager.default.attributesOfFileSystem(forPath: path)
                let info = IOPSCopyPowerSourcesInfo().takeRetainedValue()
                let power = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?
                reply(["bytes": (attributes[.systemFreeSize] as? NSNumber)?.doubleValue ?? 0, "onBattery": power == kIOPSBatteryPowerValue])
            case "resolveLocalPath":
                guard let path = args["path"] as? String, let url = context.file(path) else { throw ExactPackageRefusal("Invalid app path") }
                reply(["path": url.path])
            case "reservePartial":
                guard let path = args["path"] as? String else { throw ExactPackageRefusal("Invalid partial path") }
                let descriptor = Darwin.open(path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
                if descriptor < 0 { reply(["ok": false, "message": "Partial output already exists or cannot be created"]); return }
                Darwin.close(descriptor); reply(["ok": true, "message": "Reserved"])
            case "publishMedia":
                guard let partial = args["partial"] as? String, let destination = args["destination"] as? String,
                    partial != destination else { throw ExactPackageRefusal("Invalid conversion paths") }
                try FileManager.default.linkItem(atPath: partial, toPath: destination)
                try FileManager.default.removeItem(atPath: partial)
                reply(["ok": true, "message": "Published"])
            case "openUpdate":
                guard let path = args["path"] as? String, path == "app:/data/plexy-exact-macos.zip", let url = context.file(path) else { throw ExactPackageRefusal("Invalid update") }
                NSWorkspace.shared.activateFileViewerSelecting([url])
                reply(["ok": true, "message": "Unzip the verified build and move Plexy to Applications."])
            case "listDeviceVideos": reply(["exact:answer": []])
            default: reply(["error": "NotSupportedError"])
            }
        } catch { reply(["error": "OperationError", "message": error.localizedDescription]) }
    }
    public func view(_ tag: String, id: String, props: [String: String], events: ExactPackageEvents) throws -> ExactPackageView {
        guard tag == "plexy-player" else { throw ExactPackageRefusal("Unknown view") }
        let view = PlexyPlayer(context: context, events: events)
        players[id] = view
        view.onDestroy = { [weak self] in self?.players.removeValue(forKey: id) }
        try view.setProps(props)
        return view
    }
    public func displayed(_ id: String, _ shown: Bool, origin: String) { players[id]?.displayed(shown) }
    public func destroy(_ done: @escaping () -> Void) { Array(players.values).forEach { $0.destroy() }; done() }
}
final class PlexyPlayer: ExactPackageView {
    private let context: ExactPackageContext
    private let events: ExactPackageEvents
    private let surface = AVPlayerView()
    private let player = AVPlayer()
    var onDestroy: () -> Void = {}
    private var shown = true, paused = false
    private var source = ""
    private var lastSeek = -1.0
    private var observer: Any?
    private var selectedAudio = -2, selectedSubtitle = -1
    private var generation = 0
    private var audioLabels: [String] = []
    private var subtitleLabels: [String] = []
    var view: ExactPackagePlatformView { surface }
    init(context: ExactPackageContext, events: ExactPackageEvents) {
        self.context = context; self.events = events
        surface.player = player
        surface.controlsStyle = .floating
        surface.showsFullScreenToggleButton = true
        surface.allowsPictureInPicturePlayback = true
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 2, preferredTimescale: 600), queue: .main) { [weak self] _ in self?.report() }
    }
    func setProps(_ props: [String: String]) throws {
        selectedAudio = Int(props["audio"] ?? "-2") ?? -2
        selectedSubtitle = Int(props["subtitle"] ?? "-1") ?? -1
        let next = props["source"] ?? ""
        if next != source {
            guard let url = next.hasPrefix("/") ? URL(fileURLWithPath: next) : context.file(next), url.isFileURL else { throw ExactPackageRefusal("Local media access denied") }
            source = next; lastSeek = -1; generation += 1
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
        }
        if let seek = Double(props["seek"] ?? ""), seek.isFinite, seek >= 0, seek != lastSeek {
            lastSeek = seek; player.seek(to: CMTime(seconds: seek, preferredTimescale: 600))
        }
        paused = props["isPaused"] == "true"
        if paused || !shown { player.pause() } else { player.play() }
        if let item = player.currentItem {
            let revision = generation
            item.asset.loadValuesAsynchronously(forKeys: ["availableMediaCharacteristicsWithMediaSelectionOptions"]) { [weak self] in
              DispatchQueue.main.async {
                guard let self else { return }
                for (key, characteristic) in [("audio", AVMediaCharacteristic.audible), ("subtitle", AVMediaCharacteristic.legible)] {
                    guard let group = item.asset.mediaSelectionGroup(forMediaCharacteristic: characteristic), self.generation == revision else { continue }
                    if key == "audio" { self.audioLabels = group.options.map { $0.displayName } } else { self.subtitleLabels = group.options.map { $0.displayName } }
                    let index = Int(props[key] ?? "-2") ?? -2
                    if index == -2 {
                        let language = props[key == "audio" ? "audioLanguage" : "subtitleLanguage"] ?? "en"
                        let selected = group.options.first { $0.locale?.languageCode == language } ?? (key == "audio" ? group.defaultOption : nil)
                        item.select(selected, in: group)
                    }
                    else if index == -1 && key == "subtitle" { item.select(nil, in: group) }
                    else if group.options.indices.contains(index) { item.select(group.options[index], in: group) }
                }
              }
            }
        }
    }
    private func report() {
        let position = player.currentTime().seconds
        let duration = player.currentItem?.duration.seconds ?? 0
        guard position.isFinite else { return }
        let body: [String: Any] = ["position": position, "duration": duration.isFinite ? duration : 0,
            "audioChoice": selectedAudio, "subtitleChoice": selectedSubtitle, "audio": audioLabels, "subtitles": subtitleLabels,
            "error": player.currentItem?.error?.localizedDescription ?? ""]
        if let data = try? JSONSerialization.data(withJSONObject: body), let text = String(data: data, encoding: .utf8) { events.message(text) }
    }
    func displayed(_ shown: Bool) { self.shown = shown; if shown && !paused { player.play() } else { player.pause() } }
    func destroy() {
        onDestroy()
        generation += 1
        report(); player.pause()
        if let observer { player.removeTimeObserver(observer) }; observer = nil
        player.replaceCurrentItem(with: nil)
    }
}
#endif
