# Better Visual for YouTube — Chính sách quyền riêng tư

Nhà phát triển: QuanNguyen. Cập nhật: 21 tháng 11 năm 2026.

Better Visual for YouTube bổ sung hiệu ứng kính, chuyển động và Ambient Light cho YouTube trên máy tính. Bạn không cần tạo tài khoản để sử dụng.

## Dữ liệu xử lý trên thiết bị

Tiện ích đọc cấu trúc trang YouTube để áp dụng giao diện. Khi bật các hiệu ứng theo màu, màu từ video và ảnh thu nhỏ được xử lý ngay trên thiết bị. Cài đặt, cấu hình phong cách, tùy chọn hoạt động và tên/tọa độ thành phố tùy chọn bạn tự chọn được lưu trong bộ nhớ lưu trữ của tiện ích trên trình duyệt.

Extension không gửi lịch sử duyệt web, thông tin đăng nhập, khung hình video hay cài đặt đến máy chủ do nhà phát triển vận hành. Không tích hợp phân tích quảng cáo hoặc tải báo cáo lỗi lên máy chủ. Lỗi chẩn đoán có thể xuất hiện trong console cục bộ của trình duyệt.

## Lưu trữ và đồng bộ cài đặt qua trình duyệt

Cài đặt được lưu cục bộ bằng `chrome.storage.local`. Khi trình duyệt hỗ trợ và bật đồng bộ hồ sơ, tiện ích cũng sao lưu cài đặt giao diện, cấu hình nhanh và thành phố/tọa độ bạn đã chọn sang `chrome.storage.sync` để tự đồng bộ giữa các thiết bị đăng nhập cùng hồ sơ trình duyệt. Bộ nhớ đệm thời tiết và mốc thử lại chỉ lưu cục bộ trong `chrome.storage.local`. Quá trình đồng bộ hoàn toàn do trình duyệt Chrome/Edge thực hiện; QuanNguyen không vận hành máy chủ riêng và không thể đọc cài đặt đồng bộ của bạn.

## Kết nối mạng và bên thứ ba

**Nền trời trực tuyến tùy chọn:** sau khi bạn cấp quyền kết nối Open-Meteo, bật Live sun & weather sẽ gửi tọa độ thành phố đã chọn đến api.open-meteo.com. Khi bạn chủ động tìm thành phố, tên vừa nhập được gửi đến geocoding-api.open-meteo.com. Dịch vụ cũng nhận địa chỉ IP qua kết nối thông thường. Yêu cầu bỏ thông tin đăng nhập và referrer, không chứa URL trang YouTube, thông tin video hay tài khoản. Extension không dùng GPS hoặc tự dò vị trí. Thành phố và tọa độ được lưu trong cài đặt tiện ích. Một phản hồi thời tiết gần nhất cùng thời điểm yêu cầu được lưu đệm trên máy, dùng chung giữa các tab; thường cập nhật mỗi 15 phút khi Trang chủ, Tìm kiếm hoặc trang kênh đang hiển thị và dùng tính năng này. Nếu kết nối lỗi, cảnh có thể dùng dữ liệu cũ tối đa hai giờ. Xem [điều khoản và quyền riêng tư Open-Meteo](https://open-meteo.com/en/terms). Dữ liệu dựa trên mô hình thời tiết, không phải quan trắc trực tiếp từng giây. Tắt thời tiết dừng yêu cầu tự động mới, không tự thu hồi quyền trình duyệt hoặc xóa bộ nhớ đệm.

YouTube vẫn thực hiện các kết nối thông thường theo chính sách của họ. Ambient Light có thể xử lý khung hình video hoặc ảnh thu nhỏ storyboard ngay trên thiết bị để tạo ánh sáng viền. Các liên kết bên ngoài, như trang hỗ trợ và tài liệu, áp dụng chính sách của từng website.

Khi gỡ extension, trình duyệt mở một trang góp ý tự nguyện trên GitHub Pages (`https://moments2505.github.io/better-visual-youtube/uninstall/`). Địa chỉ cố định này không chứa mã nhận diện người dùng, lịch sử duyệt web hay cài đặt. GitHub xử lý thông tin truy cập website thông thường theo chính sách của họ. Trang không có công cụ phân tích truy cập và không tự gửi hoặc lưu câu trả lời.

Bạn có thể sao chép góp ý hoặc mở bản nháp trong ứng dụng email. QuanNguyen chỉ nhận được phản hồi khi bạn tự gửi email; lúc đó nội dung và thông tin người gửi do dịch vụ email cung cấp sẽ được chia sẻ. Phản hồi đã gửi được giữ trong hộp thư hỗ trợ. Bạn có thể liên hệ địa chỉ bên dưới để yêu cầu xóa.

## Quyền truy cập

- Storage (`storage`): lưu cài đặt cục bộ (`chrome.storage.local`) và đồng bộ tùy chọn giao diện qua hồ sơ trình duyệt đã đăng nhập (`chrome.storage.sync`).
- Truy cập `https://www.youtube.com/*`: áp dụng giao diện, nhận diện trình phát và tạo hiệu ứng đã chọn trên YouTube máy tính.
- Quyền tùy chọn với `https://api.open-meteo.com/*` và `https://geocoding-api.open-meteo.com/*`: lấy thời tiết và tìm thành phố chỉ khi bạn chủ động bật/dùng các mục này. Có thể thu hồi quyền bất cứ lúc nào trong phần quản lý quyền truy cập website của tiện ích.

Extension không yêu cầu quyền truy cập tất cả website hoặc quyền đọc lịch sử trình duyệt.

## Kiểm soát và lưu giữ

Bạn có thể tắt từng hiệu ứng hoặc tắt extension bất cứ lúc nào. Reset to Defaults khôi phục cài đặt mặc định đi kèm; khi gỡ extension, dữ liệu lưu trữ và đồng bộ của tiện ích được xử lý xóa theo cơ chế trình duyệt.

## Liên hệ và cập nhật

Nếu có câu hỏi về quyền riêng tư, bạn có thể liên hệ QuanNguyen qua quannguyenproducer2505@gmail.com. Chính sách này sẽ được cập nhật khi cách xử lý dữ liệu thay đổi.
