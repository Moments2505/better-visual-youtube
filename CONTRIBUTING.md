# Contributing

Bug reports and focused pull requests are welcome. This is a beta; hover and player-control performance remain known issues.

## Working locally

Load the repository folder as an unpacked extension. Reload the extension and YouTube after source changes. Use Node.js 22+ and Python 3.12+ to run `python scripts/check.py`. Package with `python scripts/package-release.py --output-dir dist`.

Source layout:

- `src/shared`: settings schema, defaults and migration.
- `src/glass`: glass material and optical maps.
- `src/styles`: additive YouTube interface refinements.
- `src/content`: DOM integration, navigation and motion.
- `src/ambient`: Ambient lifecycle and integration.
- `src/popup`: extension settings interface.
- `vendor/ambient`: modified upstream bundles; preserve their MIT license and notices.
- `tests`: standalone Node.js regression suites with local mocks.

Eight original glass CSS files are pinned by `tests/visual-restore-regressions.js`. Add appearance refinements in additive styles unless deliberately proposing a reviewed visual baseline change. Keep existing settings keys compatible and avoid adding competing animation loops.

## Validation

Explain what changed and how you verified it. Source tests do not establish live YouTube compatibility, smoothness or input latency. For UI changes, manually test relevant states in current Edge and Chrome: light/dark themes, fresh and saved settings, normal/theater/fullscreen player, navigation between videos, and the affected interaction.

For performance work, compare the same video, viewport, browser, display refresh rate and settings against a baseline. Report sample counts and frame timing distributions where available. Distinguish JavaScript scheduling measurements from rendered FPS and physical input-to-photon latency. Do not promise a speedup without measurement.

## Reports and privacy

Include steps to reproduce, browser version, hardware, settings and expected/actual behavior. Review and redact any attached screenshot or trace; never post credentials, cookies, account identifiers or browsing history. Keep local diagnostics out of commits.

For private security reports, contact quannguyenproducer2505@gmail.com instead of opening a public issue. Contributions are provided under the project's MIT license; preserve third-party attribution.
