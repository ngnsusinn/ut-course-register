# Vercel Deployment Guide with Obfuscation

## 🚀 Quy trình Deploy lên Vercel

### Cách hoạt động:

1. **Git Push** → Code được push lên repository
2. **Vercel Build** → Tự động chạy `npm run build` (tạo file obfuscated)
3. **Vercel Deploy** → Deploy tất cả files (bao gồm file obfuscated)
4. **Browser Load** → HTML tự động load file obfuscated

### Build Process trên Vercel:

```bash
# Vercel tự động chạy:
npm install                    # Cài dependencies
npm run build                  # Chạy obfuscation
  └─> npm run obfuscate        # Tạo *.obfuscated.js files
  
# Files được tạo ra:
✅ public/app.obfuscated.js
✅ public/admin-panel.obfuscated.js
✅ public/timetable.obfuscated.js
```

## 📋 Checklist trước khi Deploy

### 1. Kiểm tra package.json
```json
{
  "scripts": {
    "build": "npm run obfuscate",
    "obfuscate": "node scripts/obfuscate.js"
  },
  "devDependencies": {
    "javascript-obfuscator": "^4.1.0"
  }
}
```
✅ Đã có sẵn

### 2. Kiểm tra vercel.json
```json
{
  "buildCommand": "npm run build"
}
```
✅ Đã thêm

### 3. Kiểm tra .gitignore
```
# Không commit file obfuscated (sẽ build trên Vercel)
*.obfuscated.js
*.original.js
```
✅ Đã cập nhật

### 4. Kiểm tra HTML files
```html
<!-- index.html -->
<script>
  // Tự động load app.obfuscated.js, fallback về app.js
</script>
```
✅ Đã tích hợp

## 🧪 Test Local trước khi Deploy

### Test 1: Build locally
```bash
npm run build
```
Kiểm tra:
- ✅ File `public/app.obfuscated.js` được tạo
- ✅ File `public/admin-panel.obfuscated.js` được tạo
- ✅ File `public/timetable.obfuscated.js` được tạo
- ✅ Không có error trong terminal

### Test 2: Test obfuscated files
```bash
npm run dev
```
Mở browser và kiểm tra:
- ✅ Console không có error
- ✅ Tất cả chức năng hoạt động bình thường
- ✅ Network tab thấy file obfuscated được load

### Test 3: Test fallback
```bash
# Xóa file obfuscated để test fallback
rm public/*.obfuscated.js
npm run dev
```
Kiểm tra:
- ✅ Tự động load file gốc (.js)
- ✅ Console có warning "Failed to load..., loading fallback"

## 🌐 Deploy lên Vercel

### Option 1: Deploy từ Git (Recommended)

```bash
# Commit changes
git add .
git commit -m "Add obfuscation to build process"
git push origin main

# Vercel tự động detect push và deploy
```

Vercel sẽ:
1. ✅ Clone repository
2. ✅ Chạy `npm install`
3. ✅ Chạy `npm run build` (tạo file obfuscated)
4. ✅ Deploy tất cả files

### Option 2: Deploy thủ công

```bash
# Build local
npm run build

# Deploy
npm run deploy
```

## ✅ Kiểm tra sau khi Deploy

### 1. Check Vercel Build Logs

Vào Vercel Dashboard → Project → Deployments → Latest → Build Logs

Tìm dòng:
```
Running "npm run build"
🔒 Starting JavaScript obfuscation...
📄 Processing: public/app.js
   ✅ Obfuscated file created: public/app.obfuscated.js
✅ Obfuscation completed!
```

### 2. Check Network trong Browser

1. Mở https://your-domain.vercel.app
2. Mở DevTools → Network tab
3. Reload page
4. Kiểm tra:
   - ✅ `app.obfuscated.js` - Status 200 ✅
   - ✅ `timetable.obfuscated.js` - Status 200 ✅
   - ✅ `admin-panel.obfuscated.js` - Status 200 ✅

### 3. Check Console

Mở DevTools → Console tab:
- ✅ Không có error
- ✅ Không có warning về "Failed to load"
- ✅ Application hoạt động bình thường

### 4. Test Source Code Protection

1. DevTools → Sources tab
2. Mở `app.obfuscated.js`
3. Kiểm tra:
   - ✅ Code không đọc được (biến dạng _0x1a2b3c)
   - ✅ Chuỗi được mã hóa
   - ✅ Logic phức tạp

## 🔧 Troubleshooting

### Lỗi: "Build failed"

**Nguyên nhân**: `javascript-obfuscator` không được cài trong devDependencies

**Giải pháp**:
```json
// package.json
{
  "devDependencies": {
    "javascript-obfuscator": "^4.1.0"
  }
}
```

### Lỗi: File obfuscated không được tạo

**Nguyên nhân**: Vercel không chạy build command

**Giải pháp**: 
```json
// vercel.json
{
  "buildCommand": "npm run build"
}
```

### Lỗi: 404 cho file obfuscated

**Nguyên nhân 1**: File không được build
- Check Vercel build logs
- Verify `npm run build` chạy thành công

**Nguyên nhân 2**: File bị gitignore nhưng không được build
- Đảm bảo `buildCommand` có trong vercel.json

### Lỗi: Code không hoạt động sau obfuscate

**Nguyên nhân**: Obfuscation quá mạnh gây lỗi code

**Giải pháp**: Giảm mức độ obfuscation trong `scripts/obfuscate.js`:
```javascript
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: false, // Tắt
  deadCodeInjection: false,      // Tắt
  stringArray: true,
  // ... giữ các options khác
};
```

## 📊 Performance Impact

### Metrics sau khi Obfuscate:

| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| File Size | 100 KB | 150-250 KB | +50-150% |
| Load Time | 200ms | 250-300ms | +25-50% |
| Execution Time | 10ms | 12-15ms | +20-50% |
| Protection | ⚠️ Low | ✅ High | ++++++ |

### Optimization Tips:

1. ✅ Enable gzip compression (Vercel mặc định có)
2. ✅ Use defer/async cho scripts (đã có)
3. ✅ Lazy load non-critical code
4. ✅ Monitor với Vercel Speed Insights (đã tích hợp)

## 🎯 Best Practices

### DO ✅

- ✅ Chạy obfuscate trên Vercel build
- ✅ Không commit file obfuscated vào Git
- ✅ Test kỹ sau mỗi lần build
- ✅ Monitor performance với Speed Insights
- ✅ Giữ file backup (.original.js) local

### DON'T ❌

- ❌ Không commit file obfuscated
- ❌ Không để sensitive data trong frontend
- ❌ Không quá tin tưởng vào obfuscation
- ❌ Không bỏ qua backend validation
- ❌ Không obfuscate trong development

## 🔐 Security Layers

Obfuscation chỉ là 1 layer, cần kết hợp:

1. ✅ **Frontend Obfuscation** - Khó đọc code
2. ✅ **Backend Validation** - Validate mọi input
3. ✅ **Rate Limiting** - Chống spam/abuse
4. ✅ **HTTPS** - Encrypt transport
5. ✅ **JWT Tokens** - Secure authentication
6. ✅ **CSP Headers** - Prevent XSS

## 📞 Support

Nếu gặp vấn đề khi deploy:

1. Check Vercel build logs
2. Test `npm run build` local
3. Verify vercel.json config
4. Check browser console errors

---

**Ready to deploy? Run:**
```bash
git add .
git commit -m "Enable obfuscation for production"
git push origin main
```

Vercel sẽ tự động build và deploy với code đã được bảo vệ! 🚀🔒
