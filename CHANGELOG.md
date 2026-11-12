# Changelog / Lịch sử thay đổi

## 0.5.0 — 2026-11-12

- Added 1-click **Style Profiles** (*Crystal Clear*, *Tahoe Frosted*, *Cinema Glow*, *Eco Minimal*), cross-device `chrome.storage.sync` mirroring, JSON settings **Export / Import**, and native English + Vietnamese (`_locales/en`, `_locales/vi`) popup localization.
- Thêm thanh **Cấu hình nhanh** 1 chạm (*Trong suốt pha lê*, *Kính mờ Tahoe*, *Rạp phim rực rỡ*, *Tiết kiệm tối giản*), đồng bộ cài đặt qua `chrome.storage.sync`, **Xuất / Nhập** tệp JSON và bản địa hóa gốc Anh/Việt (`_locales/en`, `_locales/vi`) cho Popup.
- Migrated Ambient Light execution to native Manifest V3 `"world": "MAIN"` content scripts (removing dynamic cross-origin tag injection and `web_accessible_resources`) and replaced 753 KB static debanding PNGs with cached procedural `<canvas>` noise, cutting release ZIP size by **70%** (~309 KB).
- Chuyển Ambient Light sang cơ chế MV3 `"world": "MAIN"` gốc (loại bỏ tiêm thẻ cross-origin và `web_accessible_resources`) và thay thế 753 KB ảnh nhiễu PNG bằng nhiễu procedural `<canvas>` có bộ nhớ đệm, giảm **70%** dung lượng gói ZIP (~309 KB).
- Introduced explicit CSS `@layer` cascade architecture (`ylg-a11y`, `ylg-ceiling`, `ylg-states`, `ylg-components`, `ylg-tokens`), eliminated repeated-selector specificity hacks, fused the `y = 56px` masthead-to-sidebar seam under Time-of-day sky backgrounds, and improved dark-mode secondary metadata contrast over bright Ambient Light.
- Áp dụng kiến trúc phân tầng CSS `@layer`, xóa bỏ các selector lặp class tăng độ ưu tiên, làm liền mạch đường nối `y = 56px` giữa thanh đầu trang và thanh bên khi bật nền trời theo giờ, đồng thời tăng độ rõ chữ phụ trong giao diện tối trên nền Ambient sáng.
- Refined fresh-install defaults (`theme: "auto"`, `blur: 14px`, `opacity: 37%`), fixed channel-page live weather messaging, eliminated YouTube Blob Worker CSP & Canvas2D readback warnings, removed dead Sentry telemetry code, excluded `/embed/*`, `/live_chat*` and `/tv*` frames, and added automated Node 22 GitHub Actions CI + tag release workflows.
- Tinh chỉnh mặc định cài mới (`theme: "auto"`, `blur: 14px`, `opacity: 37%`), sửa kết nối thời tiết trên trang kênh, triệt tiêu lỗi CSP Blob Worker & cảnh báo Canvas2D trên YouTube, gỡ bỏ mã Sentry thừa, loại trừ khung `/embed/*`, `/live_chat*`, `/tv*` và bổ sung quy trình CI/Release tự động trên GitHub Actions.

## 0.4.80 — 2026-11-10

- Official release, including the light-mode, sky visibility, opacity and optional system-motion fixes developed in 0.4.70–0.4.79.
- Phát hành chính thức, tổng hợp các sửa lỗi light mode, độ rõ nền trời, Opacity và tùy chọn giảm chuyển động từ 0.4.70–0.4.79.
- Glass tint gradually eases into opaque white across the upper opacity range. The 99–100% step no longer swaps the surface colour or reading palette abruptly.
- Kính chuyển dần từ màu tint sang trắng đục ở vùng Opacity cao; bỏ bước đổi màu nền và màu chữ đột ngột giữa 99–100%.

## 0.4.79 — 2026-11-08

- Opacity 100% now uses solid white for the masthead and glass panels, independent of tint or sampled video colour. Reading text uses dark ink without Ambient text glow; lowering opacity restores the selected tint.
- Opacity 100% dùng nền trắng đặc cho headbar và panel kính, không bị màu tint hoặc video làm tối nền. Chữ nội dung dùng màu tối, bỏ bóng sáng của Ambient; giảm Opacity sẽ khôi phục màu tint đã chọn.

## 0.4.78 — 2026-11-08

- Headbar and panel fills now use the same opacity/tint scrim throughout the slider range. Removed independent light-mode and sky-headbar opacity floors and additive panel fill gradients; retained separate reading-text and accessibility rules.
- Headbar và panel dùng chung lớp màu/Opacity trên toàn thanh kéo. Bỏ mức đục riêng của light mode, headbar nền trời và gradient nền panel chồng lớp; giữ xử lý màu chữ và khả năng tiếp cận riêng.

## 0.4.77 — 2026-11-08

- Opacity 100% now reaches alpha 1 instead of 0.85. Panel, hero and floating glass surfaces receive a solid tint at the maximum; existing saved alpha values remain unchanged.
- Opacity 100% đạt alpha 1 thay vì 0.85; panel và cửa sổ kính có nền đặc ở mức tối đa. Giữ nguyên giá trị alpha đã lưu trước đó.

## 0.4.76 — 2026-11-08

- Light-mode video reading content uses bright text with a restrained shadow when glass opacity is below 0.6; at higher opacity it returns to native dark text. The glass opacity remains unchanged, and masthead/player/button palettes remain independent.
- Vùng chữ nội dung video trong light mode chuyển sang chữ sáng có bóng nhẹ khi alpha kính dưới 0.6, trở lại chữ tối khi alpha cao hơn. Giữ nguyên Opacity kính và màu riêng của thanh đầu trang, nút, bộ điều khiển video.

## 0.4.75 — 2026-11-07

- Light-mode Ambient surfaces now share the glass Opacity value across panels, masthead and unselected chips. Removed fixed opaque fills; Opacity zero keeps the clear-material state.
- Đồng bộ Opacity của panel, thanh đầu trang và chip chưa chọn trong light mode với kính; bỏ nền đục cố định, Opacity bằng 0 giữ chế độ trong suốt.

## 0.4.74 — 2026-11-07

- Light YouTube appearance now keeps neutral pale reading surfaces behind metadata, comments, recommendations and the masthead when Ambient Light is active; unselected topic chips also retain dark readable text on a pale surface.
- Hiệu chỉnh giao diện YouTube sáng khi bật Ambient: thêm nền sáng trung tính sau vùng thông tin video, bình luận, gợi ý và thanh đầu trang; chip chủ đề giữ chữ tối dễ đọc trên nền sáng.

## 0.4.73 — 2026-11-07

- Fixed the ambient CSS still hiding a running engine after turning off Follow system reduced motion. Forced-colour suppression remains active.
- Sửa CSS vẫn ẩn Ambient dù engine đã chạy sau khi bỏ chọn Follow system reduced motion. Chế độ tương phản cao vẫn tắt hiệu ứng trang trí.

## 0.4.72 — 2026-11-07

- Added **Follow system reduced motion**, enabled by default. Turn it off to use Motion effects, Animate sky and Ambient Light independently of the browser's reduced-motion signal. Each effect keeps its own switch.
- Thêm **Follow system reduced motion**, mặc định bật. Bỏ chọn để Motion effects, Animate sky và Ambient Light hoạt động độc lập với tín hiệu giảm chuyển động của trình duyệt; từng hiệu ứng vẫn có công tắc riêng.

## 0.4.71 — 2026-11-07

- Lift the night sky's blue atmosphere at moderate background intensity while preserving star highlights and the separate rain treatment.
- Tăng độ rõ của sắc trời đêm khi cường độ nền ở mức vừa; giữ sao sáng và xử lý nền mưa riêng.

## 0.4.70 — 2026-11-07

- Light-theme RAIN uses a pale overcast veil so native dark text and navigation icons remain readable over the sky.
- Nâng sáng nền mưa trong giao diện sáng để chữ đen và biểu tượng điều hướng dễ đọc.

## 0.4.69 — 2026-11-07

- Make the channel tab toolbar transparent independently of the masthead glass.
- Tách hàng tab kênh thành nền trong suốt, giữ lớp kính của thanh đầu trang.

## 0.4.68 — 2026-11-07

- Restore the masthead glass above scrolling channel headers, keep a readable minimum sky-navigation fill, and style the sticky channel tab toolbar consistently.
- Sửa lớp kính đầu trang bị ẩn hoặc nằm dưới nội dung kênh khi cuộn; giữ nền điều hướng dễ đọc và đồng bộ kính cho hàng tab kênh.

## 0.4.67 — 2026-11-06

- Suspend live-video glass sampling across player controls while dragging the seek bar; keep drag tracking active with Motion effects off or reduced motion enabled.
- Giảm tải lọc kính trên bộ điều khiển khi kéo thanh tua; nhận diện kéo hoạt động cả khi tắt Motion effects hoặc bật giảm chuyển động.

## 0.4.66 — 2026-11-06

- Keep sky, Live weather and RAIN backgrounds on channel pages and channel tabs, including direct links and navigation from Home/Search.
- Giữ nền trời, Live weather và RAIN trên trang kênh và các tab của kênh, cả khi mở trực tiếp hoặc chuyển từ Trang chủ/Tìm kiếm.

## 0.4.65 — 2026-11-06

### English
- Fixed Live weather keeping rain and wet-glass effects enabled after switching RAIN off. The switch now controls both visual effects directly while solar lighting and weather data continue updating.

### Tiếng Việt
- Sửa Live weather giữ mưa và nước bám kính khi đã tắt RAIN. Công tắc giờ điều khiển trực tiếp cả hai hiệu ứng, trong khi ánh sáng mặt trời và dữ liệu thời tiết vẫn cập nhật.

## 0.4.64 — 2026-11-06

### English
- Added **RAIN** in Time-of-day background: turn on visual rain on Home and Search in any sky scene, even with Live weather off.
- Heavy rain adds dense falling streaks, a gloomy overcast sky and water beads/trails on glass. The preference is saved; Animate sky controls its movement.
- No weather permission or rain audio is added by this switch.

### Tiếng Việt
- Thêm **RAIN** trong Time-of-day background: bật mưa trên Trang chủ/Tìm kiếm ở mọi cảnh trời, kể cả khi tắt Live weather.
- Mưa lớn có các lớp vệt rơi dày, trời âm u và giọt/vệt nước bám trên kính. Lựa chọn được lưu; Animate sky điều khiển chuyển động.
- Công tắc này không xin quyền thời tiết hay thêm âm thanh mưa.

## 0.4.63 — 2026-11-06

Public beta incorporating the local 0.4.59–0.4.62 candidates below. / Bản beta công khai tổng hợp các bản thử nội bộ 0.4.59–0.4.62 bên dưới.

### English
- Fixed Home hover previews appearing 56px below their thumbnails with the sky background enabled. The sky no longer changes the native preview's positioning reference.
- Restored a bounded glass header when the sky is enabled and panel Opacity is 0. Low-FX uses a solid fallback; system transparency and forced-colour preferences remain supported.
- Includes the procedural sky, optional city-based sun/weather, independent sky animation, Motion/Ambient fixes and lighter seek/volume hover effects from the local candidates.
- Expanded both READMEs with sky setup, optional weather access, the header behaviour and update instructions that retain saved settings.

### Tiếng Việt
- Sửa preview khi rê chuột ở Trang chủ bị lệch xuống 56px so với thumbnail lúc bật nền trời. Nền không còn đổi mốc định vị preview gốc của YouTube.
- Khôi phục lớp kính giới hạn trong headbar khi bật nền trời và Opacity của panel bằng 0. Low-FX dùng nền đặc dự phòng; vẫn hỗ trợ tùy chọn độ trong suốt và màu tương phản của hệ thống.
- Bao gồm nền trời procedural, mặt trời/thời tiết theo thành phố tùy chọn, Animate sky độc lập, các sửa lỗi Motion/Ambient và hiệu ứng hover tua/âm lượng nhẹ hơn từ các bản thử nội bộ.
- Bổ sung README Anh/Việt: cách bật nền trời, quyền thời tiết tùy chọn, hành vi headbar và cách cập nhật giữ cài đặt.

## 0.4.62 — 2026-11-06

### English
- Added an original, continuous WebGL sky: procedural cloud structure, atmospheric colour, sunlight and a textured night sky. No generated background images or four-image crossfade.
- Hidden tabs stop sky drawing, still mode stops recurring draws, and WebGL failure restores the CSS fallback.
- Save the Live weather choice before asking browser permission so a closing popup does not discard it; added an explicit **Allow weather access** retry and visible build version.
- Removed live-video backdrop sampling from the moving seek lens; kept its transparent fill and specular rim. Native seek previews keep native positioning without the extra entrance animation.

### Tiếng Việt
- Thêm bầu trời WebGL liên tục: mây dựng bằng thuật toán, màu khí quyển, ánh mặt trời và trời đêm có chi tiết. Không dùng ảnh nền tạo sẵn hoặc chuyển giữa bốn ảnh.
- Dừng vẽ nền trời khi tab ẩn, tắt vòng vẽ khi giữ cảnh tĩnh và dùng nền CSS nếu WebGL lỗi.
- Lưu lựa chọn Live trước khi hỏi quyền để tránh mất khi popup đóng; bổ sung **Allow weather access** và số phiên bản đang chạy.
- Bỏ lấy mẫu video nền ở thấu kính tua đang di chuyển, giữ lớp trong và viền sáng; preview tua dùng vị trí gốc, không cộng thêm animation xuất hiện.

## 0.4.61 — 2026-11-06

### English
- Added optional **Live sun & weather** for Home/Search in Auto, with Hà Nội as the initial city and explicit city search.
- Solar lighting is computed locally from the selected coordinates and UTC time. Weather adds clouds, rain, fog or snow using Open-Meteo model data.
- Added optional weather-host permission, shared 15-minute cache, request deduplication and offline fallback. Hidden tabs stop sky timers; no per-frame JavaScript or video capture is added.
- Kept **Animate sky** independent of interface motion. Manual scenes and existing settings remain available.

### Tiếng Việt
- Thêm **Live sun & weather** tùy chọn cho Trang chủ/Tìm kiếm ở Auto, mặc định Hà Nội và có tìm thành phố.
- Tính ánh sáng mặt trời trên máy theo tọa độ và giờ UTC; bổ sung mây, mưa, sương hoặc tuyết theo dữ liệu mô hình Open-Meteo.
- Xin quyền kết nối thời tiết khi sử dụng, lưu đệm chung 15 phút, gộp yêu cầu giữa các tab và có phương án khi mất mạng. Tab ẩn dừng bộ hẹn giờ nền; không thêm JavaScript chạy mỗi khung hình hay chụp video.
- Giữ **Animate sky** độc lập với chuyển động giao diện; vẫn chọn được các cảnh thủ công.

## 0.4.60 — 2026-11-06

### English

- Fixed the sky being hidden by Ambient Light's opaque page fill after returning from a video. Home/Search sky rules now survive the vendor stylesheet loading later; video-page ambient is restored when leaving those routes.
- Expanded the night scene with a cratered moon, a denser star field and a slowly drifting Milky Way band. The scene uses four decorative layers with transform/opacity animation.
- Added **Animate sky**, independent of interface **Motion effects**. Reduced motion and hidden tabs still pause the sky.

### Tiếng Việt

- Sửa lỗi bầu trời bị lớp nền đặc của Ambient Light che sau khi quay về từ video. Nền Trang chủ/Tìm kiếm vẫn hiển thị khi CSS Ambient được nạp muộn; Ambient ở trang video được trả lại khi rời các trang này.
- Bổ sung mặt trăng có chi tiết bề mặt, nhiều sao hơn và dải Ngân Hà trôi chậm. Cảnh dùng bốn lớp trang trí, chỉ chuyển động bằng transform/opacity.
- Thêm **Animate sky** riêng với **Motion effects** của giao diện. Nền vẫn dừng khi hệ thống yêu cầu giảm chuyển động hoặc tab bị ẩn.

## 0.4.59 — 2026-11-06

### English

- Fixed Ambient Light switching off and leaving a black backdrop when **Motion effects** was disabled.
- Motion off now suspends hover magnification, panel movement and hover-driven column stacking. Static glass and the saved hover preference are retained.
- Added a hint explaining that Motion effects and Ambient Light are independent.
- Reduced seek/volume hover work: pause video-to-CPU tint readback during interaction and use a lighter thumb/capsule backdrop while retaining the glass fill and rim. Native seeking and volume controls are unchanged.
- Replaced chip SVG displacement with a capped, static glass blur to address split/flickering text at the top of the page. Removed unused chip lens texture work.
- Added an optional time-of-day sky on Home and Search: morning sun, daytime sky, sunset and stars at night. Auto uses the device's local clock; Motion off keeps a still scene.
- Reduced interaction polling during video tint sampling.

### Tiếng Việt

- Sửa lỗi tắt **Motion effects** làm Ambient Light tắt theo và nền trở thành màu đen.
- Khi Motion off, tạm dừng phóng đại hover, chuyển động panel và đổi thứ tự lớp cột theo hover. Giữ kính tĩnh và lựa chọn hover đã lưu.
- Thêm chú thích trong bảng cài đặt để làm rõ Motion effects và Ambient Light hoạt động độc lập.
- Giảm tải khi hover thanh tua/âm lượng: tạm ngưng đọc màu video về CPU trong lúc tương tác và dùng lớp nền kính nhẹ hơn, giữ màu kính và viền. Giữ nguyên cách tua và chỉnh âm lượng của YouTube.
- Thay bộ lọc méo SVG của chip bằng blur kính tĩnh có giới hạn để xử lý chữ tách đôi/nhấp nháy ở đầu trang. Bỏ phần tạo texture kính không còn dùng cho chip.
- Thêm nền theo thời gian tùy chọn ở Trang chủ và Tìm kiếm: mặt trời buổi sáng, trời ban ngày, hoàng hôn và sao ban đêm. Auto dùng giờ máy; tắt Motion giữ cảnh tĩnh.
- Giảm tần suất dò trạng thái tương tác khi lấy màu video.

## 0.4.58 — 2026-11-05

Changes since the first public beta, 0.4.53.

### English

- Added wheel adjustment for settings sliders, using their existing steps and save behaviour.
- Added **Hover effects**, independent of **Motion effects**.
- Added **Follow system transparency**. Glass stays transparent by default; system mode uses solid surfaces when reduced transparency is requested.
- Matched solid header/sidebar colours to YouTube's light or dark appearance, keeping text readable when system and site themes differ.
- Changed hover selection for video details, comments and recommendations to use their original layout bounds. The selected panel appears above panels that are shrinking.
- Added an optional English/Vietnamese feedback page after uninstall, with reasons, a comment box, an email draft and a copy option. No answers are sent automatically.

### Tiếng Việt

- Thêm chỉnh slider bằng con lăn chuột, giữ nguyên từng nấc và cách lưu cài đặt.
- Thêm **Hover effects** để bật/tắt hover riêng với **Motion effects**.
- Thêm **Follow system transparency**. Mặc định giữ kính trong suốt; có thể bật tùy chọn này để dùng nền đặc theo yêu cầu của hệ thống.
- Đồng bộ màu nền đặc của headbar/sidebar với giao diện sáng hoặc tối của YouTube, tránh chữ và nền lệch màu.
- Chọn hover cho chi tiết video, bình luận và đề xuất theo khung gốc. Panel đang chọn nằm trên các panel đang thu lại.
- Thêm trang góp ý tự nguyện Anh/Việt khi gỡ extension: chọn lý do, nhập góp ý, mở bản nháp email hoặc sao chép nội dung. Không tự động gửi câu trả lời.

## 0.4.53 — 2026-11-05

First public beta: Liquid Glass, Ambient Light, interface animations, saved preferences and English/Vietnamese installation guides.

Bản beta công khai đầu tiên: Liquid Glass, Ambient Light, chuyển động giao diện, lưu cài đặt và hướng dẫn cài đặt Anh/Việt.
