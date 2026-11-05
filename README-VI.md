![Better visual Youtube — Liquid Glass và Ambient Light](https://raw.githubusercontent.com/Moments2505/better-visual-youtube/main/docs/media/liquid-glass-banner.png)

# Better visual Youtube

Thêm một diện mạo mới cho YouTube với lớp kính trong, ánh sáng theo video và chuyển động trên giao diện.

**[Tải bản beta](https://github.com/Moments2505/better-visual-youtube/releases)** · [Changelog](CHANGELOG.md) · [English](README.md) · [Báo lỗi](https://github.com/Moments2505/better-visual-youtube/issues)

Dành cho Microsoft Edge và Google Chrome trên máy tính. Tiện ích đang ở giai đoạn beta và sẽ tiếp tục được hoàn thiện.

## Thêm chiều sâu cho giao diện

Liquid Glass mang lớp kính trong và viền bắt sáng đến thanh đầu trang, ô tìm kiếm, bộ điều khiển video và các khung nội dung. Bạn có thể chỉnh màu kính, độ mờ, độ trong và phản sáng theo sở thích.

## Ánh sáng theo từng khung hình

Ambient Light mở rộng màu sắc từ video ra xung quanh trình phát. Độ lan, độ sáng và chất lượng đều có thể điều chỉnh ngay trong bảng cài đặt của tiện ích.

![Better visual Youtube — hình giới thiệu Ambient Light](https://raw.githubusercontent.com/Moments2505/better-visual-youtube/main/docs/media/ambient-light-banner.png)

## Tuỳ chỉnh theo cách bạn thích

Chọn giao diện sáng hoặc tối, tinh chỉnh hiệu ứng kính và bật tắt các chuyển động. Các lựa chọn được lưu ngay trong trình duyệt của bạn.

## Cài đặt

1. Tải gói ZIP của tiện ích trong [Releases](https://github.com/Moments2505/better-visual-youtube/releases), rồi giải nén.
2. Mở `edge://extensions` hoặc `chrome://extensions` và bật **Chế độ nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén**, rồi chọn thư mục chứa `manifest.json`.
4. Tải lại YouTube và mở tiện ích để chọn hiệu ứng bạn thích.

[Hướng dẫn cài đặt](INSTALL-VI.md) · [Installation guide](INSTALL-EN.md)

Nếu gặp lỗi hoặc có ý tưởng mới, bạn có thể [tạo issue](https://github.com/Moments2505/better-visual-youtube/issues).

## Cùng phát triển

Dự án mở mã nguồn theo [giấy phép MIT](LICENSE). Có thể nạp trực tiếp thư mục repo vào trình duyệt, không cần build.

Để chạy kiểm thử và đóng gói ZIP, dùng Node.js 22+ và Python 3.12+:

```sh
python scripts/check.py
python scripts/package-release.py --output-dir dist
```

Xem [hướng dẫn đóng góp](CONTRIBUTING.md) để tìm hiểu cấu trúc mã nguồn.

## Ghi nhận

Phát triển bởi **QuanNguyen**. Ambient Light sử dụng mã đã chỉnh sửa từ [youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight) của Wessel Kroos, theo giấy phép MIT. Hiệu ứng kính tham khảo [bài viết về khúc xạ bằng CSS/SVG](https://kube.io/blog/liquid-glass-css-svg/). Thông tin chi tiết có trong [ghi nhận bên thứ ba](THIRD-PARTY-NOTICES.md).

[Chính sách quyền riêng tư](docs/PRIVACY-VI.md) · [Privacy policy](docs/PRIVACY-EN.md) · [Liên hệ](mailto:quannguyenproducer2505@gmail.com)

Đây là dự án độc lập, không liên kết với YouTube, Google, Apple hay Microsoft.
