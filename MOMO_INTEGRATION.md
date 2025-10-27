# MoMo Payment Integration - Hướng dẫn cài đặt

## 📋 Tổng quan

Hệ thống đã được tích hợp thanh toán MoMo song song với SePay. Admin có thể dễ dàng chuyển đổi giữa hai phương thức thanh toán thông qua Admin Panel.

## 🗄️ Cập nhật Database

### Bước 1: Chạy Migration Script

Chạy file SQL migration để cập nhật database schema:

```bash
mysql -u your_username -p your_database < database/migrations/add_momo_payment.sql
```

Hoặc import trực tiếp từ phpMyAdmin.

### Bước 2: Kiểm tra Tables

Migration sẽ tạo/cập nhật các bảng sau:

- `payment_settings` - Lưu cấu hình SePay và MoMo
- `orders` - Thêm các cột: `payment_method`, `momo_order_id`, `momo_trans_id`, `momo_pay_url`

## ⚙️ Cấu hình môi trường

Thêm các biến môi trường vào file `.env`:

```env
# MoMo Configuration
MOMO_REDIRECT_URL=https://yourdomain.com/payment/return
MOMO_IPN_URL=https://yourdomain.com/api/momo-webhook
NODE_ENV=production  # hoặc development để dùng test-payment.momo.vn
```

## 🔐 Cấu hình MoMo qua Admin Panel

### 1. Đăng nhập Admin Panel

Truy cập: `https://yourdomain.com/admin-panel.html`

### 2. Vào tab "⚙️ Cài đặt"

Click vào tab "Cài đặt" trên thanh menu.

### 3. Cấu hình MoMo

Điền thông tin MoMo Partner:

- **Partner Code**: Mã đối tác (VD: MOMO)
- **Access Key**: Key truy cập API
- **Secret Key**: Key bí mật để ký signature

**Lưu ý**: Để lấy thông tin này, bạn cần đăng ký tài khoản MoMo Business tại: https://business.momo.vn/

### 4. Chọn phương thức thanh toán

Click vào nút "SePay" hoặc "MoMo" để kích hoạt phương thức thanh toán mong muốn.

## 🧪 Test với MoMo Sandbox

### Thông tin test (MoMo cung cấp):

```javascript
Partner Code: MOMO
Access Key: F8BBA842ECF85
Secret Key: K951B6PE1waDMi640xX08PD3vg6EkVlz
```

**Endpoint Test**: `https://test-payment.momo.vn`

### Cách test:

1. Cấu hình thông tin test vào Admin Panel
2. Đặt `NODE_ENV=development` trong file `.env`
3. Tạo đơn hàng VIP từ giao diện người dùng
4. Hệ thống sẽ trả về `payUrl` để thanh toán test

## 📡 Webhook Configuration

### Cấu hình IPN URL trên MoMo Portal

1. Đăng nhập vào MoMo Business Portal
2. Vào phần **Cấu hình Webhook**
3. Thiết lập IPN URL: `https://yourdomain.com/api/momo-webhook`

### Xử lý Webhook

File `api/momo-webhook.js` sẽ tự động:
- Xác thực chữ ký (signature verification)
- Cập nhật trạng thái đơn hàng
- Kích hoạt VIP subscription
- Ghi log hoạt động

## 🔄 Quy trình thanh toán MoMo

1. **Người dùng chọn gói VIP** → Tạo order với `payment_method='momo'`
2. **Hệ thống gọi MoMo API** → Nhận `payUrl`
3. **User quét QR/click link** → Thanh toán trên app MoMo
4. **MoMo gọi IPN webhook** → Xác nhận thanh toán
5. **Hệ thống kích hoạt VIP** → User nhận quyền truy cập

## 📂 Cấu trúc Files mới

```
api/
├── momo-payment.js      # MoMo Payment Class (tạo payment, verify signature)
├── momo-webhook.js      # Webhook handler (IPN callback)
├── handler.js           # Cập nhật: hỗ trợ paymentMethod parameter
└── admin-handler.js     # Cập nhật: thêm payment settings management

database/
└── migrations/
    └── add_momo_payment.sql  # Migration script

public/
├── admin-panel.html     # Cập nhật: thêm Settings tab
└── admin-panel.js       # Cập nhật: payment settings functions
```

## 🎯 Tính năng chính

### User Side:
- ✅ Thanh toán qua SePay (chuyển khoản ngân hàng)
- ✅ Thanh toán qua MoMo (ví điện tử)
- ✅ Tự động nhận deeplink và QR code để thanh toán
- ✅ Auto-activate VIP sau khi thanh toán thành công

### Admin Side:
- ✅ Chuyển đổi phương thức thanh toán dễ dàng
- ✅ Cấu hình SePay và MoMo credentials
- ✅ Xem báo cáo giao dịch theo từng gateway
- ✅ Quản lý đơn hàng từ cả 2 phương thức

## 🐛 Troubleshooting

### Lỗi "Payment method not configured"
→ Kiểm tra xem đã cấu hình thông tin MoMo trong Admin Panel chưa

### Lỗi "Invalid signature" 
→ Kiểm tra lại Secret Key, đảm bảo đúng với MoMo cung cấp

### Webhook không nhận được
→ Kiểm tra IPN URL đã cấu hình đúng trên MoMo Portal chưa
→ Đảm bảo server có thể nhận request từ bên ngoài (public URL)

### Test payment không hoạt động
→ Đảm bảo `NODE_ENV=development` và dùng credentials test của MoMo

## 📞 Hỗ trợ

- MoMo Developer Docs: https://developers.momo.vn
- MoMo Business Portal: https://business.momo.vn
- Email hỗ trợ: business-support@momo.vn

## ⚠️ Lưu ý bảo mật

1. **KHÔNG** commit Secret Key vào Git
2. Luôn dùng HTTPS cho webhook URL
3. Verify signature mọi request từ MoMo
4. Lưu credentials trong environment variables hoặc database (encrypted)
5. Test kỹ trên sandbox trước khi chuyển production
