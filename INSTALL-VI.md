# Better visual Youtube — Hướng dẫn tiếng Việt

## Cài trên Microsoft Edge / Google Chrome

1. Giải nén toàn bộ gói ZIP vào một thư mục cố định. Không xóa hoặc di chuyển thư mục sau khi cài.
2. Mở `edge://extensions` trên Edge hoặc `chrome://extensions` trên Chrome.
3. Bật **Developer mode / Chế độ nhà phát triển**.
4. Chọn **Load unpacked / Tải tiện ích đã giải nén** và chọn thư mục chứa `manifest.json`.
5. Mở hoặc tải lại trang YouTube. Ghim **Better visual Youtube** từ menu tiện ích để mở bảng điều khiển dễ hơn.

## Mặc định và cập nhật

- Bản 1.4.53 dùng bộ cài đặt đã lưu của tác giả: Light, màu Thumbnail, blur 1px, radius 14px, highlight 62%, hover 112%, Ambient spread 162%, 16fps. Độ trong suốt hiển thị trên bảng là 1%; giá trị nội bộ chính xác được giữ trong `default-settings.json`.
- Cài mới tự dùng bộ này. Cài đè giữ lựa chọn đang lưu; bấm **Reset to Defaults** để áp dụng toàn bộ mặc định mới.
- Để cập nhật cùng bản đang cài, thay nội dung trong thư mục cũ bằng nội dung gói mới, bấm **Reload / Tải lại** ở trang tiện ích rồi tải lại YouTube. Không xóa tiện ích nếu muốn giữ cài đặt.
- Nếu nạp từ thư mục mới, trình duyệt có thể xem đó là tiện ích khác. Tắt bản cũ để tránh hai bản cùng chạy.

## Nếu máy bị giật khi tua hoặc chỉnh âm lượng

- Thử tắt **Optical depth** rồi thao tác lại trên cùng video; tiếp theo thử tắt **Ambient Light** để phân biệt tải do kính hay ánh sáng.
- Có thể giảm **Hover lift**, **Dispersion**, Ambient **Spread** hoặc chọn chất lượng **Eco**. Đây là tùy chọn, không được áp dụng sẵn vào bộ mặc định.
- Báo lại trình duyệt, cấu hình máy và thao tác gây giật. Chưa có phép đo FPS trên máy tester nên không bảo đảm 60fps trên mọi máy.

## Lưu ý

Gói này là tiện ích đã giải nén dành cho desktop Edge/Chrome, không phải file cài Chrome Web Store. Cài đặt lưu cục bộ theo hồ sơ trình duyệt, không tự đồng bộ sang máy khác. Gói không bao gồm tài khoản, cookie hay lịch sử duyệt web.

Mã nguồn và giấy phép bên thứ ba nằm trong gói; giữ các tệp LICENSE khi phân phối lại.
