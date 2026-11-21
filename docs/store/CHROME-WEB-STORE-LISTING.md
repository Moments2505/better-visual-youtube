# Chrome Web Store Submission Kit — Better Visual for YouTube

Use the verified assets and copy-paste answers below when submitting `dist/releases/Better-visual-Youtube-0.7.2.zip` on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## 1. Upload Files Checklist

- **Extension ZIP package**: `dist/releases/Better-visual-Youtube-0.7.2.zip`
- **Store icon (`128×128`)**: `assets/icons/icon128.png`
- **Promo tile (`440×280`, 24-bit RGB PNG)**: `docs/store/screenshots/promo-small-440x280.png`
- **Screenshots (`1280×800`, 24-bit RGB PNG)**:
  1. `docs/store/screenshots/01-watch-ambient-cinema-1280x800.png` — Watch Page + Cinema Ambient Light & Auto Black-Bar Crop
  2. `docs/store/screenshots/02-watch-popup-controls-1280x800.png` — Live Popup Style Profiles & Fine Controls
  3. `docs/store/screenshots/03-home-daylight-sky-1280x800.png` — Frosted Navigation, Active Capsule & Time-of-Day Procedural Sky
  4. `docs/store/screenshots/04-shorts-ambient-autocrop-1280x800.png` — YouTube Shorts Vertical Glow & Asymmetric Letterbox Auto-Crop
  5. `docs/store/screenshots/05-watch-light-frosted-1280x800.png` — Daylight Frosted Light Theme on Watch Page

---

## 2. Store Listing Tab

- **Name**: `Better Visual for YouTube`
- **Short Summary (`manifest.json` description — 85/132 chars)**:
  `Give YouTube a new look with Liquid Glass, Ambient Light and customizable animations.`
- **Category**: `Make Chrome Yours` (or `Accessibility & Customization` / `Productivity` if Chrome asks)
- **Language**: `English` (primary; Vietnamese localization built into `_locales/vi`)
- **Official Links**:
  - **Homepage URL**: `https://github.com/Moments2505/better-visual-youtube`
  - **Support URL**: `https://github.com/Moments2505/better-visual-youtube/issues`
  - **Privacy Policy URL**: `https://moments2505.github.io/better-visual-youtube/privacy/`

### Detailed Description (English — Copy/Paste)

```text
Transform desktop YouTube with frosted Liquid Glass surfaces, frame-reactive Ambient Light, intelligent black-bar auto-cropping, and smooth UI animations — with everything processed locally on your device.

KEY FEATURES

• Liquid Glass UI & Optics
  Restyles YouTube's masthead, search bar, player control bar, side navigation, and info/comment panels with frosted glass transparency, specular rim highlights, optical SVG refraction lenses, and customizable blur, opacity, and colour tint (including Media-synced tinting).

• Ambient Light Engine (Watch & Shorts)
  Projects subtle colour glow beyond the video frame on both normal/theater/fullscreen Watch pages and YouTube Shorts, with presets (Eco, Balanced, High, Auto), Flicker Reduction, Brightness, Spread, Vibrance, and Glass Rim Sync.

• Intelligent Black-Bar Auto-Crop
  Automatically detects and crops baked-in 21:9 letterbox, 4:3 pillarbox, studio-black, and asymmetric Shorts black bars while protecting burned-in captions and holding steady during fade-to-black scenes.

• One-Click Style Profiles
  Switch instantly between Crystal Clear, Tahoe Frosted, Cinema Glow, and Eco Minimal, or export/import your settings as JSON. Preferences stay backed up via browser profile sync.

• Immersive Experience & Procedural Sky
  Includes Immersive Cinema idle dimming, Zen Watch layout, Hide Shorts Shelf toggle, customizable keyboard shortcuts (Alt+Shift+G / Alt+Shift+A / Alt+Shift+D), and an optional WebGL Time-of-Day Sky background on Home, Search, and Channel pages (with optional opt-in Open-Meteo local weather).

PRIVACY FIRST

• No account required, no analytics, and no remote servers.
• Video colour sampling and bar detection run locally in your browser.
• Optional Live Weather access to Open-Meteo is off by default and requested only if you enable it.
```

### Mô tả chi tiết (Tiếng Việt — Dùng cho bản dịch Store VI nếu cần)

```text
Làm mới giao diện YouTube trên máy tính với chất liệu kính lỏng Liquid Glass, ánh sáng viền Ambient Light bám sát từng khung hình, tự động cắt viền đen thông minh và chuyển động mượt mà — xử lý hoàn toàn cục bộ trên thiết bị.

TÍNH NĂNG CHÍNH

• Giao diện Kính lỏng & Khúc xạ Quang học: Thanh tìm kiếm, thanh đầu trang, thanh điều khiển video, menu bên và khung bình luận/mô tả dùng kính mờ tùy chỉnh độ mờ, độ trong suốt và màu tint (có tự đồng bộ màu theo video).
• Ambient Light cho trang Xem & Shorts: Phủ quầng sáng mượt quanh khung phát với các mức Eco / Balanced / High / Auto, giảm nhấp nháy, đồng bộ viền kính và hỗ trợ YouTube Shorts.
• Tự động cắt viền đen thông minh: Tự nhận diện viền đen ngang/dọc, viền đen studio, cảnh tối hoặc thanh đen bất đối xứng trên Shorts mà không cắt lẹm phụ đề.
• Cấu hình 1 chạm & Đồng bộ: Chuyển nhanh giữa Crystal Clear, Tahoe Frosted, Cinema Glow, Eco Minimal; xuất/nhập JSON và đồng bộ cài đặt qua tài khoản trình duyệt.
• Rạp phim nhập vai, Zen Watch & Nền trời 3D theo giờ: Làm mờ giao diện thừa khi xem, ẩn mục Shorts trên Trang chủ, phím tắt nhanh (Alt+Shift+G / A / D) và tùy chọn bầu trời thời gian thực.

QUYỀN RIÊNG TƯ: Không quảng cáo, không theo dõi lịch sử xem, không máy chủ thu thập dữ liệu. Quyền thời tiết Open-Meteo tắt mặc định và chỉ xin khi người dùng tự bật.
```

---

## 3. Privacy Practices Tab (Copy/Paste)

### Single Purpose Description

```text
Customizes the visual appearance of desktop YouTube (https://www.youtube.com/*) by rendering configurable Liquid Glass surfaces, on-device Ambient Light and black-bar auto-cropping, optional procedural sky backgrounds, and UI animations.
```

### Permission Justifications

- **`storage`**:
```text
Saves user appearance preferences, style profiles, and optional selected city name/coordinates in chrome.storage.local (with cached weather responses kept locally) and mirrors preferences across the user's signed-in Chrome/Edge profile via chrome.storage.sync.
```

- **Host permission (`https://www.youtube.com/*`)**:
```text
Needed to inject styles and client-side scripts on desktop YouTube pages to apply Liquid Glass UI styling, discover the video player, sample video/thumbnail colors locally in memory for Ambient Light and black-bar auto-cropping, and control optional interface modes such as Immersive Cinema and Zen Watch. Excludes /embed/*, /live_chat*, and /tv*.
```

- **Optional host permissions (`https://api.open-meteo.com/*`, `https://geocoding-api.open-meteo.com/*`)**:
```text
Disabled by default and requested only if the user explicitly enables Live sun & weather or searches for a city in the Time-of-day background settings. Sends only the user-selected city coordinates or search text with referrer and credentials omitted; never accesses GPS or YouTube data.
```

- **Remote Code**:
  Select **`No, I am not using Remote code`** (all JavaScript and CSS ships statically inside the extension archive; the `"world": "MAIN"` content script runs packaged file `vendor/ambient/injected.js`).

### Data Usage Disclosures

- Check **User data is collected?** → Declare **Location (coarse/city coordinates only when optional Live Weather / City Search is enabled by the user)**:
  - Used only for **App functionality / Personalization** (displaying chosen city's procedural sky/weather on Home/Search/Channel pages).
  - Or note clearly in reviewer notes that no personal location or browsing data is collected automatically (only user-typed city name or chosen city coordinates are sent to Open-Meteo upon explicit opt-in).
- Check **all 3 Chrome Web Store Limited Use certifications**:
  1. I do not sell or transfer user data to third parties, outside of the approved use cases.
  2. I do not use or transfer user data for purposes unrelated to the item's single purpose.
  3. I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Reviewer Testing Notes (Important!)

```text
1. Open https://www.youtube.com/ or any desktop watch video (/watch) or /shorts page to see Liquid Glass styling immediately.
2. Click the toolbar icon to switch Style Profiles (Crystal Clear, Tahoe Frosted, Cinema Glow, Eco Minimal), toggle Ambient Light & Auto Black-Bar Crop, or tune Blur / Opacity / Tint.
3. Optional Open-Meteo permissions (api.open-meteo.com, geocoding-api.open-meteo.com) are NOT required unless you explicitly open Time-of-day background in the popup and click "Allow weather access" / search for a city.
4. No login or external API key is needed to test all core features.
```
