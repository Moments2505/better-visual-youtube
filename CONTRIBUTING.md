# Contributing

Thanks for helping improve Better visual Youtube. Bug reports, ideas and pull requests are welcome.

## Get started

Load this repository as an unpacked extension. After making changes, reload the extension and YouTube.

With Node.js 22+ and Python 3.12+ installed, run:

```sh
python scripts/check.py
python scripts/package-release.py --output-dir dist
```

The ZIP and its SHA-256 checksum are written to `dist/`.

## Find your way around

- `src/shared`: settings and migrations.
- `src/glass`: glass materials and optical effects.
- `src/styles`: YouTube interface styles.
- `src/content`: page integration, navigation and animations.
- `src/ambient`: Ambient Light integration.
- `src/popup`: settings panel.
- `vendor/ambient`: modified upstream Ambient Light code.
- `tests`: source regression checks.

Eight glass stylesheets are checked against a saved visual baseline in `tests/visual-restore-regressions.js`. Put refinements in the additive styles, or explain any intended baseline change in your pull request. Preserve existing settings keys and third-party notices.

## Send a change

Keep each pull request focused and describe the resulting behaviour. Run the source checks, then test affected interactions on YouTube in Edge and Chrome. For appearance changes, include screenshots of the relevant states.

For performance changes, compare the same video and settings before and after, and describe how you measured the result. The automated tests cover source behaviour; they do not measure rendering performance.

## Share feedback

[Open an issue](https://github.com/Moments2505/better-visual-youtube/issues) with what happened and how to reproduce it. Browser version and a screenshot can help. Remove private information before attaching files.

For security issues, contact [QuanNguyen](mailto:quannguyenproducer2505@gmail.com) privately. Contributions use the project's MIT license.
