const API_URL = '/api/admin-handler';
let currentUser = null;
let allData = {
    users: [],
    subscriptions: [],
    orders: [],
    transactions: [],
    logs: [],
    vipPlans: []
};

// Pagination state
let pagination = {
    users: { currentPage: 1, rowsPerPage: 20 },
    vipPlans: { currentPage: 1, rowsPerPage: 20 },
    subscriptions: { currentPage: 1, rowsPerPage: 20 },
    orders: { currentPage: 1, rowsPerPage: 20 },
    transactions: { currentPage: 1, rowsPerPage: 20 },
    logs: { currentPage: 1, rowsPerPage: 20 }
};

// Dashboard chart instances
let charts = {
    revenue: null,
    userGrowth: null,
    vipDistribution: null,
    orderStatus: null
};

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
            
            // Save session to localStorage
            localStorage.setItem('adminSession', JSON.stringify({
                username: currentUser.username,
                password: password, // Store hashed password for auto-login
                loginTime: new Date().getTime()
            }));
            
            document.getElementById('adminUsername').textContent = currentUser.username;
            showToast('Đăng nhập thành công!', 'success');
            
            // Direct transition
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            
            await refreshData('dashboard');
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

// Auto-login on page load
async function autoLogin() {
    const session = localStorage.getItem('adminSession');
    if (!session) return false;
    
    try {
        const { username, password, loginTime } = JSON.parse(session);
        
        // Session expires after 24 hours
        const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
        if (new Date().getTime() - loginTime > SESSION_DURATION) {
            localStorage.removeItem('adminSession');
            return false;
        }
        
        // Try to login with saved credentials
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', payload: { username, password } })
        });

        const data = await response.json();
        
        if (data.success) {
            currentUser = data.admin;
            document.getElementById('adminUsername').textContent = currentUser.username;
            
            // Update login time
            localStorage.setItem('adminSession', JSON.stringify({
                username,
                password,
                loginTime: new Date().getTime()
            }));
            
            // Show dashboard
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('adminDashboard').classList.remove('hidden');
            
            await refreshData('dashboard');
            return true;
        } else {
            localStorage.removeItem('adminSession');
            return false;
        }
    } catch (error) {
        console.error('Auto-login failed:', error);
        localStorage.removeItem('adminSession');
        return false;
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

// Pagination helper functions
function paginateArray(array, page, rowsPerPage) {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    return array.slice(start, end);
}

function getTotalPages(totalItems, rowsPerPage) {
    return Math.ceil(totalItems / rowsPerPage);
}

function changePage(type, page) {
    pagination[type].currentPage = page;
    renderTable(type);
}

function renderPaginationControls(type, totalItems) {
    const container = document.getElementById(`${type}Pagination`);
    if (!container) return;
    
    const { currentPage, rowsPerPage } = pagination[type];
    const totalPages = getTotalPages(totalItems, rowsPerPage);
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    const start = (currentPage - 1) * rowsPerPage + 1;
    const end = Math.min(currentPage * rowsPerPage, totalItems);
    
    container.innerHTML = `
        <div class="flex items-center justify-between bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
            <div class="flex-1 flex justify-between sm:hidden">
                <button 
                    onclick="changePage('${type}', ${currentPage - 1})" 
                    ${currentPage === 1 ? 'disabled' : ''}
                    class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    Trước
                </button>
                <button 
                    onclick="changePage('${type}', ${currentPage + 1})" 
                    ${currentPage === totalPages ? 'disabled' : ''}
                    class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    Sau
                </button>
            </div>
            <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm text-gray-700">
                        Hiển thị <span class="font-medium">${start}</span> đến <span class="font-medium">${end}</span> trong tổng số <span class="font-medium">${totalItems}</span> kết quả
                    </p>
                </div>
                <div>
                    <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                        <button 
                            onclick="changePage('${type}', ${currentPage - 1})" 
                            ${currentPage === 1 ? 'disabled' : ''}
                            class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span class="sr-only">Trước</span>
                            ←
                        </button>
                        ${generatePageNumbers(type, currentPage, totalPages)}
                        <button 
                            onclick="changePage('${type}', ${currentPage + 1})" 
                            ${currentPage === totalPages ? 'disabled' : ''}
                            class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span class="sr-only">Sau</span>
                            →
                        </button>
                    </nav>
                </div>
            </div>
        </div>
    `;
}

function generatePageNumbers(type, currentPage, totalPages) {
    let pages = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i);
        }
    } else {
        if (currentPage <= 3) {
            pages = [1, 2, 3, 4, '...', totalPages];
        } else if (currentPage >= totalPages - 2) {
            pages = [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        } else {
            pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
        }
    }
    
    return pages.map(page => {
        if (page === '...') {
            return '<span class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">...</span>';
        }
        const isActive = page === currentPage;
        return `
            <button 
                onclick="changePage('${type}', ${page})" 
                class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium ${
                    isActive 
                        ? 'z-10 bg-blue-50 border-blue-500 text-blue-600' 
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                }">
                ${page}
            </button>
        `;
    }).join('');
}

function logout() {
    currentUser = null;
    
    // Clear session
    localStorage.removeItem('adminSession');
    
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('loginError').classList.add('hidden');
    
    showToast('Đã đăng xuất thành công', 'success');
}

// Tab functionality
function switchTab(tab) {
    // Update tab buttons (desktop)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('tab-active');
        btn.classList.add('text-gray-600');
    });
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    
    // Activate selected tab (desktop)
    const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
    if (tabBtn) {
        tabBtn.classList.add('tab-active');
        tabBtn.classList.remove('text-gray-600');
    }
    
    // Update mobile dropdown
    const mobileSelect = document.getElementById('mobileTabSelect');
    if (mobileSelect) {
        mobileSelect.value = tab;
    }
    
    // Show selected content
    document.getElementById(`${tab}Tab`).classList.remove('hidden');
    
    // Load data based on tab
    refreshData(tab);
}

// Data fetching
async function refreshData(type) {
    if (type === 'dashboard') {
        await loadDashboard();
        return;
    }
    
    // Special mapping for vipPlans action
    let action = type === 'vipPlans' ? 'getAllVIPPlans' : `getAll${type.charAt(0).toUpperCase() + type.slice(1)}`;
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
            // Map response data key
            const dataKey = type === 'vipPlans' ? 'plans' : type;
            allData[type] = data[dataKey] || [];
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
        case 'vipPlans': renderVIPPlans(); break;
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

    // Paginate the filtered results
    const { currentPage, rowsPerPage } = pagination.users;
    const paginatedUsers = paginateArray(filteredUsers, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedUsers.map(user => {
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
    
    // Render pagination controls
    renderPaginationControls('users', totalUsers);
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

    // Paginate the filtered results
    const { currentPage, rowsPerPage } = pagination.subscriptions;
    const paginatedSubs = paginateArray(filteredSubs, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedSubs.map(sub => {
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
    
    // Render pagination controls
    renderPaginationControls('subscriptions', filteredSubs.length);
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

    // Paginate the filtered results
    const { currentPage, rowsPerPage } = pagination.orders;
    const paginatedOrders = paginateArray(filteredOrders, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedOrders.map(order => `
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
    
    // Render pagination controls
    renderPaginationControls('orders', filteredOrders.length);
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

    // Paginate the filtered results
    const { currentPage, rowsPerPage } = pagination.transactions;
    const paginatedTrans = paginateArray(filteredTrans, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedTrans.map(trans => `
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
    
    // Render pagination controls
    renderPaginationControls('transactions', filteredTrans.length);
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

    // Paginate the filtered results
    const { currentPage, rowsPerPage } = pagination.logs;
    const paginatedLogs = paginateArray(filteredLogs, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedLogs.map(log => `
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
    
    // Render pagination controls
    renderPaginationControls('logs', filteredLogs.length);
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
async function openAddVIPModal(userId = '') {
    document.getElementById('vipUserId').value = userId;
    
    // Load VIP plans from database and populate dropdown
    await loadVIPPlansForModal();
    
    document.getElementById('addVIPModal').classList.remove('hidden');
}

// Load VIP plans dynamically for the modal (100% from database)
// Admin can add any plan (active or inactive), is_active only affects user purchases
async function loadVIPPlansForModal() {
    const selectElement = document.getElementById('vipPlanType');
    
    try {
        // Show loading state
        selectElement.innerHTML = '<option value="">Đang tải gói VIP...</option>';
        selectElement.disabled = true;
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getAllVIPPlans' })
        });

        const data = await response.json();
        
        if (data.success && data.plans) {
            // Clear loading state
            selectElement.innerHTML = '';
            
            // Sort plans by sort_order (Admin can see ALL plans, not just active ones)
            const sortedPlans = data.plans
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            
            // Check if we have any plans at all
            if (sortedPlans.length === 0) {
                selectElement.innerHTML = '<option value="">Chưa có gói VIP nào trong hệ thống</option>';
                showToast('Chưa có gói VIP nào. Vui lòng tạo gói VIP trong tab VIP Plans', 'warning');
                return;
            }
            
            // Add ALL plans from database (100% from database, no hardcoded options)
            // Admin can add any plan regardless of is_active status
            sortedPlans.forEach(plan => {
                const option = document.createElement('option');
                option.value = plan.plan_key;
                
                // Format: "Plan Name (X days) - Price"
                const daysText = plan.duration_days === 36500 
                    ? 'Vĩnh viễn' 
                    : `${plan.duration_days} ngày`;
                
                // Show status with emoji only (no text)
                const statusIcon = plan.is_active === 1 ? '✅' : '🔴';
                    
                option.textContent = `${statusIcon} ${plan.plan_name} (${daysText}) - ${parseFloat(plan.price).toLocaleString('vi-VN')}đ`;
                
                // Store metadata for potential use
                option.setAttribute('data-duration', plan.duration_days);
                option.setAttribute('data-price', plan.price);
                option.setAttribute('data-active', plan.is_active);
                
                selectElement.appendChild(option);
            });
            
            selectElement.disabled = false;
        } else {
            selectElement.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
            showToast('Không thể tải danh sách gói VIP từ database', 'error');
        }
    } catch (error) {
        console.error('Error loading VIP plans:', error);
        selectElement.innerHTML = '<option value="">Lỗi kết nối</option>';
        showToast('Lỗi kết nối đến server', 'error');
    }
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
document.addEventListener('DOMContentLoaded', async function() {
    // Try auto-login first
    const loginSuccess = await autoLogin();
    
    if (!loginSuccess) {
        // Show login screen if auto-login failed
        document.getElementById('loginScreen').classList.remove('hidden');
    }
    
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

// ===== DASHBOARD FUNCTIONS =====
async function loadDashboard() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getDashboardStats' })
        });

        const data = await response.json();
        
        if (data.success) {
            const stats = data.stats;
            
            // Update KPI cards
            document.getElementById('totalUsers').textContent = stats.totalUsers;
            document.getElementById('vipUsers').textContent = stats.vipUsers;
            document.getElementById('totalRevenue').textContent = formatCurrency(stats.totalRevenue);
            document.getElementById('totalOrders').textContent = stats.orders.total;
            
            // Render charts
            renderRevenueChart(stats.revenueByDate);
            renderUserGrowthChart(stats.userGrowth);
            renderVipDistributionChart(stats.vipDistribution);
            renderOrderStatusChart(stats.orders);
            
            // Render recent activities
            renderRecentActivities(stats.recentActivities);
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Lỗi khi tải dashboard!', 'error');
    }
}

// Revenue Chart
function renderRevenueChart(data) {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    
    if (charts.revenue) charts.revenue.destroy();
    
    charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => new Date(d.date).toLocaleDateString('vi-VN')),
            datasets: [{
                label: 'Doanh thu (VNĐ)',
                data: data.map(d => d.revenue),
                borderColor: 'rgb(147, 51, 234)',
                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('vi-VN') + 'đ';
                        }
                    }
                }
            }
        }
    });
}

// User Growth Chart
function renderUserGrowthChart(data) {
    const ctx = document.getElementById('userGrowthChart').getContext('2d');
    
    if (charts.userGrowth) charts.userGrowth.destroy();
    
    charts.userGrowth = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => new Date(d.date).toLocaleDateString('vi-VN')),
            datasets: [{
                label: 'Người dùng mới',
                data: data.map(d => d.count),
                backgroundColor: 'rgb(59, 130, 246)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// VIP Distribution Chart
function renderVipDistributionChart(data) {
    const ctx = document.getElementById('vipDistributionChart').getContext('2d');
    
    if (charts.vipDistribution) charts.vipDistribution.destroy();
    
    const planNames = {
        '1day': '1 ngày',
        '3days': '3 ngày',
        '7days': '7 ngày',
        '30days': '30 ngày',
        'infinite': 'Vĩnh viễn'
    };
    
    charts.vipDistribution = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: data.map(d => planNames[d.plan_type] || d.plan_type),
            datasets: [{
                data: data.map(d => d.count),
                backgroundColor: [
                    'rgb(59, 130, 246)',
                    'rgb(16, 185, 129)',
                    'rgb(251, 146, 60)',
                    'rgb(147, 51, 234)',
                    'rgb(236, 72, 153)'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

// Order Status Chart
function renderOrderStatusChart(orders) {
    const ctx = document.getElementById('orderStatusChart').getContext('2d');
    
    if (charts.orderStatus) charts.orderStatus.destroy();
    
    charts.orderStatus = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Đã thanh toán', 'Chưa thanh toán', 'Đã hủy'],
            datasets: [{
                data: [orders.paid, orders.unpaid, orders.cancelled],
                backgroundColor: [
                    'rgb(16, 185, 129)',
                    'rgb(251, 146, 60)',
                    'rgb(239, 68, 68)'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

// Recent Activities
function renderRecentActivities(activities) {
    const html = activities.map(activity => `
        <div class="border-b border-gray-200 py-3">
            <div class="flex justify-between items-start">
                <div>
                    <span class="font-semibold text-gray-800">${activity.user_id}</span>
                    <span class="text-gray-600 ml-2">${activity.action}</span>
                    ${activity.details ? `<p class="text-sm text-gray-500 mt-1">${activity.details}</p>` : ''}
                </div>
                <span class="text-xs text-gray-400">${new Date(activity.created_at).toLocaleString('vi-VN')}</span>
            </div>
        </div>
    `).join('');
    
    document.getElementById('recentActivitiesList').innerHTML = html || '<p class="text-gray-500 text-center py-4">Chưa có hoạt động nào</p>';
}

// Helper: Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND'
    }).format(amount);
}

// ===== VIP PLANS MANAGEMENT =====

function renderVIPPlans() {
    const tbody = document.getElementById('vipPlansTableBody');
    
    const { currentPage, rowsPerPage } = pagination.vipPlans;
    const paginatedPlans = paginateArray(allData.vipPlans, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedPlans.map(plan => `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-medium" data-label="ID">${plan.id}</td>
            <td class="px-6 py-4 font-mono text-sm" data-label="Key">${plan.plan_key}</td>
            <td class="px-6 py-4 font-semibold" data-label="Tên">${plan.plan_name}</td>
            <td class="px-6 py-4 text-center" data-label="Thời hạn">${plan.duration_days} ngày</td>
            <td class="px-6 py-4 font-semibold text-green-600" data-label="Giá">${parseFloat(plan.price).toLocaleString('vi-VN')}đ</td>
            <td class="px-6 py-4" data-label="Trạng thái">
                <span class="px-2 py-1 rounded-full text-xs font-medium ${plan.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${plan.is_active ? '✅ Active' : '❌ Disabled'}
                </span>
            </td>
            <td class="px-6 py-4 text-center" data-label="Thứ tự">${plan.sort_order}</td>
            <td class="px-6 py-4 flex gap-2 flex-wrap" data-label="Actions">
                <button onclick="openEditPlanModal(${plan.id})" class="text-blue-600 hover:text-blue-900 font-medium text-sm">
                    ✏️ Sửa
                </button>
                <button onclick="togglePlanStatus(${plan.id})" class="text-${plan.is_active ? 'orange' : 'green'}-600 hover:text-${plan.is_active ? 'orange' : 'green'}-900 font-medium text-sm">
                    ${plan.is_active ? '⏸️ Tắt' : '▶️ Bật'}
                </button>
                <button onclick="showConfirmModal('Xóa gói VIP', 'Bạn có chắc muốn xóa gói ${plan.plan_name}? Hành động này không thể hoàn tác.', () => deletePlan(${plan.id}))" class="text-red-600 hover:text-red-900 font-medium text-sm">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
    `).join('');
    
    renderPaginationControls('vipPlans', allData.vipPlans.length);
}

// Create Plan Modal
function openCreatePlanModal() {
    document.getElementById('planModalTitle').textContent = '➕ Thêm gói VIP mới';
    document.getElementById('planId').value = '';
    document.getElementById('planKey').value = '';
    document.getElementById('planKey').disabled = false;
    document.getElementById('planName').value = '';
    document.getElementById('planDuration').value = '';
    document.getElementById('planPrice').value = '';
    document.getElementById('planSortOrder').value = '0';
    document.getElementById('planDescription').value = '';
    document.getElementById('planModal').classList.remove('hidden');
}

// Edit Plan Modal
function openEditPlanModal(id) {
    const plan = allData.vipPlans.find(p => p.id === id);
    if (!plan) return;
    
    document.getElementById('planModalTitle').textContent = '✏️ Chỉnh sửa gói VIP';
    document.getElementById('planId').value = plan.id;
    document.getElementById('planKey').value = plan.plan_key;
    document.getElementById('planKey').disabled = true; // Không cho sửa plan_key
    document.getElementById('planName').value = plan.plan_name;
    document.getElementById('planDuration').value = plan.duration_days;
    document.getElementById('planPrice').value = plan.price;
    document.getElementById('planSortOrder').value = plan.sort_order;
    document.getElementById('planDescription').value = plan.description || '';
    document.getElementById('planModal').classList.remove('hidden');
}

function closePlanModal() {
    document.getElementById('planModal').classList.add('hidden');
}

// Submit Plan (Create or Update)
async function submitPlan() {
    const id = document.getElementById('planId').value;
    const planKey = document.getElementById('planKey').value.trim();
    const planName = document.getElementById('planName').value.trim();
    const durationDays = parseInt(document.getElementById('planDuration').value);
    const price = parseFloat(document.getElementById('planPrice').value);
    const sortOrder = parseInt(document.getElementById('planSortOrder').value) || 0;
    const description = document.getElementById('planDescription').value.trim();
    
    // Validation
    if (!planKey || !planName || !durationDays || !price) {
        showToast('Vui lòng điền đầy đủ các trường bắt buộc!', 'error');
        return;
    }
    
    if (!/^[a-z0-9_]+$/.test(planKey)) {
        showToast('Plan Key chỉ được chứa chữ thường, số và gạch dưới!', 'error');
        return;
    }
    
    const btn = document.getElementById('submitPlanBtn');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="loader inline-block"></div> Đang lưu...';
    
    try {
        const action = id ? 'updateVIPPlan' : 'createVIPPlan';
        const payload = { planKey, planName, durationDays, price, sortOrder, description };
        if (id) payload.id = parseInt(id);
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, payload })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message || (id ? 'Cập nhật thành công!' : 'Tạo gói VIP thành công!'), 'success');
            closePlanModal();
            await refreshData('vipPlans');
        } else {
            showToast(data.message || 'Có lỗi xảy ra!', 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

// Delete Plan
async function deletePlan(id) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteVIPPlan', payload: { id } })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Xóa gói VIP thành công!', 'success');
            await refreshData('vipPlans');
        } else {
            showToast(data.message || 'Không thể xóa gói VIP!', 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}

// Toggle Plan Status
async function togglePlanStatus(id) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'toggleVIPPlanStatus', payload: { id } })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message || 'Cập nhật trạng thái thành công!', 'success');
            await refreshData('vipPlans');
        } else {
            showToast(data.message || 'Có lỗi xảy ra!', 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}
