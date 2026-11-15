# Mobile versioning and startup updates

Status: implemented in the mobile build workflow and startup update coordinator. Release publishing and real-device installation still require validation in their target environments.

## Intended behavior

Every new distributable mobile build gets a new visible semantic version (patch by default). Development server starts, typechecking, bundle checks, and workflow retries do not consume versions. Feature releases can explicitly select a minor version; breaking releases can select a major version. Update urgency is explicitly configured and is independent of semantic version size.

Three update types:

- Optional: small dismissible notice; Update and Later. Remember dismissal for that version.
- Feature: prominent notice with release highlights; Update and Later. Show once per version automatically; keep available in Settings.
- Necessary: full-screen update gate with no Later action. Block navigation and playback while the installed version is below the minimum supported version. Keep download, retry, installation permission help, and release details available. Back cannot reveal the app underneath.

## Findings in the current implementation

- scripts/native/build-preview.ts increments .build/native/build-number locally or uses a CI run counter.
- apps/mobile/app.config.ts reads the visible version from the mobile package and derives Android versionCode from semantic version plus build counter.
- .github/workflows/build.yml publishes shared repository releases tagged with root package version and build number.
- useAppUpdates is mounted in Settings; checking is manual.
- selectUpdate rejects releases without a build-number suffix.
- The existing APK downloader validates download size, exposes progress, and opens Android's installer; reuse it.

## 1. Allocate versions once per distributable build

Add a mobile release preparation step shared by local builds and CI. Default: increment patch from the last reserved mobile version; allow an explicit major/minor/version override. Keep the authoritative mobile version separate from desktop and server versions.

Serialize mobile release allocation in CI and persist its reservation before starting the build. A workflow retry reuses the reservation, version, and release identity. Local allocation must consult the current mobile release/reservation before selecting a version and fail clearly if uniqueness cannot be established. Failed new builds can leave version gaps; never reuse a version for different APK contents.

Pass the prepared version to Expo, the APK filename, and the release job. Use mobile-specific tags such as mobile-v1.0.9 so shared desktop/server release tags remain independent. Do not modify root or desktop versions merely to build Android. Persist the mobile version through a dedicated mobile version record consumed by Expo, rather than creating uncommitted package changes during CI.

Keep an internal Android versionCode derived from semantic version. Preserve ordering above every existing published APK; validate component ranges and Android's integer limit. Remove the independently incremented build counter from the new mobile release path and user-facing UI. Retain legacy decoding only for installed older versions and release compatibility.

## 2. Publish an explicit update policy

Publish a small, versioned mobile update manifest with the APK release. Proposed fields:

- schemaVersion, platform, channel
- latestVersion, versionCode
- updateType: optional | feature | necessary
- minimumSupportedVersion
- title, message, releaseNotes, publishedAt
- apk asset name, download URL, size, SHA-256

The manifest must be published only after the matching APK is available. Make the policy discoverable through a stable mobile-specific release reference. Preserve the minimum supported version when publishing later optional or feature updates: a newer optional release must not erase an earlier mandatory cutoff.

Validate the schema, version ordering, supported platform/channel, HTTPS repository asset URL, and asset identity before accepting policy. Do not interpret missing or malformed policy as a mandatory update. Verify the APK digest before launching installation, alongside existing size checks.

Continue recognizing legacy build-tagged mobile APKs as optional updates during migration; prefer valid mobile manifests for new releases. Ignore releases containing only desktop/server assets and do not install beta/prerelease APKs into the stable channel.

## 3. Add one global update coordinator

Mount an update provider/gate above the root navigator. Settings consumes this same state and commands instead of starting a second updater.

On cold launch:

1. Read the installed native version and cached validated policy.
2. Immediately enforce a cached mandatory cutoff if this version is unsupported.
3. Start one network update check with a bounded timeout.
4. Compare semantic versions and minimumSupportedVersion.
5. Render the app, an optional/feature notice, or the mandatory gate.

Check again on connectivity restoration and app foreground, with throttling, request deduplication, and cancellation. Manual Settings checks bypass the throttle. Do not interrupt active playback with an optional/feature notice; queue it until playback exits. Mandatory updates take precedence and stop playback when the gate activates.

Recommended offline default: allow the app when there is no validated mandatory policy; keep it blocked offline if a cached policy already establishes that the installed version is unsupported. A transient network failure does not invent a new requirement or erase an existing requirement. Provide Retry and a clear connection message on the gate.

## 4. Installation flow

Use one shared state machine: idle, checking, available, downloading, verifying, installer-open, cancelled/error, up-to-date.

Optional/feature updates allow continued use after dismissal. Necessary updates remain gated through failed downloads, denied install permission, installer cancellation, and returning to the app without installing. Opening the installer or receiving an installer result must not clear the gate: re-read installed native version and verify it meets the minimum. Android still owns installation confirmation.

Persist policy and per-version notice dismissal, not a permanent "already updated" boolean. Preserve the existing signing identity so upgrades retain local data.

## 5. Validation

- Version allocation: patch/minor overrides, unique reservations, concurrent CI runs, retries, failed build gaps, local/CI collisions.
- Android ordering: existing installed codes, next semantic version, range validation, no downgrade.
- Release policy: new mobile tags, legacy tags, drafts, prereleases, unrelated assets, malformed data, checksum mismatch.
- Urgency: all three types; below/equal/above minimum; mandatory cutoff survives later optional releases; skipped versions.
- Lifecycle: cold launch, offline with/without cached mandatory policy, timeout, reconnection, foreground throttling, Settings deduplication.
- Installation: progress, download failure, denied permission, cancellation, required gate persistence, successful upgraded version.
- Run strict lint, TypeScript, native tests, Android export, and real-device installation/cancellation/back-button checks.

## Rollout limitation

Already distributed APKs without the startup gate cannot be made to enforce it retroactively. The first release delivers the coordinator; mandatory policy can then govern installations that include it.

## Defaults implemented

- Default patch bump for each new distributable mobile build, with explicit minor/major overrides.
- Offline behavior: cached mandatory requirements remain enforced; unknown requirements do not block offline use.
- Feature updates remain dismissible; necessary updates block until the installed version meets the minimum.
