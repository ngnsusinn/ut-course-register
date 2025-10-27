# 🎓 UTH Course Registration Tool

Hệ thống đăng ký học phần tự động với tích hợp thanh toán VIP qua SePay.

## ✨ Tính năng

### 🚀 Người dùng
- ✅ Đăng ký học phần tự động
- ✅ Xem thời khóa biểu chi tiết
- ✅ Nâng cấp tài khoản VIP (truy cập môn tiên quyết)
- ✅ Thanh toán qua SePay
- ✅ Theo dõi trạng thái đơn hàng
- ✅ Quản lý VIP subscription

### 👨‍💼 Quản trị viên
- ✅ Dashboard thống kê với biểu đồ
- ✅ Quản lý người dùng và VIP subscriptions
- ✅ Theo dõi đơn hàng và giao dịch
- ✅ Xem logs hoạt động hệ thống
- ✅ Phân tích dữ liệu theo thời gian thực

## 🛠️ Công nghệ

- **Backend**: Node.js, Vercel Serverless Functions
- **Database**: MySQL 5.7+
- **Payment**: SePay
- **Frontend**: Vanilla JavaScript, Tailwind CSS, Chart.js

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

Tạo file `.env` và điền thông tin:

\`\`\`env
# Database (Bắt buộc)
DB_HOST=your_host
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=your_database

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
```

### 6. Deploy lên Vercel

```bash
npm run deploy
```

##  API Endpoints

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
- `getDashboardStats` - Lấy thống kê dashboard

### Webhooks

#### SePay Webhook (`/api/sepay-webhook`)
- `POST /api/sepay-webhook` - Nhận thông báo từ SePay

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

## 🧪 Testing

### Test Database Connection
\`\`\`bash
npm run test:db
\`\`\`

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
1. Kiểm tra URL trong SePay config
2. Verify SSL certificate (HTTPS required)
3. Check firewall/security rules

### Dashboard không hiển thị
1. Kiểm tra Chart.js CDN đã load
2. Refresh browser cache và kiểm tra console errors
3. Verify getDashboardStats API hoạt động

## 📄 License

MIT License

## 👥 Support

Liên hệ: [Your Email/Support Channel]

## 📌 Notes

- Database timezone: UTC+7 (Vietnam)
- Auto-cancel unpaid orders after 15 minutes
- VIP subscriptions are cumulative (không reset khi mua thêm)
- Admin panel: `/admin` hoặc `/admin-panel.html` với Dashboard analytics
- Default admin credentials: Check database `admins` table
- Dashboard charts: Revenue (Line), User Growth (Bar), VIP Distribution (Pie), Order Status (Doughnut)

## 🎯 Roadmap

- [x] ~~MoMo Payment Integration~~ (Removed in v2.2.0)
- [x] Admin Dashboard with Charts (Added in v2.2.0)
- [ ] Email notifications
- [ ] SMS integration
- [ ] Mobile app
- [ ] Multi-language support
- [ ] Export reports (CSV/PDF)
- [ ] Refund management

---

Made with ❤️ for UTH Students
