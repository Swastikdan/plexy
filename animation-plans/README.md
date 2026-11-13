# Native motion refinement plans

Audited commit: `d8c59db`. Source files were not modified by the audit.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 010 | [Stable player feedback](010-interruptible-player-feedback.md) | HIGH | DONE |
| 011 | [Static loading with reduced motion](011-static-reduced-motion-loading.md) | MEDIUM | DONE |
| 012 | [Visible player drawer exit](012-render-player-drawer-exit.md) | MEDIUM | DONE |

Execute 010 first, then 011, then 012. These touch different files and have no code dependencies. Plans use the existing shared easing system. No unrelated animations are requested.

Missed opportunities: the library-report tab surface could use the same restrained directional transition as LibraryScreen when that surface is unified; the scan progress page can keep its current folder name fixed and fade final results to avoid a jarring switch. Neither warrants decorative movement of readable scan data.

Implementation status: 010, 011 and 012 implemented in this change. Native typecheck and automated tests pass. Physical-device gesture and slow-motion visual checks remain manual.
