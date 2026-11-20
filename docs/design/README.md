# Design and visual parity

| Document | What it is |
| --- | --- |
| [`UI_INVENTORY.md`](UI_INVENTORY.md) | every Plexy screen and visual state (48 screens, 542+ states) |
| [`REFERENCE.md`](REFERENCE.md) | the supplied reference kit, what to borrow, tokens and conflict decisions |
| [`reference/`](reference/) | cropped reference images used by the loop |
| [`../../plans/013-visual-parity-loop.md`](../../plans/013-visual-parity-loop.md) | the recreation plan, phases, rubric and loop protocol |
| [`../../qa/ui-parity/README.md`](../../qa/ui-parity/README.md) | how to run the capture / compare / implement loop |

The loop's output is local QA evidence under `qa/ui-loop/` (git-ignored). The
website and desktop web surface now pass:

- `home-web` 11/12
- `library-web` 11/12
- `player-web` 11/12
- `title-web`, `search-web`, `settings-web` 10/12

Mobile is explicitly deferred; its baselines remain under `qa/ui-loop/` for a
later pass.
