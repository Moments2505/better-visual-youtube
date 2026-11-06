# Changelog / Lịch sử thay đổi

## 0.4.63 — 2026-11-06

Public beta incorporating the local 0.4.59–0.4.62 candidates below. / Bản beta công khai tổng hợp các bản thử nội bộ 0.4.59–0.4.62 bên dưới.

### English
- Fixed Home hover previews appearing 56px below their thumbnails with the sky background enabled. The sky no longer changes the native preview's positioning reference.
- Restored a bounded glass header when the sky is enabled and panel Opacity is 0. Low-FX uses a solid fallback; system transparency and forced-colour preferences remain supported.
- Includes the procedural sky, optional city-based sun/weather, independent sky animation, Motion/Ambient fixes and lighter seek/volume hover effects from the local candidates.
- Expanded both READMEs with sky setup, optional weather access, the header behaviour and update instructions that retain saved settings.
- Validated the header and two Home hover previews visually on Edge. An exploratory 0.4.62 trial recorded 40 injected pointer events per player control: rAF median 25ms for both, p95 41.7ms for seek and 33.3ms for volume. These are callback scheduling observations from one environment, not presented FPS, physical input latency or evidence of an improvement. No matched baseline, 120fps or cross-GPU result is claimed.

### Tiếng Việt
- Sửa preview khi rê chuột ở Trang chủ bị lệch xuống 56px so với thumbnail lúc bật nền trời. Nền không còn đổi mốc định vị preview gốc của YouTube.
- Khôi phục lớp kính giới hạn trong headbar khi bật nền trời và Opacity của panel bằng 0. Low-FX dùng nền đặc dự phòng; vẫn hỗ trợ tùy chọn độ trong suốt và màu tương phản của hệ thống.
- Bao gồm nền trời procedural, mặt trời/thời tiết theo thành phố tùy chọn, Animate sky độc lập, các sửa lỗi Motion/Ambient và hiệu ứng hover tua/âm lượng nhẹ hơn từ các bản thử nội bộ.
- Bổ sung README Anh/Việt: cách bật nền trời, quyền thời tiết tùy chọn, hành vi headbar và cách cập nhật giữ cài đặt.
- Đã kiểm tra hình ảnh headbar và hai preview ở Trang chủ trên Edge. Lượt khám phá trên 0.4.62 ghi 40 sự kiện pointer do công cụ gửi cho mỗi vùng điều khiển: rAF median 25ms ở cả hai, p95 41,7ms khi hover tua và 33,3ms ở âm lượng. Đây là nhịp callback trong một môi trường, chưa phải FPS hiển thị, độ trễ chuột vật lý hoặc bằng chứng cải thiện. Chưa có baseline tương đương, kết quả 120fps hay so sánh giữa các GPU.

## 0.4.62 — 2026-11-06

### English
- Added an original, continuous WebGL sky: procedural cloud structure, atmospheric colour, sunlight and a textured night sky. No generated background images or four-image crossfade.
- Capped the sky to one 960×540 canvas and up to 20 updates/second; hidden tabs stop drawing, still mode stops recurring draws, and WebGL failure restores the CSS fallback.
- Save the Live weather choice before asking browser permission so a closing popup does not discard it; added an explicit **Allow weather access** retry and visible build version.
- Removed live-video backdrop sampling from the moving seek lens; kept its transparent fill and specular rim. Native seek previews keep native positioning without the extra entrance animation.
- Exploratory installed-Edge hover scheduling observations are recorded under 0.4.63; presented GPU FPS, physical input latency, 120fps and cross-GPU performance remain unverified.

### Tiếng Việt
- Thêm bầu trời WebGL liên tục: mây dựng bằng thuật toán, màu khí quyển, ánh mặt trời và trời đêm có chi tiết. Không dùng ảnh nền tạo sẵn hoặc chuyển giữa bốn ảnh.
- Giới hạn một canvas 960×540, tối đa 20 lần cập nhật/giây; dừng vẽ khi tab ẩn, tắt vòng vẽ khi giữ cảnh tĩnh và dùng nền CSS nếu WebGL lỗi.
- Lưu lựa chọn Live trước khi hỏi quyền để tránh mất khi popup đóng; bổ sung **Allow weather access** và số phiên bản đang chạy.
- Bỏ lấy mẫu video nền ở thấu kính tua đang di chuyển, giữ lớp trong và viền sáng; preview tua dùng vị trí gốc, không cộng thêm animation xuất hiện.
- Kết quả khám phá nhịp hover trên Edge đã cài được ghi ở mục 0.4.63; chưa xác minh FPS GPU hiển thị, độ trễ chuột vật lý, 120fps hay hiệu năng giữa các GPU.

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
- Added a visual regression fixture that includes the real, later-loaded Ambient stylesheet and reports whether the page fill is transparent and its residual container is hidden.

### Tiếng Việt

- Sửa lỗi bầu trời bị lớp nền đặc của Ambient Light che sau khi quay về từ video. Nền Trang chủ/Tìm kiếm vẫn hiển thị khi CSS Ambient được nạp muộn; Ambient ở trang video được trả lại khi rời các trang này.
- Bổ sung mặt trăng có chi tiết bề mặt, nhiều sao hơn và dải Ngân Hà trôi chậm. Cảnh dùng bốn lớp trang trí, chỉ chuyển động bằng transform/opacity.
- Thêm **Animate sky** riêng với **Motion effects** của giao diện. Nền vẫn dừng khi hệ thống yêu cầu giảm chuyển động hoặc tab bị ẩn.
- Bổ sung trang kiểm tra dùng CSS Ambient thật được nạp sau cùng, hiển thị trạng thái lớp nền và container còn sót.

## 0.4.59 — 2026-11-06

### English

- Fixed Ambient Light switching off and leaving a black backdrop when **Motion effects** was disabled.
- Motion off now suspends hover magnification, panel movement and hover-driven column stacking. Static glass and the saved hover preference are retained.
- Added a hint explaining that Motion effects and Ambient Light are independent.
- Reduced seek/volume hover work: pause video-to-CPU tint readback during interaction and use a lighter thumb/capsule backdrop while retaining the glass fill and rim. Native seeking and volume controls are unchanged.
- Added regression coverage for motion-off startup, rapid toggles, saved preferences and the existing system accessibility gates.
- Replaced chip SVG displacement with a capped, static glass blur to address split/flickering text at the top of the page. Removed unused chip lens texture work.
- Added an optional time-of-day sky on Home and Search: morning sun, daytime sky, sunset and stars at night. Auto uses the device's local clock; Motion off keeps a still scene.
- Throttled tint interaction checks and added a manual hover diagnostic with separate hover/drag groups and invalid-run checks. The 120fps target remains unverified on hardware.

### Tiếng Việt

- Sửa lỗi tắt **Motion effects** làm Ambient Light tắt theo và nền trở thành màu đen.
- Khi Motion off, tạm dừng phóng đại hover, chuyển động panel và đổi thứ tự lớp cột theo hover. Giữ kính tĩnh và lựa chọn hover đã lưu.
- Thêm chú thích trong bảng cài đặt để làm rõ Motion effects và Ambient Light hoạt động độc lập.
- Giảm tải khi hover thanh tua/âm lượng: tạm ngưng đọc màu video về CPU trong lúc tương tác và dùng lớp nền kính nhẹ hơn, giữ màu kính và viền. Giữ nguyên cách tua và chỉnh âm lượng của YouTube.
- Bổ sung kiểm tra khởi động khi Motion off, bật/tắt liên tục, lưu tùy chọn và các điều kiện hỗ trợ tiếp cận của hệ thống.
- Thay bộ lọc méo SVG của chip bằng blur kính tĩnh có giới hạn để xử lý chữ tách đôi/nhấp nháy ở đầu trang. Bỏ phần tạo texture kính không còn dùng cho chip.
- Thêm nền theo thời gian tùy chọn ở Trang chủ và Tìm kiếm: mặt trời buổi sáng, trời ban ngày, hoàng hôn và sao ban đêm. Auto dùng giờ máy; tắt Motion giữ cảnh tĩnh.
- Giảm tần suất kiểm tra tương tác khi lấy màu; thêm công cụ đo hover/kéo riêng và phát hiện phép đo bị đổi tab/đổi trang. Chưa xác minh mục tiêu 120fps trên phần cứng thực tế.

## 0.4.58 — 2026-11-05

Changes since the first public beta, 0.4.53.

### English

- Added wheel adjustment for settings sliders, using their existing steps and save behaviour.
- Added **Hover effects**, independent of **Motion effects**.
- Added **Follow system transparency**. Glass stays transparent by default; system mode uses solid surfaces when reduced transparency is requested.
- Matched solid header/sidebar colours to YouTube's light or dark appearance, keeping text readable when system and site themes differ.
- Changed hover selection for video details, comments and recommendations to use their original layout bounds. The selected panel appears above panels that are shrinking.
- Added an optional English/Vietnamese feedback page after uninstall, with reasons, a comment box, an email draft and a copy option. No answers are sent automatically.
- Expanded source regression coverage for wheel input, saved preferences, overlapping panel regions, rapid hover reversal and lifecycle cleanup.

This is a beta. Source checks cover logic and CSS rules; animation smoothness still needs wider testing across browsers and hardware.

### Tiếng Việt

- Thêm chỉnh slider bằng con lăn chuột, giữ nguyên từng nấc và cách lưu cài đặt.
- Thêm **Hover effects** để bật/tắt hover riêng với **Motion effects**.
- Thêm **Follow system transparency**. Mặc định giữ kính trong suốt; có thể bật tùy chọn này để dùng nền đặc theo yêu cầu của hệ thống.
- Đồng bộ màu nền đặc của headbar/sidebar với giao diện sáng hoặc tối của YouTube, tránh chữ và nền lệch màu.
- Chọn hover cho chi tiết video, bình luận và đề xuất theo khung gốc. Panel đang chọn nằm trên các panel đang thu lại.
- Thêm trang góp ý tự nguyện Anh/Việt khi gỡ extension: chọn lý do, nhập góp ý, mở bản nháp email hoặc sao chép nội dung. Không tự động gửi câu trả lời.
- Bổ sung kiểm tra cho con lăn, lưu tùy chọn, vùng panel chồng nhau, đảo chiều hover nhanh và dọn trạng thái khi chuyển trang.

Đây vẫn là bản beta. Kiểm tra mã nguồn bao phủ logic và quy tắc CSS; độ mượt cần được thử thêm trên nhiều trình duyệt và cấu hình máy.

## 0.4.53 — 2026-11-05

First public beta: Liquid Glass, Ambient Light, interface animations, saved preferences and English/Vietnamese installation guides.

Bản beta công khai đầu tiên: Liquid Glass, Ambient Light, chuyển động giao diện, lưu cài đặt và hướng dẫn cài đặt Anh/Việt.
