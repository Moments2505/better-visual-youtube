![Better visual Youtube — Liquid Glass and Ambient Light](https://raw.githubusercontent.com/Soul-blade-2505/better-visual-youtube/main/docs/media/liquid-glass-banner.png)

# Better visual Youtube

A fresh look for YouTube, with transparent glass surfaces, colour that follows your video, and animations throughout the interface.

**[Download v0.4.53](https://github.com/Soul-blade-2505/better-visual-youtube/releases/tag/v0.4.53)** · [Tiếng Việt](README-VI.md) · [Report an issue](https://github.com/Soul-blade-2505/better-visual-youtube/issues)

Made for desktop Microsoft Edge and Google Chrome. This first public release is a beta, with more refinements to come.

## A little more depth

Liquid Glass brings transparent surfaces and light-catching edges to the header, search box, player controls and content panels. Adjust the tint, blur, opacity and reflections to suit your screen.

## Light that follows the video

Ambient Light extends colours beyond the player. Choose how far the light spreads and how bright it feels, with quality controls in the same settings panel.

![Better visual Youtube — Ambient Light promotional artwork](https://raw.githubusercontent.com/Soul-blade-2505/better-visual-youtube/main/docs/media/ambient-light-banner.png)

## Make it yours

Choose a light or dark theme, tune the glass effects, and turn interface animations on or off. Your preferences are saved in your browser.

## Get started

1. Download **Better-visual-Youtube-0.4.53.zip** from [Releases](https://github.com/Soul-blade-2505/better-visual-youtube/releases/tag/v0.4.53) and extract it.
2. Open `edge://extensions` or `chrome://extensions` and turn on **Developer mode**.
3. Select **Load unpacked**, then choose the folder containing `manifest.json`.
4. Reload YouTube and open the extension to explore the settings.

[English installation guide](INSTALL-EN.md) · [Hướng dẫn cài đặt tiếng Việt](INSTALL-VI.md)

Found a bug or have an idea? [Open an issue](https://github.com/Soul-blade-2505/better-visual-youtube/issues).

## Build with us

The source is open under the [MIT license](LICENSE). You can load this repository directly as an unpacked extension; no build step is needed.

To run the source checks and create a ZIP, use Node.js 22+ and Python 3.12+:

```sh
python scripts/check.py
python scripts/package-release.py --output-dir dist
```

See [Contributing](CONTRIBUTING.md) for the source layout and development notes.

## Credits

Created by **QuanNguyen**. Ambient Light includes modified code from [youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight) by Wessel Kroos, used under MIT. The glass effects draw on [this CSS/SVG refraction article](https://kube.io/blog/liquid-glass-css-svg/). See [Third-party notices](THIRD-PARTY-NOTICES.md) for details.

[Privacy policy](docs/PRIVACY-EN.md) · [Chính sách quyền riêng tư](docs/PRIVACY-VI.md) · [Contact](mailto:quannguyenproducer2505@gmail.com)

An independent project, unaffiliated with YouTube, Google, Apple or Microsoft.
