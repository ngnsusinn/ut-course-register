# 🎓 UTH Course Registration Tool

Hệ thống đăng ký học phần tự động với tích hợp thanh toán VIP qua SePay và MoMo.

## ✨ Tính năng

### 🚀 Người dùng
- ✅ Đăng ký học phần tự động
- ✅ Xem thời khóa biểu chi tiết
- ✅ Nâng cấp tài khoản VIP (truy cập môn tiên quyết)
- ✅ Thanh toán qua SePay hoặc MoMo
- ✅ Theo dõi trạng thái đơn hàng
- ✅ Quản lý VIP subscription

### 👨‍💼 Quản trị viên
- ✅ Quản lý người dùng và VIP subscriptions
- ✅ Theo dõi đơn hàng và giao dịch
- ✅ Xem logs hoạt động hệ thống
- ✅ Cấu hình phương thức thanh toán (SePay/MoMo)
- ✅ Chuyển đổi payment gateway linh hoạt

## 🛠️ Công nghệ

- **Backend**: Node.js, Vercel Serverless Functions
- **Database**: MySQL 5.7+
- **Payment**: SePay, MoMo Payment API v2
- **Frontend**: Vanilla JavaScript, Tailwind CSS

## 📦 Cài đặt

### 1. Clone repository

\`\`\`bash
git clone <repository-url>
cd ut-course-register
\`\`\`

### 2. Cài đặt dependencies

\`\`\`bash
npm install
\`\`\`

### 3. Cấu hình môi trường

Copy file `.env.example` thành `.env` và điền thông tin:

\`\`\`bash
cp .env.example .env
\`\`\`

Chỉnh sửa `.env`:

\`\`\`env
# Database (Bắt buộc)
DB_HOST=your_host
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=your_database

# MoMo (Tùy chọn - có thể config qua Admin Panel)
MOMO_PARTNER_CODE=your_partner_code
MOMO_ACCESS_KEY=your_access_key
MOMO_SECRET_KEY=your_secret_key
MOMO_REDIRECT_URL=https://yourdomain.com/payment/return
MOMO_IPN_URL=https://yourdomain.com/api/momo-webhook

# Application
BASE_URL=https://yourdomain.com
NODE_ENV=production
\`\`\`

### 4. Thiết lập Database

**Cách 1: Import SQL backup (Khuyến nghị)**

\`\`\`bash
mysql -u your_user -p your_database < roacqgfa_reg_updated.sql
\`\`\`

**Cách 2: Chạy migration**

\`\`\`bash
npm run migrate
\`\`\`

### 5. Test kết nối

\`\`\`bash
npm run test:db
\`\`\`

### 6. Deploy lên Vercel

\`\`\`bash
npm run deploy
\`\`\`

## 🔧 Cấu hình Payment Gateway

### Cách 1: Qua Admin Panel (Khuyến nghị)

1. Truy cập `/admin` hoặc `/admin-panel.html`
2. Đăng nhập với tài khoản admin
3. Vào tab **⚙️ Cài đặt**
4. Chọn phương thức thanh toán (SePay/MoMo)
5. Điền thông tin cấu hình
6. Nhấn **Kích hoạt** để sử dụng

### Cách 2: Qua Environment Variables

Thêm vào file `.env` (như hướng dẫn ở trên)

## 📚 API Endpoints

### Main Handler (`/api/handler`)
- `POST /api/handler` - Xử lý các action chính

**Actions:**
- `login` - Đăng nhập
- `getInitialData` - Lấy thông tin ban đầu
- `getFullSchedule` - Xem toàn bộ lịch học
- `register` - Đăng ký học phần
- `cancel` - Hủy đăng ký
- `checkVIPStatus` - Kiểm tra VIP
- `createVIPOrder` - Tạo đơn hàng VIP
- `checkOrderStatus` - Kiểm tra trạng thái đơn
- `cancelOrder` - Hủy đơn hàng
- `getVIPPlans` - Lấy danh sách gói VIP
- `getPaymentSettings` - Lấy cấu hình thanh toán

### Admin Handler (`/api/admin-handler`)
- `POST /api/admin-handler` - Quản trị hệ thống

**Actions:**
- `login` - Đăng nhập admin
- `getAllUsers` - Lấy danh sách người dùng
- `getAllSubscriptions` - Lấy danh sách VIP
- `getAllOrders` - Lấy danh sách đơn hàng
- `getAllTransactions` - Lấy lịch sử giao dịch
- `getAllLogs` - Xem logs hệ thống
- `addVIPSubscription` - Thêm VIP cho user
- `deleteSubscription` - Xóa VIP subscription
- `deleteUser` - Xóa người dùng
- `getPaymentSettings` - Lấy cấu hình payment
- `updatePaymentSettings` - Cập nhật cấu hình
- `setActivePaymentMethod` - Chuyển đổi payment method

### Webhooks

#### SePay Webhook (`/api/sepay-webhook`)
- `POST /api/sepay-webhook` - Nhận thông báo từ SePay

#### MoMo Webhook (`/api/momo-webhook`)
- `POST /api/momo-webhook` - Nhận IPN từ MoMo

## 🔐 Bảo mật

1. **Environment Variables**: Không commit file `.env`
2. **Database**: Sử dụng prepared statements (tránh SQL injection)
3. **Payment**: Verify signature từ webhook
4. **Admin**: Password được hash, session-based authentication
5. **CORS**: Chỉ allow từ domain được cấu hình

## 📊 Database Schema

### Tables

- `users` - Thông tin người dùng
- `admins` - Thông tin quản trị viên
- `vip_subscriptions` - Gói VIP đang sử dụng
- `orders` - Đơn hàng
- `transactions` - Giao dịch thanh toán
- `activity_logs` - Logs hoạt động
- `payment_settings` - Cấu hình payment gateway

## 🧪 Testing

### Test Database Connection
\`\`\`bash
npm run test:db
\`\`\`

### Test MoMo Payment
Sử dụng MoMo Test Environment:
- Endpoint: `test-payment.momo.vn`
- Credentials: https://developers.momo.vn/

### Test SePay Webhook
Sử dụng ngrok hoặc webhook.site để test locally:
\`\`\`bash
ngrok http 3000
\`\`\`

## 📝 Scripts

- `npm run dev` - Chạy dev server (Vercel dev)
- `npm run deploy` - Deploy lên Vercel production
- `npm run test:db` - Test kết nối database
- `npm run migrate` - Chạy database migration

## 🚨 Troubleshooting

### Lỗi kết nối database
1. Kiểm tra thông tin trong `.env`
2. Chạy `npm run test:db`
3. Đảm bảo MySQL đang chạy và accessible

### Webhook không nhận được
1. Kiểm tra URL trong payment gateway config
2. Verify SSL certificate (HTTPS required)
3. Check firewall/security rules

### MoMo signature invalid
1. Kiểm tra Partner Code, Access Key, Secret Key
2. Đảm bảo sử dụng đúng endpoint (test/production)
3. Log raw signature string để debug

## 📄 License

MIT License

## 👥 Support

Liên hệ: [Your Email/Support Channel]

## 📌 Notes

- Database timezone: UTC+7 (Vietnam)
- Auto-cancel unpaid orders after 15 minutes
- VIP subscriptions are cumulative (không reset khi mua thêm)
- Admin panel: `/admin` hoặc `/admin-panel.html`
- Default admin credentials: Check database `admins` table

## 🎯 Roadmap

- [ ] Email notifications
- [ ] SMS integration
- [ ] Mobile app
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Refund management

---

Made with ❤️ for UTH Students
