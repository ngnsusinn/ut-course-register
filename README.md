# Tool DKHP UTH: Automated Course Registration & Academic Planning System

> *A high-throughput, resilient, and open-source automated course registration platform engineered for students at the University of Transport and Communications Ho Chi Minh City (UTH).*

[![Node.js Version](https://img.shields.io/badge/node-22.x%20%7C%2024.x-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Test Suite](https://img.shields.io/badge/tests-56%2F56%20passing-success.svg)](tests/)
[![Architecture](https://img.shields.io/badge/stack-Vercel%20Serverless%20%2B%20MongoDB%20Atlas-orange.svg)](https://vercel.com/)
[![Open Source](https://img.shields.io/badge/codebase-100%25%20Transparent%20%26%20Un--obfuscated-blueviolet.svg)](#about-the-project--về-dự-án-tool-dkhp-uth)

> [!NOTE]
> **Dành cho sinh viên và nhà phát triển tại Việt Nam:** Tài liệu kỹ thuật chi tiết bằng tiếng Anh ở phần đầu. Bạn có thể cuộn xuống mục [Tóm Tắt Dự Án & Hướng Dẫn Nghiệp Vụ UTH](#executive-summary--domain-guide-tóm-tắt-dự-án--nghiệp-vụ-uth) để đọc tóm lược dự án, hướng dẫn sinh viên và cam kết an toàn bằng tiếng Việt.

---

## Table of Contents

- [Why Tool DKHP UTH? Problem & Solution Matrix](#why-tool-dkhp-uth-problem--solution-matrix)
- [System Architecture](#system-architecture)
- [Core Capabilities](#core-capabilities)
  - [1. Intelligent Upstream Resilience & Backoff](#1-intelligent-upstream-resilience--backoff)
  - [2. Automated Course Sniping & Swap Safety](#2-automated-course-sniping--swap-safety)
  - [3. Crowdsourced Class Cache Architecture](#3-crowdsourced-class-cache-architecture)
  - [4. Idempotent Payment & VIP Ledger](#4-idempotent-payment--vip-ledger)
  - [5. Zero-Credential Security Model](#5-zero-credential-security-model)
  - [6. Transparent Open-Source Frontend](#6-transparent-open-source-frontend)
- [Database Schema & Data Contracts](#database-schema--data-contracts)
- [Environment Variables](#environment-variables)
- [Getting Started & Local Development](#getting-started--local-development)
- [Automated Verification & Test Suite](#automated-verification--test-suite)
- [About The Project / Về Dự Án Tool DKHP UTH](#about-the-project--về-dự-án-tool-dkhp-uth)
- [Executive Summary & Domain Guide (Tóm Tắt Dự Án & Nghiệp Vụ UTH)](#executive-summary--domain-guide-tóm-tắt-dự-án--nghiệp-vụ-uth)

---

## Why Tool DKHP UTH? Problem & Solution Matrix

During university course registration windows at UTH, over 15,000 students simultaneously flood the portal (`portal.ut.edu.vn`), causing severe server slowdowns, dropped TCP sockets, and missed enrollment opportunities. naive bots and manual re-clicking aggravate the problem by generating uncoordinated request storms.

| # | Real-World Pain Point | Naive / Legacy Bot Approach | Tool DKHP UTH Architectural Solution |
|:---:|:---|:---|:---|
| **1** | **Server Overload & 429 Throttle:** Portal drops sockets mid-response (`Premature close`). | Blind rapid requests; floods server until IP blocked. | **Jittered Exponential Backoff:** Re-uses Keep-Alive sockets with transient error categorization; respects HTTP 429 rate limits without thrashing. |
| **2** | **Accidental Double Booking:** Enrolling in overlapping time slots corrupts academic plans. | Submits blindly; user discovers conflict after registration fails. | **Visual Timetable Matrix:** Client-side schedule chunk parses period ranges (e.g., `3-5`, `7-9`), highlighting conflicts before network dispatch. |
| **3** | **Unsafe Course Swapping:** Canceling an old class before securing a replacement risks losing both. | Cancels current class, then attempts new class. | **Guarded Atomic Swap Loop:** Evaluates target class slot availability first; only issues cancellation upon verified target vacancy. |
| **4** | **Redundant Heavy Queries:** Every student crawling 2,000+ course sections stalls portal DB. | Crawls entire course schedule from scratch for each client. | **Crowdsourced Class Ledger:** Distributed class metadata sync (`shared_class_data`); students contribute and consume cached class schedules. |
| **5** | **Bank Webhook Race Conditions:** Concurrent payment notifications cause double activation. | Plain `UPDATE` without state checks. | **Compare-And-Swap (CAS) Idempotency:** Single-document atomic state transition (`Unpaid` → `Paid`) with CSPRNG order code tying. |
| **6** | **Credential Phishing Concerns:** Students hesitant to trust third-party tools with passwords. | Stores username and plaintext password in central DB. | **Zero-Credential Storage:** Never persists student passwords; exchanges credentials directly with upstream portal for transient session token. |
| **7** | **Obfuscated Code Distrust:** Blackbox client scripts hiding telemetry or malicious hooks. | Heavily obfuscated, unreadable JavaScript bundles. | **100% Transparent Open-Source:** No obfuscation, no mangling, pure ES2020 JavaScript verified via automated build contracts. |

---

## System Architecture

```
                                    +----------------------------------------------------+
                                    |                 Browser Client                     |
                                    |  (index.html | app.js | timetable.js [lazy chunk])  |
                                    +-------------------------+--------------------------+
                                                              |
                                           HTTPS / JSON APIs  | (Bearer Token Session)
                                                              v
+------------------------------------------------------------------------------------------------------------------+
|                                              Vercel Edge / Serverless                                            |
|                                                                                                                  |
|   +--------------------------+  +--------------------------+  +------------------------+  +--------------------+  |
|   |     /api/handler.js      |  |   /api/admin-handler.js  |  |  /api/sepay-webhook.js |  |   /api/db.js       |  |
|   |  - Upstream Gateway      |  |  - Plan Management       |  |  - Bank QR Payment     |  |  - Connection Pool |  |
|   |  - Backoff & Resilience  |  |  - Scrypt Admin Auth     |  |  - CAS State Machine   |  |  - Atomic Counters |  |
|   |  - Class Sync & Schedule |  |  - Financial Metrics     |  |  - VIP Grant Ledger    |  |  - VN Wall-Clock   |  |
|   +------------+-------------+  +-------------+------------+  +-----------+------------+  +---------+----------+  |
+----------------|------------------------------|---------------------------|-------------------------|------------+
                 |                              |                           |                         |
                 | Keep-Alive HTTPS             +---------------------------+-------------------------+
                 | (with Exponential Backoff)                               |
                 v                                                          v
+------------------------------------+                    +-----------------------------------+
|         UTH Portal Upstream        |                    |       MongoDB Atlas Cluster       |
|       (portal.ut.edu.vn)           |                    |                                   |
|  - Auth Token Validation           |                    |  - users & counters               |
|  - Class Unit Search               |                    |  - orders & transactions          |
|  - Registration POST / DELETE      |                    |  - vip_plans & vip_subscriptions  |
+------------------------------------+                    |  - shared_class_data              |
                                                          +-----------------------------------+
```

### Directory Structure

```
ut-course-register/
├── api/                            # Vercel Serverless Function Endpoints
│   ├── admin-handler.js            # Admin dashboard actions, analytics, plan config
│   ├── db.js                       # Shared MongoDB Atlas client, pool, atomic counters
│   ├── handler.js                  # Primary API: auth, proxy, registration, class sync
│   └── sepay-webhook.js            # SePay payment gateway webhook with CAS idempotency
├── public/                         # Production Client Assets (Static & Clean JS)
│   ├── admin.html                  # Administrative management UI with Chart.js
│   ├── admin-panel.js              # Admin control panel script (Clean ES2020)
│   ├── app.css                     # Responsive styling & modal animations
│   ├── app.js                      # Main application logic & registration engine
│   ├── favicon.svg                 # Application favicon
│   ├── guide.html                  # Step-by-step user manual & About section
│   ├── index.html                  # Main dashboard, course matrix, and logger
│   ├── manifest.json               # Progressive Web App manifest
│   ├── robots.txt                  # Search engine crawling rules
│   ├── sitemap.xml                 # Search engine sitemap
│   └── timetable.js                # Code-split lazy chunk for visual weekly schedule
├── scripts/                        # Utility & Operational Maintenance Tools
│   ├── measure-js-cost.mjs         # V8 parse/compile latency benchmarking
│   ├── migrate-sql-to-mongo.mjs    # Legacy MySQL dump to MongoDB migration tool
│   └── set-admin-password.mjs      # Administrative password update using scrypt
├── tests/                          # Comprehensive Automated Test Suite (56 tests)
│   ├── 01-static-contracts.test.mjs    # Code architecture, anti-freeze, open-source contracts
│   ├── 02-db-schema-contract.test.mjs  # Live MongoDB index & collection schema contracts
│   ├── 03-login-path.test.mjs          # Login latency, fail-fast guarantees, handshake timing
│   ├── 04-login-e2e.test.mjs           # Full registration, VIP orders, CORS, token auth
│   ├── 05-security.test.mjs            # Scrypt password verify, webhook forge reject, CSPRNG
│   ├── 06-migration-verification.test.mjs # Field-for-field database migration audit
│   ├── 07-upstream-resilience.test.mjs    # Portal drop retry, backoff jitter, 429 compliance
│   ├── fixtures/                       # Static mock data and migration manifest
│   ├── helpers.mjs                     # Test environment bootstrap and path helpers
│   ├── loader.mjs                      # Dynamic mock loader with module caching
│   └── mocks/                          # Stubbed network fetch and MongoDB in-memory mock
├── esbuild.config.js               # Clean build pipeline: versioning & ES2020 validation
├── package.json                    # Project metadata, scripts, and runtime dependencies
└── vercel.json                     # Serverless routing, header security, and Cron schedules
```

---

## Core Capabilities

### 1. Intelligent Upstream Resilience & Backoff
`api/handler.js` includes an enterprise-grade retry engine tailored to handle the instability of `portal.ut.edu.vn` during peak traffic:
- **Categorized Error Classification:** Differentiates between transient connection drops (`Premature close`, `ECONNRESET`, `ETIMEDOUT`) and definitive upstream errors (e.g. non-JSON maintenance pages).
- **Exponential Backoff with Full Jitter:** Base retry of 600ms scaled up to 6,000ms with randomized jitter to prevent thundering herd problems against university infrastructure.
- **Strict Non-Idempotent Safety:** The course registration `POST` (`/dangKyLopHocPhan`) is **never replayed** upon a dropped socket to prevent ambiguous duplicate submissions. It is only retried when an explicit HTTP 429 status proves the request was rejected before processing.
- **Pooled Keep-Alive vs Fresh Socket Retries:** Uses a shared `https.Agent` for hot-path speed, but switches to a clean unpooled socket on retry to prevent reusing half-closed TCP connections.

### 2. Automated Course Sniping & Swap Safety
- **Queue Loop with Concurrency Semaphore:** Browser background loops run under an `AUTO_MAX_CONCURRENT` semaphore (capped between 1 and 4 requests), preventing tab freezes and network starvation.
- **Tab Freeze Guard:** The browser console logger batches DOM changes into `requestAnimationFrame` and trims entries to `MAX_LOG_LINES`, eliminating UI locking during extended registration marathons.
- **Safe Class Swap:** Allows users to stage an enrolled class for swapping; the engine verifies slot availability on the desired class before dispatching the deletion of the old one.

### 3. Crowdsourced Class Cache Architecture
- When one student crawls the complete schedule for a semester term (`dot_id`), the server saves the sanitized sections into `shared_class_data`.
- Subsequent students requesting schedule data retrieve it instantly from MongoDB cache, cutting university portal traffic by up to 90%.
- Contributors are tracked via the `class_data_contributions` ledger.

### 4. Idempotent Payment & VIP Ledger
- **CSPRNG Order Generation:** Every order code (`DKHP` + 12 alphanumeric chars) is created with `crypto.randomBytes()`, eliminating predictability.
- **Compare-And-Swap (CAS) Processing:** Webhook handlers (`api/sepay-webhook.js`) update orders using atomic single-document checks (`{ order_code, payment_status: 'Unpaid' }` → `$set: { payment_status: 'Paid' }`). Duplicate webhooks or racing cancellation sweeps cannot trigger double activations.
- **Automated Sweep:** Unpaid orders older than 15 minutes are systematically transitioned to `Cancelled` via serverless cron (`0 3 * * *`).

### 5. Zero-Credential Security Model
- **No Password Storage:** Student credentials are transmitted securely through TLS to the official UTH portal. Only the transient Bearer token is returned to the client and held in browser session memory.
- **Scrypt Password Hashing:** Admin credentials (`admins` collection) use `crypto.scryptSync` with $N=16384$, $r=8$, $p=1$, evaluated via `crypto.timingSafeEqual`.
- **CORS Pinning:** CORS headers strictly enforce `FRONTEND_URL` and `ADMIN_FRONTEND_URL`, rejecting wildcards (`*`) on authenticated endpoints.

### 6. Transparent Open-Source Frontend
- **Zero Obfuscation:** The codebase contains no JavaScript obfuscation, no mangled variables, no base64 string decoders, and no debugger loops.
- **Code-Splitting for Fast FCP:** The heavy visual timetable module (`public/timetable.js`) is code-split and loaded asynchronously on demand or preloaded during browser idle (`requestIdleCallback`).

---

## Database Schema & Data Contracts

All data is structured in MongoDB Atlas under the database specified by `MONGODB_DB` (default: `uth_registration`).

| Collection | Key Fields | Indexes / Constraints | Purpose |
|:---|:---|:---|:---|
| `users` | `id`, `user_id` (MSSV), `full_name`, `email`, `is_active` | `UNIQUE(user_id)` | Student profile & record of platform usage. |
| `admins` | `id`, `username`, `password_hash`, `is_active` | `UNIQUE(username)` | Administrator accounts (scrypt-hashed). |
| `vip_plans` | `id`, `plan_key`, `name`, `price`, `duration_days`, `is_active` | `UNIQUE(id)`, `UNIQUE(plan_key)` | Subscription tier pricing and benefits. |
| `vip_subscriptions` | `id`, `user_id`, `plan_id`, `expires_at`, `is_active` | `UNIQUE(id)`, `INDEX(user_id)` | Active student VIP access periods. |
| `orders` | `id`, `order_code`, `user_id`, `amount`, `payment_status` | `UNIQUE(id)`, `UNIQUE(order_code)`, `INDEX(payment_status, created_at)` | Inbound payment intent and order lifecycle. |
| `transactions` | `id`, `order_id`, `transaction_date`, `reference_number` | `UNIQUE(id)`, `INDEX(reference_number)` | Bank transfer audit logs received from SePay. |
| `shared_class_data` | `id`, `dot_id`, `ma_lop_hoc_phan`, `ten_mon_hoc`, `schedule` | `UNIQUE(id)`, `UNIQUE(dot_id, ma_lop_hoc_phan)` | Crowdsourced course sections cache. |
| `class_data_contributions` | `id`, `user_id`, `dot_id`, `classes_count` | `UNIQUE(id)`, `UNIQUE(user_id, dot_id)` | Audit trail of crowd-synced class contributions. |
| `counters` | `_id` (collection name), `seq` | Atomic `$inc` counter | Emulates auto-incrementing integer IDs without collisions. |

> [!TIP]
> **Timezone Standardization:** Dates in MongoDB are stored as BSON UTC Date instants. The utility functions `vnWallClockToUTCDate()` and `utcToVnWallClock()` in `api/db.js` guarantee consistent conversions with Vietnam standard time (UTC+07:00).

---

## Environment Variables

Configure the following variables in `.env` (or in Vercel Project Settings):

```bash
# Database Configuration
MONGODB_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
MONGODB_DB="uth_registration"
MONGODB_POOL_SIZE=5
MONGO_SERVER_SELECTION_TIMEOUT_MS=8000

# Security & CORS
FRONTEND_URL="https://dkhp.ddns.net"
ADMIN_FRONTEND_URL="https://dkhp.ddns.net"
CRON_SECRET="your-high-entropy-cron-secret"

# SePay Payment Gateway Integration
SEPAY_API_KEY="your-sepay-api-key"
SEPAY_BANK_NAME="MBBank"
SEPAY_ACCOUNT_NUMBER="01006022006"
SEPAY_ACCOUNT_NAME="NGUYEN THAI SU"

# Upstream UTH Portal Tuning (Optional)
UPSTREAM_TIMEOUT_MS=15000
UPSTREAM_MAX_ATTEMPTS=5
UPSTREAM_RETRY_BASE_MS=600
UPSTREAM_RETRY_MAX_MS=6000
CLASS_FETCH_CONCURRENCY=8
DETAIL_FETCH_CONCURRENCY=16
```

---

## Getting Started & Local Development

### Prerequisites
- Node.js `22.x` or `24.x`
- npm `10.x` or higher
- (Optional) A free-tier MongoDB Atlas cluster for testing live database contracts

### 1. Installation
Clone the repository and install runtime and developer dependencies:
```bash
git clone https://github.com/yourusername/ut-course-register.git
cd ut-course-register
npm install
```

### 2. Syntax Check & Asset Verification
Run the fast syntax and open-source compliance checks:
```bash
# Verify JavaScript syntax across all backend and frontend files
npm run check

# Verify and stamp release version numbers
npm run build
```

### 3. Local Development Server
Launch the serverless runtime emulator via Vercel CLI:
```bash
npm run dev
```
Navigate to `http://localhost:3000` to interact with the student dashboard or `http://localhost:3000/admin` for the admin portal.

---

## Automated Verification & Test Suite

The repository features a rigorous test suite built with Node.js's native test runner (`node:test`), eliminating third-party testing bloat.

### Running Tests

```bash
# Run the complete test suite (Offline tests pass out-of-the-box; Live DB tests auto-skip if MONGODB_URI is absent)
npm test

# Run isolated offline mock tests (CI-friendly, zero network dependencies)
npm run test:offline

# Run live database contracts (Requires MONGODB_URI)
MONGODB_URI="mongodb+srv://..." npm run test:db
```

### Test Suite Breakdown (56 Passing Tests)

1. **`01-static-contracts.test.mjs` (13 tests):** Validates that all serverless handlers connect via `./db.js`, client connections cannot leak, upstream fetches use AbortSignals, bundle obfuscation is completely removed, timetable chunk is code-split, and UI logging loops cannot freeze browser tabs.
2. **`02-db-schema-contract.test.mjs` (7 contract tests):** Verifies unique indexes, counter sequences, date instant storage, and Vietnamese Unicode round-tripping against MongoDB Atlas.
3. **`03-login-path.test.mjs` (4 tests):** Enforces cold start handshake limits (<5s) and verifies fail-fast driver disconnection when the cluster is unreachable.
4. **`04-login-e2e.test.mjs` (16 tests):** Validates full authentication flow, token extraction, anonymous order rejection (anti-IDOR), order ownership verification, and cron maintenance sweeps.
5. **`05-security.test.mjs` (16 tests):** Confirms scrypt password verification, timing-safe evaluation, automatic legacy plaintext hash migration, SePay forged webhook rejection (401), idempotent replay tolerance, CSPRNG order code entropy, and zero credential leakage.
6. **`06-migration-verification.test.mjs` (5 tests):** Audits migrated tables from MySQL to MongoDB, verifying exact document counts and sequence continuity.
7. **`07-upstream-resilience.test.mjs` (11 tests):** Simulates upstream network dropouts (`Premature close`), HTTP 429 throttling, 5xx server errors, non-idempotent registration POST replay guards, and bounded schedule concurrency.

---

## About The Project / Về Dự Án Tool DKHP UTH

### The Origin & Purpose
Tool DKHP UTH was created by student developers for the student community of the **University of Transport and Communications Ho Chi Minh City (Trường Đại học Giao thông vận tải TP.HCM - UTH)**. 

Every semester, course registration is a high-stress moment. Thousands of students log on simultaneously at designated opening hours, resulting in slow responses, dropped connections, and server timeouts. Many students struggle to register for essential courses required to graduate on time, purely due to network latency and server queue exhaustion.

This project was built to address these challenges with the following core principles:

1. **Infrastructure Stewardship:** Rather than creating chaotic bots that DOS the university server, this tool employs smart queues, connection reuse, exponential backoff, full jitter, and crowdsourced class data caching to **reduce overall network strain on the school portal by up to 90%**.
2. **Fairness & Accessibility:** Essential planning tools — including schedule fetching, conflict detection, class selection, and timetable visualization — are provided 100% free to all students.
3. **Zero-Credential Security:** The application upholds privacy standards. Passwords are never logged, tracked, or saved to any database.
4. **Transparent Open Source:** All client code is distributed without obfuscation, minification traps, or hidden scripts. Anyone can inspect, verify, and run the code with full confidence.

### Project Leadership & Credits
- **Maintainer:** UTH Dev Team & Open Source Contributors
- **Contact & Community:** [GitHub Repository Issues](https://github.com/yourusername/ut-course-register/issues)
- **License:** Licensed under the [MIT License](LICENSE).

---

## Executive Summary & Domain Guide (Tóm Tắt Dự Án & Nghiệp Vụ UTH)

### Giới Thiệu Tổng Quan
**Tool DKHP UTH** là công cụ hỗ trợ đăng ký học phần tự động và quản lý kế hoạch học tập dành riêng cho sinh viên **Trường Đại học Giao thông vận tải TP.HCM (UTH)**. Dự án giải quyết triệt để bài toán nghẽn mạng và quá tải hệ thống đào tạo trong các đợt mở cổng tín chỉ trực tuyến.

### Các Tính Năng Nổi Bật Dành Cho Sinh Viên UTH
1. **Đăng Nhập An Toàn & Bảo Mật Tuyệt Đối:**
   - Hệ thống xác thực trực tiếp với `portal.ut.edu.vn` qua giao thức HTTPS bảo mật.
   - **Cam kết không lưu trữ mật khẩu sinh viên:** Hệ thống chỉ lưu giữ session token tạm thời trong phiên làm việc của trình duyệt để thực hiện các yêu cầu cần thiết.
2. **Trực Quan Hóa Thời Khóa Biểu:**
   - Trình diễn lịch học dạng lưới thời gian trực quan theo tuần và theo từng đợt học (Đợt 1 / Đợt 2).
   - Tự động phát hiện và cảnh báo tức thì các môn học bị **trùng tiết học hoặc trùng ngày**, giúp sinh viên chọn lớp chuẩn xác trước khi đăng ký.
3. **Đổi Lớp & Chèn Lớp Tự Động Thông Minh:**
   - Hỗ trợ cơ chế săn slot trống khi có sinh viên khác nhả lớp.
   - Cơ chế đổi lớp an toàn: Kiểm tra lớp mới còn chỗ trống rồi mới gửi lệnh huỷ lớp cũ, tránh tình trạng mất trắng lớp đã đăng ký ban đầu.
4. **Chia Sẻ Dữ Liệu Lớp Học (Crowdsourced Data):**
   - Khi một sinh viên tải toàn bộ danh mục lớp của đợt học, dữ liệu được đồng bộ lên máy chủ MongoDB. Các bạn sinh viên khác truy cập sau sẽ đọc dữ liệu từ cache mà không cần gửi hàng trăm request crawl đè nặng lên máy chủ của trường.
5. **Mã Nguồn Mở Minh Bạch:**
   - Dự án đã loại bỏ toàn bộ các cơ chế mã hóa / làm rối mã nguồn (obfuscation), mang lại sự minh bạch, an toàn và dễ dàng đóng góp từ cộng đồng sinh viên công nghệ thông tin UTH.

### Hướng Dẫn Sử Dụng Nhanh
- **Bước 1:** Mở ứng dụng, nhập tài khoản và mật khẩu Portal UTH để đăng nhập.
- **Bước 2:** Nhấn **"Lấy Lịch Học"** để xem toàn bộ danh sách lớp học phần đang mở.
- **Bước 3:** Tích chọn các lớp học phần mong muốn. Nhấn nút **"Thời khóa biểu"** để kiểm tra xung đột lịch.
- **Bước 4:** Chọn chế độ **"Đăng ký tự động"** hoặc **"Chèn lớp"** khi cổng trường chính thức mở thời gian đăng ký.
- **Bước 5:** Theo dõi tiến trình trực tiếp tại khung **"Nhật ký hoạt động"**. Sau khi hoàn tất, nhấn **"Làm mới"** để xác nhận danh sách lớp đã được ghi nhận trên Portal UTH.
