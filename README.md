# Better visual Youtube

An open-source desktop YouTube extension for Microsoft Edge and Google Chrome, with Liquid Glass surfaces, optical effects, Ambient Light and interface animations.

**Beta — version 1.4.53.** Hovering, seeking and volume adjustment can still stutter. Performance work is ongoing; this version is not a confirmed stable store release. Automated checks do not measure displayed FPS or physical input latency.

Tiện ích mã nguồn mở cho YouTube trên máy tính, với giao diện Liquid Glass, hiệu ứng quang học, Ambient Light và chuyển động giao diện. **Bản beta 1.4.53:** vẫn có thể giật khi hover, tua hoặc chỉnh âm lượng; chưa xác nhận đủ ổn định để phát hành trên kho.

## Install / Cài đặt

1. Download this repository using **Code → Download ZIP**, then extract it, or clone it with Git.
2. Open `edge://extensions` or `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Reload YouTube and open the extension popup to adjust effects.

Tải repo bằng **Code → Download ZIP**, giải nén, mở trang quản lý tiện ích, bật **Chế độ nhà phát triển**, chọn **Tải tiện ích đã giải nén** rồi trỏ tới thư mục có `manifest.json`. Tải lại YouTube.

- [English installation and troubleshooting](INSTALL-EN.md)
- [Hướng dẫn cài đặt và xử lý lỗi tiếng Việt](INSTALL-VI.md)

No build step or dependencies are required to load the extension. The target is desktop Edge/Chrome on `www.youtube.com`; optical rendering depends on browser support and hardware. The manifest's minimum version is not a claim of testing every browser release.

## Features and settings

- Glass surfaces for the header, search box, chips, player controls and content panels.
- Adjustable tint, opacity, blur, radius, highlight, refraction and magnification.
- Bundled Ambient Light with quality, intensity, spread and frame-rate controls.
- Optional hover, popup, sidebar and player layout animations.
- Local settings. Fresh installs and Reset use the author's captured defaults in [default-settings.json](default-settings.json); existing preferences are preserved.

To compare rendering costs, test the same video with **Optical depth** off, then separately with **Ambient Light** off. There is no 60fps guarantee. Include your browser version, GPU, display refresh rate and affected interaction in a performance report.

## Development

Requirements for checks and packaging: Node.js 22+ and Python 3.12+; no third-party packages.

```sh
python scripts/check.py
python scripts/package-release.py --output-dir dist
```

The checks run all standalone regression suites. Packaging validates the manifest, runtime dependencies, third-party license and ZIP contents. Output is a ZIP plus SHA-256 checksum in `dist/`. Local browser traces, screenshots, saved profiles and release binaries are excluded from source control.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the source layout and browser testing expectations. Report bugs through [GitHub Issues](https://github.com/Soul-blade-2505/better-visual-youtube/issues). Never include cookies, credentials or an unreviewed browser trace.

## Privacy, support and license

- [Privacy policy (English)](docs/PRIVACY-EN.md) · [Chính sách quyền riêng tư](docs/PRIVACY-VI.md)
- Maintainer: **QuanNguyen** · [quannguyenproducer2505@gmail.com](mailto:quannguyenproducer2505@gmail.com)
- [MIT license](LICENSE). Previously named YouTube Liquid Glass; internal `YLG` identifiers remain for compatibility.
- Bundled, locally modified Ambient Light code: [youtube-ambilight by Wessel Kroos](https://github.com/WesselKroos/youtube-ambilight), MIT. See [third-party notices](THIRD-PARTY-NOTICES.md) and [its retained license](vendor/ambient/LICENSE).
- Refraction technique reference: [Liquid Glass in CSS/SVG](https://kube.io/blog/liquid-glass-css-svg/).

Independent project; not affiliated with or endorsed by YouTube, Google, Apple or Microsoft.
