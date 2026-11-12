![Better visual Youtube — Liquid Glass and Ambient Light](https://raw.githubusercontent.com/Moments2505/better-visual-youtube/main/docs/media/liquid-glass-banner.png)

# Better visual Youtube

A fresh look for YouTube, with transparent glass surfaces, colour that follows your video, and animations throughout the interface.

**[Download latest release](https://github.com/Moments2505/better-visual-youtube/releases/latest)** · [Changelog](CHANGELOG.md) · [Tiếng Việt](README-VI.md) · [Report an issue](https://github.com/Moments2505/better-visual-youtube/issues)

Free and open source, made for desktop Microsoft Edge and Google Chrome.

**Latest release: [0.5.0](https://github.com/Moments2505/better-visual-youtube/releases/tag/v0.5.0).** Adds 1-click Style Profiles, cross-device settings sync & JSON Export/Import, native English/Vietnamese localization, seamless sky chrome surfaces, and a 70% smaller MV3 package. [Release notes](https://github.com/Moments2505/better-visual-youtube/blob/main/docs/releases/v0.5.0.md)

## A little more depth

Liquid Glass brings transparent surfaces and light-catching edges to the header, search box, player controls and content panels. Adjust the tint, blur, opacity and reflections to suit your screen.

## Light that follows the video

Ambient Light extends colours beyond the player. Choose how far the light spreads and how bright it feels, with quality controls in the same settings panel.


## Make it yours

**Follow system reduced motion** is enabled by default. If the browser reports reduced motion unexpectedly, uncheck it in the popup, then enable **Motion effects** and **Ambient Light** as desired. **Animate sky** remains a separate switch. This setting does not change Windows or browser preferences.

Choose a light or dark theme, tune the glass effects, and turn interface animations on or off. Your preferences are saved in your browser.

**Opacity** controls the headbar and reading panels together. At 0% they are clear; the upper range (about 70–100%) gradually blends the selected tint toward white, reaching solid white at 100% with dark reading text. Moving between 99% and 100% keeps the transition gentle.

The optional **Time-of-day background** adds morning sunlight, a daytime sky, sunset or a moonlit star field to Home, Search and channel pages. Auto follows the sun at your chosen city, initially London, United Kingdom. You can also choose a scene manually. **Animate sky** controls sky movement separately from interface **Motion effects**; Ambient Light has its own switch too.

The procedural sky changes sunlight, twilight colour and cloud structure over time. It pauses while the tab is hidden and falls back to a CSS scene if WebGL is unavailable. Turn **Animate sky** off for a still atmosphere; the scene can still update as the sun or weather changes. The header follows the shared Opacity setting, and Home hover previews stay aligned with their thumbnails.

For a rainy mood anytime, turn on **RAIN** inside **Time-of-day background**. It adds heavy falling rain, a gloomy overcast sky and water droplets on glass to Home, Search and channel pages in any scene, without enabling Live weather or requesting access. **Animate sky** controls the rain's movement. The switch saves your preference and adds visual rain only, leaving your music/video audio unchanged. Turning RAIN off removes water droplets on the glass while letting Live weather still show outdoor rain or storm skies when your chosen city is raining.

To add weather, turn on **Time-of-day background**, select **Auto**, then enable **Live sun & weather**. Use **Choose a city** to change the location. The browser asks for optional Open-Meteo access for weather and city search; use **Allow weather access** if permission is missing. Your chosen city coordinates or city-search text go to Open-Meteo; the extension does not request GPS. Solar lighting works offline. Weather normally refreshes every 15 minutes, with cached fallback for up to two hours when fetching fails. [Privacy details](docs/PRIVACY-EN.md)

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Get started

1. Download the extension ZIP from [Releases](https://github.com/Moments2505/better-visual-youtube/releases) and extract it.
2. Open `edge://extensions` or `chrome://extensions` and turn on **Developer mode**.
3. Select **Load unpacked**, then choose the folder containing `manifest.json`.
4. Reload YouTube and open the extension to explore the settings.

[English installation guide](INSTALL-EN.md) · [Hướng dẫn cài đặt tiếng Việt](INSTALL-VI.md)

**Updating an existing installation:** extract the new ZIP over the files in the same extension folder, click **Reload** on the extensions page, then reload YouTube. Keep the existing installation to retain its saved preferences. Optional weather access is requested only when you use weather or city search.

Found a bug or have an idea? [Open an issue](https://github.com/Moments2505/better-visual-youtube/issues).

## Build with us

The source is open under the [MIT license](LICENSE). You can load this repository directly as an unpacked extension; no build step is needed.

To run the source checks and create a release ZIP, use Node.js 22+:

```sh
node scripts/check.js
node scripts/package-release.js
```

See [Contributing](CONTRIBUTING.md) for the source layout and development notes.

## Credits

Created by **Team Visualism**. Ambient Light includes modified code from [youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight) by Wessel Kroos, used under MIT. The glass effects draw on [this CSS/SVG refraction article](https://kube.io/blog/liquid-glass-css-svg/). See [Third-party notices](THIRD-PARTY-NOTICES.md) for details.

[Privacy policy](docs/PRIVACY-EN.md) · [Chính sách quyền riêng tư](docs/PRIVACY-VI.md) · [Contact](mailto:quannguyenproducer2505@gmail.com)

An independent project, unaffiliated with YouTube, Google, Apple or Microsoft.
