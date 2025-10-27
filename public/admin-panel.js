const API_URL = '/api/admin-handler';
let currentUser = null;
let allData = {
    users: [],
    subscriptions: [],
    orders: [],
    transactions: [],
    logs: [],
    paymentSettings: []
};
let currentPaymentMethod = 'sepay';

// Login functionality
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const loginBtn = document.querySelector('#loginScreen button');
    const errorDiv = document.getElementById('loginError');

    if (!username || !password) {
        showToast('Vui lòng nhập đầy đủ thông tin!', 'error');
        errorDiv.classList.remove('hidden');
        errorDiv.textContent = 'Vui lòng nhập đầy đủ thông tin!';
        return;
    }

    // Show loading
    const originalHTML = loginBtn.innerHTML;
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<div class="loader"></div> Đang đăng nhập...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', payload: { username, password } })
        });

        const data = await response.json();
        
        if (data.success) {
            currentUser = data.admin;
            document.getElementById('adminUsername').textContent = currentUser.username;
            showToast('Đăng nhập thành công!', 'success');
            
            // Direct transition
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            
            await refreshData('users');
        } else {
            showToast(data.message || 'Đăng nhập thất bại!', 'error');
            errorDiv.textContent = data.message || 'Đăng nhập thất bại!';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
        errorDiv.textContent = 'Lỗi kết nối: ' + error.message;
        errorDiv.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHTML;
    }
}

function showToast(message, type = 'info') {
    // Remove existing toast if any
    const existingToast = document.getElementById('inPageToast');
    if (existingToast) existingToast.remove();
    
    // Create in-page toast (not popup)
    const toast = document.createElement('div');
    toast.id = 'inPageToast';
    toast.className = `fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
        type === 'success' ? 'bg-green-500 text-white' : 
        type === 'error' ? 'bg-red-500 text-white' : 
        'bg-blue-500 text-white'
    }`;
    
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `
        <span class="text-lg">${icon}</span>
        <span class="font-medium">${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

function logout() {
    currentUser = null;
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('loginError').classList.add('hidden');
}

// Tab functionality
function switchTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('tab-active');
        btn.classList.add('text-gray-600');
    });
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    
    // Activate selected tab
    document.querySelector(`[data-tab="${tab}"]`).classList.add('tab-active');
    document.querySelector(`[data-tab="${tab}"]`).classList.remove('text-gray-600');
    document.getElementById(`${tab}Tab`).classList.remove('hidden');
    
    // Load data based on tab
    if (tab === 'settings') {
        loadPaymentSettings();
    } else {
        refreshData(tab);
    }
}

// Data fetching
async function refreshData(type) {
    const action = `getAll${type.charAt(0).toUpperCase() + type.slice(1)}`;
    const refreshBtn = document.querySelector(`#${type}Tab button[onclick*="refreshData"]`);
    
    if (refreshBtn) {
        const originalHTML = refreshBtn.innerHTML;
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<div class="loader"></div> Đang tải...';
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await response.json();
        
        if (data.success) {
            allData[type] = data[type] || [];
            renderTable(type);
        } else {
            console.error(`Error fetching ${type}:`, data.message);
            showToast(`Lỗi tải dữ liệu: ${data.message}`, 'error');
        }
    } catch (error) {
        console.error(`Error fetching ${type}:`, error);
        showToast(`Lỗi kết nối: ${error.message}`, 'error');
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = refreshBtn.getAttribute('data-original-html') || '🔄 Refresh';
            if (!refreshBtn.getAttribute('data-original-html')) {
                refreshBtn.setAttribute('data-original-html', '🔄 Refresh');
            }
        }
    }
}

// Render functions
function renderTable(type) {
    switch(type) {
        case 'users': renderUsers(); break;
        case 'subscriptions': renderSubscriptions(); break;
        case 'orders': renderOrders(); break;
        case 'transactions': renderTransactions(); break;
        case 'logs': renderLogs(); break;
    }
}

function renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    const searchTerm = document.getElementById('usersSearch').value.toLowerCase();
    
    const filteredUsers = allData.users.filter(user => 
        user.user_id.toLowerCase().includes(searchTerm)
    );

    tbody.innerHTML = filteredUsers.map(user => {
        const isVip = user.is_vip;
        const expiryDate = user.expiry_date ? new Date(user.expiry_date) : null;
        const isExpired = expiryDate && expiryDate < new Date();
        
        return `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4" data-label="User Info">
                <div class="font-medium text-gray-900">${user.user_id}</div>
                ${user.full_name ? `<div class="text-sm text-gray-500">${user.full_name}</div>` : ''}
            </td>
            <td class="px-6 py-4" data-label="VIP Status">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${isVip && !isExpired ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                    ${isVip && !isExpired ? '✅ VIP Active' : '❌ No VIP'}
                </span>
            </td>
            <td class="px-6 py-4 text-sm" data-label="Expiry">
                ${expiryDate ? formatDateTime(expiryDate) : 'N/A'}
            </td>
            <td class="px-6 py-4 flex gap-2" data-label="Actions">
                <button onclick="openAddVIPModal('${user.user_id}')" class="text-blue-600 hover:text-blue-900 font-medium text-sm">
                    ➕ Thêm VIP
                </button>
                <button onclick="showConfirmModal('Xóa User', 'Bạn có chắc muốn xóa user này không? Mọi dữ liệu liên quan sẽ bị xóa.', () => deleteUser('${user.user_id}'))" class="text-red-600 hover:text-red-900 font-medium text-sm">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
        `;
    }).join('');

    // Update stats
    const totalUsers = filteredUsers.length;
    const vipUsers = filteredUsers.filter(u => u.is_vip && new Date(u.expiry_date) > new Date()).length;
    const expiredUsers = filteredUsers.filter(u => u.expiry_date && new Date(u.expiry_date) < new Date()).length;
    
    document.getElementById('usersStats').innerHTML = `
        <div class="bg-blue-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-blue-600">${totalUsers}</div>
            <div class="text-sm text-gray-600">Tổng Users</div>
        </div>
        <div class="bg-green-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-green-600">${vipUsers}</div>
            <div class="text-sm text-gray-600">VIP Active</div>
        </div>
        <div class="bg-red-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-red-600">${expiredUsers}</div>
            <div class="text-sm text-gray-600">VIP Expired</div>
        </div>
    `;
}

function renderSubscriptions() {
    const tbody = document.getElementById('subscriptionsTableBody');
    const searchTerm = document.getElementById('subscriptionsSearch').value.toLowerCase();
    const statusFilter = document.getElementById('subscriptionsFilter').value;
    
    const filteredSubs = allData.subscriptions.filter(sub => {
        const matchesSearch = sub.user_id.toLowerCase().includes(searchTerm) || 
                            sub.plan_type.toLowerCase().includes(searchTerm);
        const isActive = new Date(sub.expiry_date) > new Date();
        const matchesStatus = !statusFilter || 
                            (statusFilter === 'active' && isActive) ||
                            (statusFilter === 'expired' && !isActive);
        return matchesSearch && matchesStatus;
    });

    tbody.innerHTML = filteredSubs.map(sub => {
        const isActive = new Date(sub.expiry_date) > new Date();
        return `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-medium" data-label="ID">${sub.id}</td>
            <td class="px-6 py-4" data-label="User">${sub.user_id}</td>
            <td class="px-6 py-4" data-label="Plan">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-medium">${sub.plan_type}</span>
            </td>
            <td class="px-6 py-4" data-label="Status">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${isActive ? '✅ Active' : '❌ Expired'}
                </span>
            </td>
            <td class="px-6 py-4 text-sm" data-label="Expiry">${formatDateTime(sub.expiry_date)}</td>
            <td class="px-6 py-4 text-sm" data-label="Created">${formatDateTime(sub.created_at)}</td>
            <td class="px-6 py-4" data-label="Actions">
                <button onclick="showConfirmModal('Xóa VIP Subscription', 'Bạn có chắc muốn xóa subscription này không?', () => deleteSubscription(${sub.id}))" class="text-red-600 hover:text-red-900 font-medium text-sm">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
        `;
    }).join('');
}

function renderOrders() {
    const tbody = document.getElementById('ordersTableBody');
    const searchTerm = document.getElementById('ordersSearch').value.toLowerCase();
    const statusFilter = document.getElementById('ordersFilter').value;
    
    const filteredOrders = allData.orders.filter(order => {
        const matchesSearch = order.user_id.toLowerCase().includes(searchTerm) || 
                            order.plan_name.toLowerCase().includes(searchTerm);
        const matchesStatus = !statusFilter || order.payment_status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    tbody.innerHTML = filteredOrders.map(order => `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-medium" data-label="ID">#${order.id}</td>
            <td class="px-6 py-4" data-label="User">${order.user_id}</td>
            <td class="px-6 py-4" data-label="Plan">${order.plan_name}</td>
            <td class="px-6 py-4 font-semibold" data-label="Amount">${parseFloat(order.amount).toLocaleString('vi-VN')}đ</td>
            <td class="px-6 py-4" data-label="Status">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${
                    order.payment_status === 'Paid' ? 'bg-green-100 text-green-800' :
                    order.payment_status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                }">
                    ${order.payment_status}
                </span>
            </td>
            <td class="px-6 py-4 text-sm" data-label="Created">${formatDateTime(order.created_at)}</td>
        </tr>
    `).join('');
}

function renderTransactions() {
    const tbody = document.getElementById('transactionsTableBody');
    const searchTerm = document.getElementById('transactionsSearch').value.toLowerCase();
    const amountFilter = document.getElementById('amountFilter').value;
    
    const filteredTrans = allData.transactions.filter(trans => {
        const matchesSearch = trans.reference_number?.toLowerCase().includes(searchTerm) || 
                            trans.transaction_content?.toLowerCase().includes(searchTerm);
        const matchesAmount = !amountFilter || parseFloat(trans.amount_in) === parseFloat(amountFilter);
        return matchesSearch && matchesAmount;
    });

    tbody.innerHTML = filteredTrans.map(trans => `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-medium" data-label="ID">${trans.id}</td>
            <td class="px-6 py-4" data-label="Gateway">
                <span class="px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs font-medium">${trans.gateway}</span>
            </td>
            <td class="px-6 py-4 font-semibold text-green-600" data-label="Amount">${parseFloat(trans.amount_in).toLocaleString('vi-VN')}đ</td>
            <td class="px-6 py-4 text-sm" data-label="Content">${trans.transaction_content || 'N/A'}</td>
            <td class="px-6 py-4 text-sm font-mono" data-label="Reference">${trans.reference_number || 'N/A'}</td>
            <td class="px-6 py-4 text-sm" data-label="Time">${formatDateTime(trans.received_at)}</td>
        </tr>
    `).join('');
}

function renderLogs() {
    const tbody = document.getElementById('logsTableBody');
    const searchTerm = document.getElementById('logsSearch').value.toLowerCase();
    const actionFilter = document.getElementById('logsFilter').value;
    
    const filteredLogs = allData.logs.filter(log => {
        const matchesSearch = log.user_id?.toLowerCase().includes(searchTerm) || 
                            log.action?.toLowerCase().includes(searchTerm);
        const matchesAction = !actionFilter || log.action === actionFilter;
        return matchesSearch && matchesAction;
    });

    tbody.innerHTML = filteredLogs.map(log => `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-medium" data-label="ID">${log.id}</td>
            <td class="px-6 py-4" data-label="User">${log.user_id || 'N/A'}</td>
            <td class="px-6 py-4" data-label="Action">
                <span class="px-2 py-1 rounded text-xs font-medium ${getActionColor(log.action)}">
                    ${getActionText(log.action)}
                </span>
            </td>
            <td class="px-6 py-4 text-sm" data-label="Details">${log.details || 'N/A'}</td>
            <td class="px-6 py-4 text-sm" data-label="Time">${formatDateTime(log.created_at)}</td>
        </tr>
    `).join('');
}

function getActionColor(action) {
    switch(action) {
        case 'USER_LOGIN': return 'bg-blue-100 text-blue-800';
        case 'VIP_PURCHASE': return 'bg-green-100 text-green-800';
        case 'ADMIN_ADD_VIP': return 'bg-purple-100 text-purple-800';
        case 'ADMIN_DELETE_VIP': return 'bg-red-100 text-red-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}

function getActionText(action) {
    switch(action) {
        case 'USER_LOGIN': return '🔐 Đăng nhập';
        case 'VIP_PURCHASE': return '💳 Mua VIP';
        case 'ADMIN_ADD_VIP': return '⭐ Admin thêm VIP';
        case 'ADMIN_DELETE_VIP': return '🗑️ Admin xóa VIP';
        default: return action;
    }
}

// VIP Management
function openAddVIPModal(userId = '') {
    document.getElementById('vipUserId').value = userId;
    document.getElementById('addVIPModal').classList.remove('hidden');
}

function closeAddVIPModal() {
    document.getElementById('addVIPModal').classList.add('hidden');
}

async function submitAddVIP() {
    const userId = document.getElementById('vipUserId').value.trim();
    const planType = document.getElementById('vipPlanType').value;
    const submitBtn = document.getElementById('submitVIPBtn');
    
    if (!userId) {
        showToast('Vui lòng nhập User ID!', 'error');
        return;
    }

    const originalHTML = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="loader"></div> Đang xử lý...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'addVIPSubscription', 
                payload: { userId, planType } 
            })
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('✅ Đã thêm VIP thành công!', 'success');
            closeAddVIPModal();
            await Promise.all([refreshData('users'), refreshData('subscriptions')]);
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHTML;
    }
}

// Format datetime to UTC+7
function formatDateTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' });
}

// Confirm Modal Functions
function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmActionBtn').onclick = () => {
        closeConfirmModal();
        onConfirm();
    };
    document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
}

async function deleteUser(userId) {
    const deleteBtn = document.querySelector(`button[onclick*="deleteUser('${userId}')"]`);
    const originalHTML = deleteBtn.innerHTML;
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<div class="loader"></div>';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'deleteUser', 
                payload: { userId } 
            })
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('✅ Đã xóa user thành công!', 'success');
            await Promise.all([refreshData('users'), refreshData('subscriptions')]);
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = originalHTML;
    }
}

async function deleteSubscription(subId) {
    const deleteBtn = document.querySelector(`button[onclick*="deleteSubscription(${subId})"]`);
    const originalHTML = deleteBtn.innerHTML;
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<div class="loader"></div>';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'deleteSubscription', 
                payload: { subscriptionId: subId } 
            })
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('✅ Đã xóa subscription!', 'success');
            await Promise.all([refreshData('subscriptions'), refreshData('users')]);
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = originalHTML;
    }
}

// Search functionality
document.addEventListener('DOMContentLoaded', function() {
    // Add search event listeners
    const searchInputs = ['usersSearch', 'subscriptionsSearch', 'ordersSearch', 'transactionsSearch', 'logsSearch'];
    const filters = ['subscriptionsFilter', 'ordersFilter', 'logsFilter', 'amountFilter'];
    
    searchInputs.forEach(inputId => {
        const element = document.getElementById(inputId);
        if (element) {
            element.addEventListener('input', debounce(() => {
                const tabName = inputId.replace('Search', '');
                renderTable(tabName);
            }, 300));
        }
    });
    
    filters.forEach(filterId => {
        const element = document.getElementById(filterId);
        if (element) {
            element.addEventListener('change', () => {
                let tabName = filterId.replace('Filter', '');
                if (filterId === 'amountFilter') tabName = 'transactions';
                renderTable(tabName);
            });
        }
    });

    // Login on Enter key
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') login();
        });
    }
});

// Utility function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== PAYMENT SETTINGS FUNCTIONS =====
async function loadPaymentSettings() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getPaymentSettings' })
        });
        const data = await response.json();
        
        if (data.success && data.settings) {
            allData.paymentSettings = data.settings;
            
            // Find active payment method
            const activeSetting = data.settings.find(s => s.is_active === 1);
            if (activeSetting) {
                currentPaymentMethod = activeSetting.payment_method;
                updatePaymentUI(activeSetting.payment_method);
                
                // Load settings into forms
                data.settings.forEach(setting => {
                    if (setting.payment_method === 'sepay' && setting.sepay_account_number) {
                        document.getElementById('sepayAccountNumber').value = setting.sepay_account_number || '';
                        document.getElementById('sepayApiToken').value = setting.sepay_api_token || '';
                    } else if (setting.payment_method === 'momo' && setting.momo_partner_code) {
                        document.getElementById('momoPartnerCode').value = setting.momo_partner_code || '';
                        document.getElementById('momoAccessKey').value = setting.momo_access_key || '';
                        document.getElementById('momoSecretKey').value = setting.momo_secret_key || '';
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error loading payment settings:', error);
        showToast('Lỗi tải cài đặt thanh toán', 'error');
    }
}

function updatePaymentUI(method) {
    // Update button states
    document.getElementById('selectSepay').classList.toggle('active', method === 'sepay');
    document.getElementById('selectMomo').classList.toggle('active', method === 'momo');
    
    // Show/hide settings panels
    document.getElementById('sepaySettings').classList.toggle('hidden', method !== 'sepay');
    document.getElementById('momoSettings').classList.toggle('hidden', method !== 'momo');
}

async function setPaymentMethod(method) {
    if (method === currentPaymentMethod) {
        // Already selected, just show settings
        updatePaymentUI(method);
        return;
    }
    
    if (!confirm(`Bạn có chắc muốn chuyển sang phương thức thanh toán ${method.toUpperCase()}?`)) {
        return;
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'setActivePaymentMethod', 
                payload: { paymentMethod: method } 
            })
        });
        const data = await response.json();
        
        if (data.success) {
            currentPaymentMethod = method;
            updatePaymentUI(method);
            showToast(`✅ Đã chuyển sang ${method.toUpperCase()}!`, 'success');
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}

async function saveSepaySettings() {
    const accountNumber = document.getElementById('sepayAccountNumber').value.trim();
    const apiToken = document.getElementById('sepayApiToken').value.trim();
    
    if (!accountNumber || !apiToken) {
        showToast('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'updatePaymentSettings',
                payload: {
                    paymentMethod: 'sepay',
                    config: { accountNumber, apiToken }
                }
            })
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('✅ Đã lưu cấu hình SePay!', 'success');
            await loadPaymentSettings();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}

async function saveMomoSettings() {
    const partnerCode = document.getElementById('momoPartnerCode').value.trim();
    const accessKey = document.getElementById('momoAccessKey').value.trim();
    const secretKey = document.getElementById('momoSecretKey').value.trim();
    
    if (!partnerCode || !accessKey || !secretKey) {
        showToast('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'updatePaymentSettings',
                payload: {
                    paymentMethod: 'momo',
                    config: { partnerCode, accessKey, secretKey }
                }
            })
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('✅ Đã lưu cấu hình MoMo!', 'success');
            await loadPaymentSettings();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}
