# 🚀 Deployment Checklist

## ✅ Pre-Deployment

### 1. Database Setup
- [ ] Import `roacqgfa_reg_updated.sql` vào MySQL database
- [ ] Verify database timezone = UTC+7
- [ ] Test database connection: `npm run test:db`
- [ ] Check admin account exists in `admins` table

### 2. Environment Variables
- [ ] Copy `.env.example` → `.env`
- [ ] Set database credentials (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)
- [ ] Set BASE_URL to your domain
- [ ] Set FRONTEND_URL to your domain
- [ ] Set NODE_ENV=production

### 3. Payment Gateway Configuration

#### Option A: Via Admin Panel (Recommended)
- [ ] Login to `/admin`
- [ ] Go to Settings (⚙️ Cài đặt)
- [ ] Configure SePay or MoMo credentials
- [ ] Activate desired payment method

#### Option B: Via Environment Variables
- [ ] Set MOMO_PARTNER_CODE (if using MoMo)
- [ ] Set MOMO_ACCESS_KEY
- [ ] Set MOMO_SECRET_KEY
- [ ] Set MOMO_REDIRECT_URL (your domain + /payment/return)
- [ ] Set MOMO_IPN_URL (your domain + /api/momo-webhook)

### 4. Code Quality
- [ ] No syntax errors: Run `get_errors`
- [ ] All files committed to git
- [ ] `.env` added to `.gitignore`
- [ ] Test basic functionality locally: `npm run dev`

## 🔧 Deployment Steps

### Vercel Deployment

1. **Install Vercel CLI** (if not installed)
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   npm run deploy
   ```

4. **Set Environment Variables in Vercel**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add all variables from `.env` file
   - Make sure to set for Production environment

### Manual Deployment

1. **Build locally**
   ```bash
   npm install
   ```

2. **Upload files to server**
   - Upload all files except `node_modules/`, `.env`, `.git/`
   - Install dependencies on server: `npm install --production`

3. **Configure environment**
   - Create `.env` file on server
   - Set all required variables

4. **Start application**
   ```bash
   npm start
   ```

## ✅ Post-Deployment

### 1. Verify Endpoints
- [ ] Test main handler: `https://yourdomain.com/api/handler`
- [ ] Test admin handler: `https://yourdomain.com/api/admin-handler`
- [ ] Test SePay webhook: `https://yourdomain.com/api/sepay-webhook`
- [ ] Test MoMo webhook: `https://yourdomain.com/api/momo-webhook`

### 2. Test User Flow
- [ ] Access homepage: `https://yourdomain.com`
- [ ] Login with test account
- [ ] View schedule
- [ ] Create VIP order
- [ ] Verify payment flow (SePay or MoMo)
- [ ] Check VIP activation after payment

### 3. Test Admin Panel
- [ ] Access: `https://yourdomain.com/admin`
- [ ] Login with admin credentials
- [ ] Check all tabs load correctly:
  - [ ] 👥 Người dùng
  - [ ] 💎 VIP
  - [ ] 🛒 Đơn hàng
  - [ ] 💰 Giao dịch
  - [ ] 📋 Logs
  - [ ] ⚙️ Cài đặt
- [ ] Add VIP subscription manually
- [ ] Switch payment methods
- [ ] Update payment settings

### 4. Webhook Configuration

#### SePay
- [ ] Login to SePay dashboard
- [ ] Set webhook URL: `https://yourdomain.com/api/sepay-webhook`
- [ ] Test webhook with real transaction

#### MoMo
- [ ] Login to MoMo Business Portal
- [ ] Set IPN URL: `https://yourdomain.com/api/momo-webhook`
- [ ] Set Return URL: `https://yourdomain.com/payment/return`
- [ ] Test with MoMo test payment

### 5. Security Check
- [ ] HTTPS enabled (SSL certificate)
- [ ] `.env` file not publicly accessible
- [ ] Database credentials secure
- [ ] CORS properly configured
- [ ] Rate limiting enabled (if applicable)

### 6. Monitoring
- [ ] Check server logs for errors
- [ ] Monitor database connections
- [ ] Track payment success rate
- [ ] Set up error notifications (email/Slack)

## 🔄 Maintenance

### Daily
- [ ] Check activity logs in admin panel
- [ ] Monitor payment success rate
- [ ] Review error logs

### Weekly
- [ ] Backup database
- [ ] Review and clean up cancelled orders
- [ ] Check VIP expiry dates

### Monthly
- [ ] Database optimization
- [ ] Security updates
- [ ] Performance review

## 🚨 Troubleshooting

### Database Connection Failed
1. Check `.env` credentials
2. Verify database server is running
3. Check firewall rules
4. Test with `npm run test:db`

### Webhook Not Receiving
1. Verify URL is HTTPS
2. Check webhook URL in payment gateway dashboard
3. Test with webhook.site or ngrok
4. Review server logs

### Payment Not Activating VIP
1. Check webhook received (activity_logs table)
2. Verify signature validation passed
3. Check order status updated to 'Paid'
4. Review vip_subscriptions table

### Admin Panel Not Loading
1. Clear browser cache
2. Check browser console for errors
3. Verify admin-handler.js endpoint working
4. Check admin credentials in database

## 📞 Support

- Documentation: `/MOMO_INTEGRATION.md`
- README: `/README.md`
- Issues: Create issue on GitHub

---

**Last Updated**: October 28, 2025
**Version**: 2.1.0
