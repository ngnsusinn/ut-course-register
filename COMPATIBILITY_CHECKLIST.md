
# 🔍 COMPATIBILITY CHECKLIST: Source Code vs Improved Database

## 📋 Overview

Kiểm tra tương thích giữa source code cũ/mới với database improved.

---

## ✅ handler.js Changes

### 1. ✓ saveUserInfo() - User Insertion
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| Query field | `username` | `user_id` | ✅ UPDATED |
| CHECK constraints | None | CHAR_LENGTH >= 6 | ✅ ENFORCED |
| Email validation | None | LIKE '%@%' | ✅ ENFORCED |
| unique violation | Returns error | Returns error | ✅ Same |

**Action Required:** ✅ Update handler.js `saveUserInfo()`

```diff
- await connection.execute('SELECT id FROM users WHERE username = ?', [username])
+ await connection.execute('SELECT id FROM users WHERE user_id = ?', [userId])

- await connection.execute('INSERT INTO users (username, ...) VALUES (?, ...)', [username, ...])
+ await connection.execute('INSERT INTO users (user_id, ...) VALUES (?, ...)', [userId, ...])
```

---

### 2. ✓ checkVIPStatus() - VIP Lookup
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| Query field | `user_id` | `user_id` | ✅ UNCHANGED |
| FK constraint | None | REFERENCES users(user_id) | ✅ ENFORCED |
| Return fields | Same | Same + planId | ✅ COMPATIBLE |

**Status:** ✅ NO CHANGES NEEDED

---

### 3. ✓ createOrder() - Order Creation
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| plan_id field | None | Added | ⚠️ NEW FIELD |
| FK validation | Code-level | Database-level | ✅ IMPROVED |
| User validation | None | FK constraint | ✅ ENFORCED |
| cancelled_at | None | Added for tracking | ✅ NEW |

**Action Required:** ⚠️ Update handler.js `createOrder()`

```diff
  const [result] = await connection.execute(
-   'INSERT INTO orders (user_id, plan_type, plan_name, amount, payment_status, gateway, order_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
+   'INSERT INTO orders (user_id, plan_id, plan_type, plan_name, amount, payment_status, gateway, order_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
-   [userId, plan, planConfig.name, planConfig.price, 'Unpaid', 'SePay', orderCode]
+   [userId, planConfig.id, plan, planConfig.name, planConfig.price, 'Unpaid', 'SePay', orderCode]
  );
```

**getVIPPlansFromDB()** - Must return plan.id:
```javascript
plansObj[plan.plan_key] = {
    id: plan.id,  // ✅ ADD THIS
    price: parseFloat(plan.price),
    ...
};
```

---

### 4. ✓ cancelOrder() - Order Cancellation
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| cancelled_at | Not set | Set to NOW() | ⚠️ NEW |
| Payment status | "Cancelled" | "Cancelled" + cancelled_at | ✅ COMPATIBLE |
| Log activity | Same | Same | ✅ UNCHANGED |

**Action Required:** ⚠️ Update handler.js `cancelOrder()`

```diff
  await connection.execute(
-   'UPDATE orders SET payment_status = "Cancelled", updated_at = NOW() WHERE id = ?',
+   'UPDATE orders SET payment_status = "Cancelled", cancelled_at = NOW(), updated_at = NOW() WHERE id = ?',
    [orderId]
  );
```

---

### 5. ✓ autoCancelExpiredOrders()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| SQL Query | Same | Same + SET cancelled_at | ⚠️ UPDATED |
| Log creation | Same logic | Same logic | ✅ COMPATIBLE |
| Stored procedure | Not used | Available (optional) | ✅ FALLBACK |

**Status:** ✅ Code works with both old & new (cancelled_at is optional)

---

## ✅ admin-handler.js Changes

### 1. ✓ getAllUsers()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| Query field | `username` | `user_id` | ⚠️ UPDATED |
| FK constraint | None | Users must exist | ✅ ENFORCED |
| Output format | Same | Same | ✅ COMPATIBLE |

**Action Required:** ⚠️ Update admin-handler.js `getAllUsers()`

```diff
  const [users] = await connection.query(`
      SELECT 
-         u.username as user_id,
+         u.user_id,
          u.full_name,
          u.email,
          ...
-     FROM users u ... WHERE u.username = vs.user_id
+     FROM users u ... WHERE u.user_id = vs.user_id
```

---

### 2. ✓ addVIPSubscription()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| plan_id field | None | Required for FK | ⚠️ NEW |
| User validation | None | CHECK - must exist | ✅ ENFORCED |
| created_by_admin | None | New field | ⚠️ NEW |
| Transaction | Yes | Yes | ✅ SAME |

**Action Required:** ⚠️ Update admin-handler.js `addVIPSubscription()`

```diff
+ const planId = planData[0].id;  // ✅ Get plan_id
+ 
  const [existingUser] = await connection.execute(
-     'SELECT id FROM users WHERE username = ?', [userId]
+     'SELECT id FROM users WHERE user_id = ?', [userId]
  );
  
  if (existingUser.length === 0) {
      await connection.execute(
-         'INSERT INTO users (username, created_at) VALUES (?, NOW())', [userId]
+         'INSERT INTO users (user_id, is_active, created_at) VALUES (?, 1, NOW())', [userId]
      );
  }

  await connection.execute(
-     'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date, created_at) VALUES (...)',
+     'INSERT INTO vip_subscriptions (user_id, plan_id, plan_type, expiry_date, created_by_admin, created_at) VALUES (...)',
-     [userId, planType, expiryDate, NOW()]
+     [userId, planId, planType, expiryDate, 'admin', NOW()]
  );
```

---

### 3. ✓ getAllSubscriptions()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| plan_id field | Not selected | Must select | ⚠️ NEW |
| Join with vip_plans | No | Yes (for plan_name) | ⚠️ NEW |
| Output format | Same | Same | ✅ COMPATIBLE |

**Action Required:** ⚠️ Update admin-handler.js `getAllSubscriptions()`

```diff
  const [subscriptions] = await connection.query(`
      SELECT 
          vs.id, vs.user_id, 
+         vs.plan_id,
          vs.plan_type, 
+         vp.plan_name,
          vs.expiry_date, 
+         vs.created_by_admin,
          vs.created_at
      FROM vip_subscriptions vs
+     LEFT JOIN vip_plans vp ON vs.plan_id = vp.id
      ORDER BY vs.created_at DESC
  `);
```

---

### 4. ✓ getAllOrders()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| plan_id field | Not selected | May select | ⚠️ NEW |
| cancelled_at field | Not selected | May select | ⚠️ NEW |
| Output format | Same | Same | ✅ COMPATIBLE |

**Action Required:** ⚠️ Update admin-handler.js `getAllOrders()`

```diff
  const [orders] = await connection.query(`
      SELECT 
          id, order_code, user_id, 
+         plan_id,
          plan_name, amount, payment_status, 
+         paid_at, cancelled_at,
          created_at
      FROM orders ORDER BY created_at DESC
  `);
```

---

### 5. ✓ getAllTransactions()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| order_id field | Not selected | NEW for FK | ⚠️ NEW |
| Query | Same | Same + order_id | ⚠️ UPDATED |
| Output format | Same | Same | ✅ COMPATIBLE |

**Action Required:** ⚠️ Update admin-handler.js `getAllTransactions()`

```diff
  const [transactions] = await connection.query(`
      SELECT 
          id, 
+         order_id,
          gateway, amount_in, 
          transaction_content, reference_number, 
          received_at
      FROM transactions ORDER BY received_at DESC
  `);
```

---

## ✅ sepay-webhook.js Changes

### 1. ✓ processVIPPayment()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| plan_id field | Not read | Read from order | ⚠️ UPDATED |
| Row locking | No | Yes (FOR UPDATE) | ✅ IMPROVED |
| Cancelled order handling | Same | Same | ✅ COMPATIBLE |
| Timestamp format | String | DATE format | ✅ COMPATIBLE |

**Status:** ✅ Code works with both old & new (plan_id is optional)

---

### 2. ✓ recordTransaction()
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| order_id field | Not set | Set (NEW) | ⚠️ NEW |
| FK constraint | None | REFERENCES orders(id) | ✅ ENFORCED |
| Transaction insertion | Separate step | Included | ✅ IMPROVED |

**Action Required:** ⚠️ Update sepay-webhook.js `recordTransaction()`

```diff
  await connection.execute(
-     'INSERT INTO transactions (...) VALUES (...)',
+     'INSERT INTO transactions (..., order_id, ...) VALUES (..., ?, ...)',
-     [gateway, transactionDateStr, accountNumber, ...]
+     [gateway, transactionDateStr, accountNumber, ..., orderId, ...]
  );
```

Also update webhook handler to pass orderId:
```diff
  const result = await processVIPPayment(orderId, {
      amount_in: amountIn,
      reference_number: referenceCode,
+     orderId: orderId  // ✅ Pass for recording
  });
```

---

### 3. ✓ Activity Logs - New action type CHECK
| Aspect | Cũ | Mới | Status |
|--------|-----|-----|--------|
| action field | String (any) | ENUM with CHECK | ⚠️ VALIDATED |
| Valid actions | Not enforced | Fixed set | ✅ ENFORCED |
| New action: PAYMENT_ON_CANCELLED_ORDER | No | Yes | ✅ NEW |

**Supported Actions:**
```sql
✅ USER_LOGIN
✅ VIP_PURCHASE
✅ ORDER_CANCELLED
✅ ORDER_AUTO_CANCELLED
✅ ADMIN_ADD_VIP
✅ ADMIN_DELETE_VIP
✅ PAYMENT_ON_CANCELLED_ORDER (new)
✅ TRANSACTION_RECEIVED (new)
... (see roacqgfa_reg_improved.sql for full list)
```

---

## 📊 Migration Summary Table

| Component | Cũ | Mới | Impact | Priority |
|-----------|-----|-----|--------|----------|
| **handler.js** |
| saveUserInfo() | username | user_id | ⚠️ BREAKING | 🔴 HIGH |
| createOrder() | No plan_id | plan_id FK | ⚠️ REQUIRED | 🔴 HIGH |
| cancelOrder() | No cancelled_at | cancelled_at | ✅ COMPATIBLE | 🟡 MED |
| **admin-handler.js** |
| getAllUsers() | username | user_id | ⚠️ BREAKING | 🔴 HIGH |
| addVIPSubscription() | No plan_id | plan_id + created_by_admin | ⚠️ REQUIRED | 🔴 HIGH |
| getAllSubscriptions() | Limited select | plan_id + plan_name | ✅ ENHANCED | 🟢 LOW |
| getAllOrders() | Basic select | plan_id + cancelled_at | ✅ ENHANCED | 🟢 LOW |
| **sepay-webhook.js** |
| processVIPPayment() | Same logic | Same logic | ✅ COMPATIBLE | 🟢 LOW |
| recordTransaction() | No order_id | order_id FK | ⚠️ REQUIRED | 🔴 HIGH |

---

## 🎯 REQUIRED UPDATES (Blocking)

### 🔴 Priority 1 - Update NOW
```bash
1. handler.js: saveUserInfo() - Change username → user_id
2. handler.js: createOrder() - Add plan_id to INSERT
3. admin-handler.js: getAllUsers() - Change username → user_id
4. admin-handler.js: addVIPSubscription() - Add plan_id + created_by_admin
5. sepay-webhook.js: recordTransaction() - Add order_id FK
```

### 🟡 Priority 2 - Update Recommended
```bash
6. handler.js: cancelOrder() - Add cancelled_at tracking
7. admin-handler.js: getAllSubscriptions() - Join vip_plans
8. admin-handler.js: getAllOrders() - Select plan_id + cancelled_at
```

### 🟢 Priority 3 - Optional Enhancements
```bash
9. Use views instead of direct queries (v_active_vip_users, etc.)
10. Call stored procedures (sp_get_user_vip_status, etc.)
11. Add admin_id tracking to activity_logs
```

---

## 🔧 Quick Fix Script

```bash
# Batch update files
sed -i 's/WHERE username = ?/WHERE user_id = ?/g' api/handler.js
sed -i 's/WHERE username = ?/WHERE user_id = ?/g' api/admin-handler.js

# Check for remaining old patterns
grep -r "username" api/ | grep -v old.js | grep "query\|execute"
```

---

## ✅ Verification Checklist

- [ ] Database: `DESCRIBE users` shows `user_id` column
- [ ] Database: `SHOW CREATE TABLE orders` shows plan_id FK
- [ ] Code: `handler.js` searchable for `user_id` (not `username`)
- [ ] Code: `createOrder()` includes plan_id in INSERT
- [ ] Code: `admin-handler.js` getAllUsers() uses user_id
- [ ] Code: `sepay-webhook.js` recordTransaction() inserts order_id
- [ ] Test: Create order → Verify plan_id saved
- [ ] Test: Admin add VIP → Verify plan_id + created_by_admin saved
- [ ] Test: Webhook payment → Verify order_id saved in transactions
- [ ] Views work: `SELECT * FROM v_active_vip_users`
- [ ] Procedures work: `CALL sp_get_user_vip_status('054206005638')`

---

**Last Updated:** Oct 29, 2025  
**Status:** ✅ Ready for Implementation  
**Breaking Changes:** 5 (High Priority)  
**Compatible Updates:** 3 (Medium Priority)  
**Enhancements:** 3 (Low Priority)
