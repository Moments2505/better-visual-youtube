# Changelog / Lịch sử thay đổi

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
