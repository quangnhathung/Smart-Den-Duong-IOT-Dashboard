# SmartLight — Dashboard HTML/CSS/JS

Dashboard local cho đồ án đèn đường thông minh, TASK-009/P5/A5. Năm màn hình: tổng quan tuyến ba node, điều khiển từng node, lịch sử, cảnh báo và phiên thực nghiệm/CSV. Giao diện sáng theo ui-ux-pro-max, tiếng Việt, responsive; không framework, npm, build hoặc CDN để chạy.

## Chạy bằng VS Code Live Server

1. Đặt ba repo cạnh nhau: `DoAn/firmware`, `DoAn/backend`, `DoAn/dashboard`.
2. Chạy backend theo [README backend](../backend/README.md). Tại thư mục backend trên Linux:

   ```bash
   .venv/bin/python -m uvicorn smartlight.api:app --host 127.0.0.1 --port 8000 --workers 1
   ```

   PowerShell thay Python bằng `.venv/Scripts/python.exe`. Backend cần broker local và telemetry thật để mở khóa điều khiển; khi chưa có, dashboard vẫn giải thích trạng thái chưa có dữ liệu/mất kết nối.
3. Mở riêng thư mục **dashboard** bằng VS Code. Dùng extension **Live Server**, nhấp phải `index.html` → **Open with Live Server** (hoặc Go Live).
4. Truy cập **http://127.0.0.1:5500/**. Không mở bằng `file://`. `.vscode/settings.json` đặt host/port/root và bỏ theo dõi output/tests/Markdown để ảnh hoặc log kiểm tra không tự làm tải lại ứng dụng.
5. Dừng bằng **Port: 5500** trong VS Code; dừng backend bằng Ctrl+C. Không xóa SQLite để khởi động lại.

`config.js` giữ URL API mặc định `http://127.0.0.1:8000`, timeout HTTP 4 giây. Nếu đổi origin dashboard, cấu hình `SMARTLIGHT_ORIGINS` của backend tương ứng. Mặc định hỗ trợ localhost/127.0.0.1 cổng5500 và giữ cổng5173 cũ; không dùng CORS wildcard.

## Cấu trúc và hành vi

- `index.html`, `css/styles.css`: HTML có ngữ nghĩa, bảng, form, focus và CSS responsive/reduced motion; icon/SVG nội bộ, font hệ thống.
- `js/app.js`: hash routes, trạng thái màn hình, bản nháp điều khiển, phân trang và thao tác người dùng.
- `js/api.js`: HTTP, lỗi/timeout/abort, CSV, polling không chồng request. Health/nodes/command mỗi1s; stats/alerts/phiên đang xem mỗi5s. Tab ẩn tạm dừng, quay lại đồng bộ trước khi thao tác.
- `js/core.js`: định dạng, UTC↔giờ Việt Nam, BigInt/uint64, trạng thái lệnh và điều kiện nối mẫu.
- `js/charts.js`: SVG độ sáng bậc thang/công suất; range điều hướng mẫu bằng bàn phím và bảng raw thay thế.
- `design-system/MASTER.md`: quy ước thiết kế. `tests/`: kiểm tra logic bằng Node, không phải dependency chạy web.

Chỉ nút **Áp dụng thiết lập** gửi POST. MANUAL0–100 nguyên; AUTO không gửi brightness. 202 là tiếp nhận, APPLIED/REJECTED/TIMEOUT lấy từ API kết quả lệnh. PWM thực lấy riêng từ telemetry, có thể còn chuyển dần sau ACK. Lỗi phản hồi POST giữ kết quả chưa xác định, không tự gửi lại; đối chiếu pending của node trước thao tác mới. Bản nháp không bị polling ghi đè. MANUAL60s theo clock node, không tạo countdown thời gian thực sai với tốc độ mô phỏng.

Dữ liệu cũ được giữ với nhãn và khóa điều khiển; node chưa có telemetry hiển thị “—”. Fault tải tách khỏi offline. Thời gian truy vấn UTC, hiển thị Việt Nam; uint64 HTTP giữ chuỗi/BigInt. History lấy tối đa1000 mẫu/trang, bảng hiển thị100 mẫu/lần. Không nối biểu đồ qua quality lỗi, đổi boot/continuity, thứ tự sai hoặc gap uptime>6s. Điện năng/coverage lấy từ backend, không tự tính lại trên web hoặc lấp dữ liệu thiếu.

Phiên đo và cấu hình được đọc lại từ server sau reload. Danh sách có phân trang; chỉ một phiên mở. CSV chỉ tải sau phản hồi thành công đúng loại nội dung; lỗi API hiện trên màn hình.

## Kiểm tra

Từ dashboard, với Node có `node:test` và ES modules (đã chạy Node24.17):

```bash
node --test tests/*.test.mjs
```

16 test: HTTP lỗi/CSV/POST một lần/polling; uint64 lớn/clock; validation; gap biểu đồ; trạng thái pending/unknown/reject/timeout và nội dung escape. Không cần cài npm package. Backend: chạy `.venv/bin/python scripts/check.py` tại repo backend.

Bằng chứng ở [TASK-009](../firmware/docs/reports/evidence/task-009/README.md): Playwright dùng Live Server engine của extension VS Code, FastAPI/SQLite thật với transport MQTT giả có nhãn; kiểm tra desktop/mobile375/768/1024/1440, bàn phím, giảm chuyển động, lỗi API, lệnh, phiên và CSV. Phản hồi REJECTED/TIMEOUT trong pha bổ sung được mock để kiểm UI. Không có chế độ dữ liệu demo tự bật khi API lỗi trong source dashboard.

## Kiểm tra tích hợp còn lại

Theo [MQTT runbook](../firmware/docs/techs/mqtt.md) và README backend: chạy broker/Wokwi thực, kiểm AUTO/MANUAL/ACK/PWM, MANUAL60s theo node, offline/reconnect và restart giữ lịch sử. Đo độ trễ cảm biến→dashboard và command→ACK ít nhất10 lượt, lưu cấu hình/hash/log. Ba node, stability30phút, EX-series và đối chiếu năng lượng/CSV thực thuộc task tích hợp được giao riêng. Windows/VS Code Go Live thao tác tay chưa được chạy trong phiên kiểm tra Linux này.

Git dashboard độc lập, nhánh main; task này không commit, thêm remote hoặc push. Convention dùng [AGENTS chung](../firmware/AGENTS.md), tài liệu kỹ thuật ở repo firmware.
