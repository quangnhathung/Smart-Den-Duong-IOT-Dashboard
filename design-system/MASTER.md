# SmartLight — Quy ước thiết kế TASK-009

Nguồn: skill ui-ux-pro-max, phong cách Data-Dense Dashboard; lựa chọn của người dùng: theme sáng, HTML/CSS/JS, VS Code Live Server. Thiết kế phục vụ giám sát và thao tác, không thêm màn hình marketing.

- Màu nền #F8FAFC, card trắng, chữ #0F172A, chữ phụ #475569. Hành động/online #047857, cảnh báo #B45309, lỗi #B91C1C; trạng thái luôn kèm chữ và dấu hiệu, không chỉ màu.
- Font hệ thống hỗ trợ tiếng Việt; số có tabular-nums. Nhịp khoảng cách4/8/12/16/24/32px, card bo16px và đường viền nhẹ. Desktop sidebar cố định, mobile menu xếp dòng; nội dung/tables có vùng cuộn riêng khi cần.
- Tổng quan ưu tiên4 KPI, tuyến3 đèn SVG, card node, health/cảnh báo. Chi tiết tách telemetry thực với form bản nháp; target/applied có nhãn riêng. Không đếm MANUAL theo wall clock.
- Loading/empty/unknown/stale/error là trạng thái có thông tin. Giữ giá trị cuối có cảnh báo, khóa nút và nêu lý do. Không biến dữ liệu thiếu thành0 hoặc xóa lỗi tải khi offline.
- Focus nhìn thấy, label cho input, heading/landmark, nút HTML native, aria-live phản hồi; biểu đồ có nhãn, điều hướng mẫu bằng range/bàn phím và bảng raw. Tôn trọng prefers-reduced-motion.
- Chart độ sáng dùng bậc thang, công suất đường; ngắt khi mất continuity/boot/quality/thứ tự hoặc gap>6s. Mẫu đơn có chấm, không dựng đường giả. UTC truy vấn/giờ Việt Nam hiển thị; ghi rõ điện năng mô phỏng và coverage.

Kiểm tra: ảnh fixture desktop/mobile và kết quả browser ở firmware/docs/reports/evidence/task-009. Font/assets nội bộ, không tải font hoặc icon từ CDN.
