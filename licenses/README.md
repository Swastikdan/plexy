# Mobile third-party notices

The mobile app exposes **Settings → Open Source Licenses**. JavaScript package
notices, including Archivo and Geist's separate font licenses, are bundled in the
app and readable offline. Android library notices are opened from the same screen
using Google's OSS Licenses activity and generated from the release's Maven
metadata. Some native license entries link to upstream terms and need a connection.

Run `bun run licenses:mobile` after installing dependencies or changing the lockfile.
Run `bun run licenses:mobile:check` to check the committed inventory against this
installation. Native prebuild, bundle export, and EAS's post-install hook regenerate
the notices automatically. Missing license texts fail generation rather than
silently shipping a blank entry.

The generator walks the mobile package's installed dependency graph, including
transitive dependencies and installed peers. It deliberately includes some build
tools that Metro may remove. Optional, platform-specific packages can vary between
build machines. It excludes development-only roots and first-party workspace
packages. Entries preserve published LICENSE, NOTICE, COPYING, COPYRIGHT and font
license files verbatim. Keep upstream copyright notices intact when updating them.

Some npm archives omit license texts. `mobile-supplemental.json` stores verified
upstream copies keyed by exact npm name and version, with the source URL used.
Most use npm's gitHead or an upstream release tag resolved to a commit. Where those
refs were unavailable, a pinned upstream license is included; client-only and
server-only use React's v18.2.0 license, and jimp-compact uses Jimp v0.16.1's license
as directed by its README. Re-check these sources when updating dependencies.
The declared license expression still comes from each installed package.

`patches/` contains our local Expo changes; the generator discloses patched
packages using the root package.json's patchedDependencies. Local patches are not
claims of upstream contributions or endorsement.

Android integration is maintained by `scripts/native/with-open-source-licenses.cjs`
so Expo prebuild does not erase it. It follows:
https://developers.google.com/android/guides/opensource
A native rebuild is required when adding or changing this integration.

Review dependency changes for new license terms and any extra distribution
requirements, especially source or relinking obligations. An automated inventory
cannot determine those obligations or discover code copied outside the package
and Maven dependency graphs. Bundled binaries, vendored source and new assets
need explicit review. The desktop mpv notice is separate and is not presented as
a mobile dependency. TMDB's existing API attribution remains in Settings.
