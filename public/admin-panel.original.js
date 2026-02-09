const API_URL = '/api/admin-handler';
let currentUser = null;
let allData = {
    users: [],
    subscriptions: [],
    orders: [],
    transactions: [],
    logs: [],
    vipPlans: [],
    userActivity: { logs: [], userSummary: [], actionStats: [], activeNow: [], total: 0, page: 1, totalPages: 1 }
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

// Disable Chart.js animations globally for better performance
if (typeof Chart !== 'undefined') {
    Chart.defaults.animation = false;
    Chart.defaults.animations = { colors: false, x: false };
    Chart.defaults.transitions = { active: { animation: { duration: 0 } } };
    Chart.defaults.hover.animationDuration = 0;
    Chart.defaults.plugins.tooltip.animation = false;
}

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
    toast.className = `fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${type === 'success' ? 'bg-green-500 text-white' :
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
                class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium ${isActive
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

// Helper function to filter and highlight an order by ID
function filterOrderById(orderId) {
    // Switch to orders tab
    switchTab('orders');

    // Wait for tab to load, then filter
    setTimeout(() => {
        const ordersSearch = document.getElementById('ordersSearch');
        if (ordersSearch) {
            // Clear filter and search for the order ID
            document.getElementById('ordersFilter').value = '';
            ordersSearch.value = `#${orderId}`;
            renderOrders();

            // Scroll to the orders section
            document.getElementById('ordersTab').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 300);
}

// Helper function to filter and highlight an order by order code
function filterOrderByCode(orderCode) {
    // Switch to orders tab
    switchTab('orders');

    // Wait for tab to load, then filter
    setTimeout(() => {
        const ordersSearch = document.getElementById('ordersSearch');
        if (ordersSearch) {
            // Clear filter and search for the order code
            document.getElementById('ordersFilter').value = '';
            ordersSearch.value = orderCode;
            renderOrders();

            // Scroll to the orders section
            document.getElementById('ordersTab').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 300);
}

// Data fetching
async function refreshData(type) {
    if (type === 'dashboard') {
        await loadDashboard();
        return;
    }
    
    if (type === 'userActivity') {
        await refreshUserActivity();
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
    switch (type) {
        case 'users': renderUsers(); break;
        case 'vipPlans': renderVIPPlans(); break;
        case 'subscriptions': renderSubscriptions(); break;
        case 'orders': renderOrders(); break;
        case 'transactions': renderTransactions(); break;
        case 'logs': renderLogs(); break;
        case 'userActivity': renderUserActivityData(); break;
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
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${user.id || ''}</td>
            <td class="px-6 py-4" data-label="User Info">
                <div class="font-semibold text-gray-900">${user.user_id}</div>
                ${user.username ? `<div class="text-xs text-gray-500 font-mono mt-0.5">@${user.username}</div>` : ''}
                ${user.full_name ? `<div class="text-sm text-gray-600 mt-0.5">${user.full_name}</div>` : ''}
                ${user.email ? `<div class="text-sm text-gray-500 mt-0.5">📧 ${user.email}</div>` : ''}
            </td>
            <td class="px-6 py-4" data-label="Active">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                    ${user.is_active ? '✅ Active' : '❌ Inactive'}
                </span>
            </td>
            <td class="px-6 py-4" data-label="VIP Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${isVip && !isExpired ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                    ${isVip && !isExpired ? '✅ VIP Active' : '❌ No VIP'}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Expiry">
                ${expiryDate ? `
                    <div class="${isExpired ? 'text-red-600' : 'text-green-600'} font-semibold text-sm">
                        ${formatDateTime(expiryDate)}
                    </div>
                ` : '<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Last Login">
                ${user.last_login ? formatDateTime(user.last_login) : '<span class="text-gray-400">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${user.created_at ? formatDateTime(user.created_at) : 'N/A'}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${user.updated_at ? formatDateTime(user.updated_at) : 'N/A'}</td>
            <td class="px-6 py-4 flex gap-2" data-label="Actions">
                <button onclick="openAddVIPModal('${user.user_id}')" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    ➕ Thêm VIP
                </button>
                <button onclick="showConfirmModal('Xóa User', 'Bạn có chắc muốn xóa user này không? Mọi dữ liệu liên quan sẽ bị xóa.', () => deleteUser('${user.user_id}'))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
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
        const source = sub.created_by_admin
            ? `👨‍💼 Admin (${sub.created_by_admin})`
            : `👤 User`;

        // Show order code if user purchased, or "Admin" if admin added
        const orderDisplay = sub.order_code
            ? `<a href="#orders" onclick="filterOrderByCode('${sub.order_code}')" class="text-blue-600 hover:text-blue-800 font-semibold font-mono text-sm transition">${sub.order_code}</a>`
            : '<span class="text-purple-600 font-semibold text-sm">👨‍💼 Admin</span>';

        return `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${sub.id}</td>
            <td class="px-6 py-4" data-label="User">
                <div class="font-semibold text-gray-900">${sub.user_id}</div>
                ${sub.plan_name ? `<div class="text-sm text-gray-600 mt-0.5">${sub.plan_name}</div>` : ''}
            </td>
            <td class="px-6 py-4" data-label="Plan ID">
                <span class="text-xs text-gray-500 font-mono">${sub.plan_id || 'N/A'}</span>
            </td>
            <td class="px-6 py-4" data-label="Plan">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">${sub.plan_type}</span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Source">
                ${source}
            </td>
            <td class="px-6 py-4" data-label="Order">${orderDisplay}</td>
            <td class="px-6 py-4" data-label="Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${isActive ? '✅ Active' : '❌ Expired'}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Expiry">
                <div class="${isActive ? 'text-green-600' : 'text-red-600'} font-semibold text-sm">
                    ${formatDateTime(sub.expiry_date)}
                </div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${formatDateTime(sub.created_at)}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${sub.updated_at ? formatDateTime(sub.updated_at) : 'N/A'}</td>
            <td class="px-6 py-4" data-label="Actions">
                <button onclick="showConfirmModal('Xóa VIP Subscription', 'Bạn có chắc muốn xóa subscription này không?', () => deleteSubscription(${sub.id}))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
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
            order.plan_name.toLowerCase().includes(searchTerm) ||
            (order.order_code && order.order_code.toLowerCase().includes(searchTerm));
        const matchesStatus = !statusFilter || order.payment_status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // Paginate the filtered results
    const { currentPage, rowsPerPage } = pagination.orders;
    const paginatedOrders = paginateArray(filteredOrders, currentPage, rowsPerPage);

    tbody.innerHTML = paginatedOrders.map(order => {
        const isCancelled = order.cancelled_at !== null && order.cancelled_at !== undefined;
        const isPaid = order.payment_status === 'Paid';

        return `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${order.id}</td>
            <td class="px-6 py-4" data-label="Order Code">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-mono font-bold">${order.order_code || 'N/A'}</span>
            </td>
            <td class="px-6 py-4" data-label="User">
                <div class="font-semibold text-gray-900">${order.user_id}</div>
            </td>
            <td class="px-6 py-4" data-label="Plan">
                <div>
                    <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">${order.plan_name}</span>
                    ${order.plan_type ? `<div class="text-xs text-gray-500 mt-1">📋 ${order.plan_type}</div>` : ''}
                    ${order.gateway ? `<div class="text-sm text-gray-600 mt-1">💳 ${order.gateway}</div>` : ''}
                </div>
            </td>
            <td class="px-6 py-4 font-bold text-green-600 text-sm" data-label="Amount">${parseFloat(order.amount).toLocaleString('vi-VN')}đ</td>
            <td class="px-6 py-4" data-label="Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${isCancelled ? 'bg-red-100 text-red-800' :
                isPaid ? 'bg-green-100 text-green-800' :
                    'bg-yellow-100 text-yellow-800'
            }">
                    ${isCancelled ? '❌ Cancelled' : isPaid ? '✅ Paid' : '⏳ Unpaid'}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Transaction Ref">
                <span class="text-xs font-mono text-gray-600">${order.transaction_ref || 'N/A'}</span>
            </td>
            <td class="px-6 py-4" data-label="Paid At">
                ${order.paid_at ? `<div class="text-green-600 font-semibold text-sm">${formatDateTime(order.paid_at)}</div>` : '<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4" data-label="Cancelled At">
                ${order.cancelled_at ? `<div class="text-red-600 font-semibold text-sm">${formatDateTime(order.cancelled_at)}</div>` : '<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${formatDateTime(order.created_at)}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${order.updated_at ? formatDateTime(order.updated_at) : 'N/A'}</td>
        </tr>
    `}).join('');

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

    tbody.innerHTML = paginatedTrans.map(trans => {
        const orderLink = trans.order_code
            ? `<a href="#orders" onclick="filterOrderByCode('${trans.order_code}')" class="text-blue-600 hover:text-blue-800 font-semibold font-mono text-sm transition">${trans.order_code}</a>`
            : '<span class="text-gray-400 text-sm">N/A</span>';

        return `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${trans.id}</td>
            <td class="px-6 py-4" data-label="Order">${orderLink}</td>
            <td class="px-6 py-4" data-label="Gateway">
                <span class="px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs font-semibold">💳 ${trans.gateway}</span>
            </td>
            <td class="px-6 py-4" data-label="Account">
                <div class="text-sm text-gray-700">${trans.account_number || 'N/A'}</div>
                ${trans.sub_account ? `<div class="text-xs text-gray-500 mt-0.5">Sub: ${trans.sub_account}</div>` : ''}
            </td>
            <td class="px-6 py-4 font-bold text-green-600" data-label="Amount In">
                <div class="text-base">${parseFloat(trans.amount_in).toLocaleString('vi-VN')}đ</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Amount Out">
                ${trans.amount_out ? `${parseFloat(trans.amount_out).toLocaleString('vi-VN')}đ` : '0đ'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Accumulated">
                ${trans.accumulated ? `${parseFloat(trans.accumulated).toLocaleString('vi-VN')}đ` : 'N/A'}
            </td>
            <td class="px-6 py-4" data-label="Code">
                <span class="text-xs font-mono text-gray-600">${trans.code || 'N/A'}</span>
            </td>
            <td class="px-6 py-4" data-label="Content">
                <div class="max-w-xs truncate text-sm text-gray-700" title="${trans.transaction_content || 'N/A'}">${trans.transaction_content || 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-xs font-mono bg-gray-50 text-gray-600" data-label="Reference">${trans.reference_number || 'N/A'}</td>
            <td class="px-6 py-4" data-label="Body">
                <div class="max-w-xs truncate text-xs text-gray-500" title="${trans.body || 'N/A'}">${trans.body || 'N/A'}</div>
            </td>
            <td class="px-6 py-4" data-label="Txn Date">
                <div class="text-sm text-gray-600">${trans.transaction_date ? formatDateTime(trans.transaction_date) : 'N/A'}</div>
            </td>
            <td class="px-6 py-4" data-label="Received">
                <div class="text-sm text-gray-600">${formatDateTime(trans.received_at)}</div>
            </td>
        </tr>
    `}).join('');

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
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${log.id}</td>
            <td class="px-6 py-4" data-label="User">
                <div class="font-semibold text-gray-900">${log.user_id || 'System'}</div>
                ${log.admin_id ? `<div class="text-sm text-purple-600 mt-0.5">👨‍💼 Admin: ${log.admin_id}</div>` : ''}
            </td>
            <td class="px-6 py-4" data-label="Action">
                <span class="px-2 py-1 rounded text-xs font-semibold ${getActionColor(log.action)}">
                    ${getActionText(log.action)}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Details">
                <div class="max-w-md truncate text-sm text-gray-700" title="${log.details || 'N/A'}">${log.details || 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="IP">${log.ip_address || 'N/A'}</td>
            <td class="px-6 py-4" data-label="User Agent">
                <div class="max-w-xs truncate text-xs text-gray-500" title="${log.user_agent || 'N/A'}">${log.user_agent || 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Date">${log.created_date || ''}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Time">${formatDateTime(log.created_at)}</td>
        </tr>
    `).join('');

    // Render pagination controls
    renderPaginationControls('logs', filteredLogs.length);
}

function getActionColor(action) {
    switch (action) {
        case 'USER_LOGIN': return 'bg-blue-100 text-blue-800';
        case 'VIP_PURCHASE': return 'bg-green-100 text-green-800';
        case 'ADMIN_ADD_VIP': return 'bg-purple-100 text-purple-800';
        case 'ADMIN_DELETE_VIP': return 'bg-red-100 text-red-800';
        case 'ADMIN_DELETE_USER': return 'bg-red-100 text-red-800';
        case 'ADMIN_CREATE_PLAN': return 'bg-purple-100 text-purple-800';
        case 'ADMIN_UPDATE_PLAN': return 'bg-purple-100 text-purple-800';
        case 'ADMIN_DELETE_PLAN': return 'bg-red-100 text-red-800';
        case 'ADMIN_TOGGLE_PLAN': return 'bg-purple-100 text-purple-800';
        case 'ORDER_CREATED': return 'bg-blue-100 text-blue-800';
        case 'ORDER_PAID': return 'bg-green-100 text-green-800';
        case 'ORDER_CANCELLED': return 'bg-red-100 text-red-800';
        case 'ORDER_AUTO_CANCELLED': return 'bg-orange-100 text-orange-800';
        case 'CREATE_VIP_ORDER': return 'bg-yellow-100 text-yellow-800';
        case 'VIP_ACTIVATED': return 'bg-green-100 text-green-800';
        case 'VIP_EXTENDED': return 'bg-blue-100 text-blue-800';
        case 'VIP_EXPIRED': return 'bg-yellow-100 text-yellow-800';
        case 'PAYMENT_RECEIVED': return 'bg-green-100 text-green-800';
        case 'WEBHOOK_PROCESSED': return 'bg-indigo-100 text-indigo-800';
        // New user action types
        case 'FETCH_SCHEDULE': return 'bg-cyan-100 text-cyan-800';
        case 'FETCH_SCHEDULE_DONE': return 'bg-cyan-100 text-cyan-800';
        case 'FETCH_REGISTERED': return 'bg-teal-100 text-teal-800';
        case 'REGISTER_CLASS': return 'bg-indigo-100 text-indigo-800';
        case 'REGISTER_SUCCESS': return 'bg-green-100 text-green-800';
        case 'REGISTER_FAILED': return 'bg-red-100 text-red-800';
        case 'CANCEL_CLASS': return 'bg-orange-100 text-orange-800';
        case 'CANCEL_SUCCESS': return 'bg-green-100 text-green-800';
        case 'CANCEL_FAILED': return 'bg-red-100 text-red-800';
        case 'CHECK_AVAILABILITY': return 'bg-yellow-100 text-yellow-800';
        case 'SYNC_DATA': return 'bg-indigo-100 text-indigo-800';
        case 'SYNC_DATA_DONE': return 'bg-indigo-100 text-indigo-800';
        case 'START_AUTO_REGISTER': return 'bg-emerald-100 text-emerald-800';
        case 'STOP_AUTO_REGISTER': return 'bg-gray-100 text-gray-800';
        case 'START_AUTO_INSERT': return 'bg-emerald-100 text-emerald-800';
        case 'STOP_AUTO_INSERT': return 'bg-gray-100 text-gray-800';
        case 'SELECT_CLASS': return 'bg-sky-100 text-sky-800';
        case 'DESELECT_CLASS': return 'bg-gray-100 text-gray-800';
        case 'VIEW_TIMETABLE': return 'bg-blue-100 text-blue-800';
        case 'EXPORT_TIMETABLE': return 'bg-blue-100 text-blue-800';
        case 'CHECK_VIP_STATUS': return 'bg-yellow-100 text-yellow-800';
        case 'OPEN_VIP_MODAL': return 'bg-yellow-100 text-yellow-800';
        case 'SWAP_CLASS': return 'bg-purple-100 text-purple-800';
        case 'SWAP_CLASS_SETUP': return 'bg-purple-100 text-purple-800';
        case 'SWAP_FROM_REGISTERED': return 'bg-purple-100 text-purple-800';
        case 'SELECT_FROM_SWAP_MODAL': return 'bg-sky-100 text-sky-800';
        case 'OPEN_SWAP_MODAL': return 'bg-purple-100 text-purple-800';
        case 'REMOVE_SELECTED': return 'bg-orange-100 text-orange-800';
        case 'REMOVE_SWAP': return 'bg-orange-100 text-orange-800';
        case 'LOGIN_SUCCESS': return 'bg-blue-100 text-blue-800';
        case 'AUTO_LOGIN': return 'bg-blue-100 text-blue-800';
        case 'LOGOUT': return 'bg-gray-100 text-gray-800';
        case 'FETCH_SCHEDULE_BTN': return 'bg-cyan-100 text-cyan-800';
        case 'REFRESH_REGISTERED': return 'bg-teal-100 text-teal-800';
        case 'OPEN_GUIDE': return 'bg-indigo-100 text-indigo-800';
        case 'BUY_VIP_PLAN': return 'bg-yellow-100 text-yellow-800';
        case 'CANCEL_PAYMENT': return 'bg-red-100 text-red-800';
        case 'CANCEL_CLASS_CONFIRM': return 'bg-orange-100 text-orange-800';
        case 'SEARCH_SCHEDULE': return 'bg-gray-100 text-gray-800';
        case 'FILTER_SUBJECT': return 'bg-gray-100 text-gray-800';
        case 'PAGE_LOAD': return 'bg-gray-100 text-gray-800';
        case 'PAGE_UNLOAD': return 'bg-gray-100 text-gray-800';
        case 'USER_ACTION': return 'bg-gray-100 text-gray-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}

function getActionText(action) {
    switch (action) {
        case 'USER_LOGIN': return '🔐 Đăng nhập';
        case 'VIP_PURCHASE': return '💳 Mua VIP';
        case 'ADMIN_ADD_VIP': return '⭐ Admin thêm VIP';
        case 'ADMIN_DELETE_VIP': return '🗑️ Admin xóa VIP';
        case 'ADMIN_DELETE_USER': return '🗑️ Admin xóa User';
        case 'ADMIN_CREATE_PLAN': return '➕ Admin tạo gói';
        case 'ADMIN_UPDATE_PLAN': return '✏️ Admin sửa gói';
        case 'ADMIN_DELETE_PLAN': return '🗑️ Admin xóa gói';
        case 'ADMIN_TOGGLE_PLAN': return '🔄 Admin đổi trạng thái gói';
        case 'ORDER_CREATED': return '📝 Tạo đơn hàng';
        case 'ORDER_PAID': return '💰 Thanh toán thành công';
        case 'ORDER_CANCELLED': return '❌ Hủy đơn hàng';
        case 'ORDER_AUTO_CANCELLED': return '⏰ Tự động hủy đơn';
        case 'CREATE_VIP_ORDER': return '🛒 Tạo đơn VIP';
        case 'VIP_ACTIVATED': return '✅ Kích hoạt VIP';
        case 'VIP_EXTENDED': return '🔄 Gia hạn VIP';
        case 'VIP_EXPIRED': return '⌛ VIP hết hạn';
        case 'PAYMENT_RECEIVED': return '💳 Nhận thanh toán';
        case 'WEBHOOK_PROCESSED': return '🔗 Xử lý webhook';
        // New user action types
        case 'FETCH_SCHEDULE': return '📋 Tải lịch học';
        case 'FETCH_SCHEDULE_DONE': return '✅ Tải lịch xong';
        case 'FETCH_REGISTERED': return '📑 Tải lớp đã ĐK';
        case 'REGISTER_CLASS': return '📝 Đăng ký lớp';
        case 'REGISTER_SUCCESS': return '✅ ĐK thành công';
        case 'REGISTER_FAILED': return '❌ ĐK thất bại';
        case 'CANCEL_CLASS': return '🗑️ Hủy đăng ký';
        case 'CANCEL_SUCCESS': return '✅ Hủy thành công';
        case 'CANCEL_FAILED': return '❌ Hủy thất bại';
        case 'CHECK_AVAILABILITY': return '🔍 Kiểm tra chỗ trống';
        case 'SYNC_DATA': return '🔄 Đồng bộ dữ liệu';
        case 'SYNC_DATA_DONE': return '✅ Đồng bộ xong';
        case 'START_AUTO_REGISTER': return '🤖 Bắt đầu tự động ĐK';
        case 'STOP_AUTO_REGISTER': return '⏹️ Dừng tự động ĐK';
        case 'START_AUTO_INSERT': return '🤖 Bắt đầu tự động chèn';
        case 'STOP_AUTO_INSERT': return '⏹️ Dừng tự động chèn';
        case 'SELECT_CLASS': return '✓ Chọn lớp';
        case 'DESELECT_CLASS': return '✗ Bỏ chọn lớp';
        case 'VIEW_TIMETABLE': return '📅 Xem thời khóa biểu';
        case 'EXPORT_TIMETABLE': return '📤 Xuất thời khóa biểu';
        case 'CHECK_VIP_STATUS': return '🔍 Kiểm tra VIP';
        case 'OPEN_VIP_MODAL': return '💎 Mở mua VIP';
        case 'SWAP_CLASS': return '🔀 Hoán đổi lớp';
        case 'SWAP_CLASS_SETUP': return '🔀 Thiết lập đổi lớp';
        case 'SWAP_FROM_REGISTERED': return '🔀 Đổi lớp từ đã ĐK';
        case 'SELECT_FROM_SWAP_MODAL': return '✅ Chọn từ modal đổi';
        case 'OPEN_SWAP_MODAL': return '🔀 Mở modal đổi lớp';
        case 'REMOVE_SELECTED': return '❌ Xóa lớp đã chọn';
        case 'REMOVE_SWAP': return '❌ Hủy đổi lớp';
        case 'LOGIN_SUCCESS': return '🔐 Đăng nhập thành công';
        case 'AUTO_LOGIN': return '🔄 Tự động đăng nhập';
        case 'LOGOUT': return '🚪 Đăng xuất';
        case 'FETCH_SCHEDULE_BTN': return '📋 Bấm tải lịch học';
        case 'REFRESH_REGISTERED': return '🔄 Làm mới lớp đã ĐK';
        case 'OPEN_GUIDE': return '📖 Mở hướng dẫn';
        case 'BUY_VIP_PLAN': return '💳 Bấm mua VIP';
        case 'CANCEL_PAYMENT': return '❌ Hủy thanh toán';
        case 'CANCEL_CLASS_CONFIRM': return '🗑️ Bấm hủy đăng ký';
        case 'SEARCH_SCHEDULE': return '🔍 Tìm kiếm lịch học';
        case 'FILTER_SUBJECT': return '📊 Lọc môn học';
        case 'PAGE_LOAD': return '🌐 Mở trang';
        case 'PAGE_UNLOAD': return '👋 Đóng trang';
        case 'USER_ACTION': return '📌 Hành động';
        default: return action ? action.replace(/_/g, ' ') : 'Unknown';
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
document.addEventListener('DOMContentLoaded', async function () {
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

// ===== USER ACTIVITY FUNCTIONS =====

/**
 * Refresh User Activity tab - loads active users and summary
 */
async function refreshUserActivity() {
    try {
        // Load initial data without filters
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getUserActivity', payload: { page: 1, limit: 50 } })
        });
        const data = await response.json();
        
        if (data.success) {
            allData.userActivity = data;
            renderUserActivityData();
        } else {
            showToast('Lỗi tải dữ liệu hoạt động: ' + (data.message || ''), 'error');
        }
    } catch (error) {
        console.error('Error refreshing user activity:', error);
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}

/**
 * Search user activity with filters
 */
async function searchUserActivity(page = 1) {
    const userId = document.getElementById('activitySearchUser').value.trim();
    const action = document.getElementById('activitySearchAction').value;
    const dateFrom = document.getElementById('activityDateFrom').value;
    const dateTo = document.getElementById('activityDateTo').value;
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'getUserActivity', 
                payload: { userId, action, dateFrom, dateTo, page, limit: 50 } 
            })
        });
        const data = await response.json();
        
        if (data.success) {
            allData.userActivity = data;
            renderUserActivityData();
            
            // Scroll to results
            document.getElementById('activityLogsTableBody').closest('.bg-white').scrollIntoView({ 
                behavior: 'smooth', block: 'start' 
            });
        } else {
            showToast('Lỗi tìm kiếm: ' + (data.message || ''), 'error');
        }
    } catch (error) {
        showToast('Lỗi kết nối: ' + error.message, 'error');
    }
}

/**
 * View a specific user's activity
 */
function viewUserActivity(userId) {
    document.getElementById('activitySearchUser').value = userId;
    document.getElementById('activitySearchAction').value = '';
    document.getElementById('activityDateFrom').value = '';
    document.getElementById('activityDateTo').value = '';
    searchUserActivity(1);
}

/**
 * Render all User Activity data
 */
function renderUserActivityData() {
    const data = allData.userActivity;
    
    // Render active users cards
    renderActiveUsersGrid(data.activeNow || []);
    
    // Render activity stats
    renderActivityStats(data.actionStats || []);
    
    // Render user summary table
    renderUserSummaryTable(data.userSummary || []);
    
    // Render activity logs
    renderActivityLogs(data.logs || [], data.total || 0, data.page || 1, data.totalPages || 1);
}

/**
 * Render active users grid cards
 */
function renderActiveUsersGrid(activeNow) {
    const container = document.getElementById('activeUsersGrid');
    
    if (!activeNow || activeNow.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4 col-span-full">Không có user nào đang hoạt động</p>';
        return;
    }
    
    container.innerHTML = activeNow.map(user => {
        const timeDiff = Math.floor((new Date() - new Date(user.last_activity)) / 1000 / 60);
        const timeText = timeDiff < 1 ? 'Vừa xong' : `${timeDiff} phút trước`;
        const isVeryActive = timeDiff < 2;
        
        return `
        <div class="border ${isVeryActive ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'} rounded-lg p-4 hover:shadow-md transition cursor-pointer" onclick="viewUserActivity('${user.user_id}')">
            <div class="flex items-center gap-3 mb-2">
                <div class="w-3 h-3 rounded-full ${isVeryActive ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}"></div>
                <div class="font-semibold text-gray-900">${user.user_id}</div>
            </div>
            ${user.full_name ? `<div class="text-sm text-gray-600 mb-1">${user.full_name}</div>` : ''}
            <div class="text-xs text-gray-500 mb-2">⏱️ ${timeText}</div>
            <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-xs font-semibold ${getActionColor(user.last_action)}">
                    ${getActionText(user.last_action)}
                </span>
            </div>
            ${user.last_details ? `<div class="text-xs text-gray-500 mt-1 truncate" title="${user.last_details}">${user.last_details}</div>` : ''}
        </div>
        `;
    }).join('');
}

/**
 * Render activity statistics cards
 */
function renderActivityStats(actionStats) {
    const container = document.getElementById('activityStatsCards');
    if (!actionStats || actionStats.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    // Calculate totals
    const total24h = actionStats.reduce((sum, s) => sum + s.count, 0);
    const loginCount = actionStats.filter(s => s.action === 'USER_LOGIN').reduce((sum, s) => sum + s.count, 0);
    const registerCount = actionStats.filter(s => ['REGISTER_CLASS', 'REGISTER_SUCCESS'].includes(s.action)).reduce((sum, s) => sum + s.count, 0);
    const autoRegCount = actionStats.filter(s => ['START_AUTO_REGISTER', 'CHECK_AVAILABILITY'].includes(s.action)).reduce((sum, s) => sum + s.count, 0);
    
    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-blue-600">${total24h}</div>
            <div class="text-sm text-gray-600">Hành động (24h)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-green-600">${loginCount}</div>
            <div class="text-sm text-gray-600">Đăng nhập (24h)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-purple-600">${registerCount}</div>
            <div class="text-sm text-gray-600">Đăng ký lớp (24h)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-orange-600">${autoRegCount}</div>
            <div class="text-sm text-gray-600">Tự động ĐK (24h)</div>
        </div>
    `;
}

/**
 * Render user summary table
 */
function renderUserSummaryTable(userSummary) {
    const tbody = document.getElementById('userSummaryTableBody');
    
    if (!userSummary || userSummary.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">Chưa có dữ liệu</td></tr>';
        return;
    }
    
    tbody.innerHTML = userSummary.map(user => {
        const lastActivity = new Date(user.last_activity);
        const isRecentlyActive = (new Date() - lastActivity) < 15 * 60 * 1000; // 15 minutes
        
        return `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-4 py-3" data-label="User">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full ${isRecentlyActive ? 'bg-green-500' : 'bg-gray-300'}"></div>
                    <div>
                        <div class="font-semibold text-gray-900">${user.user_id}</div>
                        ${user.full_name ? `<div class="text-xs text-gray-500">${user.full_name}</div>` : ''}
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 font-bold text-blue-600" data-label="Tổng">${user.total_actions}</td>
            <td class="px-4 py-3 text-sm" data-label="Login">${user.login_count || 0}</td>
            <td class="px-4 py-3 text-sm" data-label="Register">${user.register_count || 0}</td>
            <td class="px-4 py-3 text-sm" data-label="Auto">${user.auto_register_count || 0}</td>
            <td class="px-4 py-3 text-sm" data-label="Fetch">${user.fetch_count || 0}</td>
            <td class="px-4 py-3 text-sm text-gray-600" data-label="Last">${formatDateTime(user.last_activity)}</td>
            <td class="px-4 py-3" data-label="Actions">
                <button onclick="viewUserActivity('${user.user_id}')" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    🔍 Xem
                </button>
            </td>
        </tr>
        `;
    }).join('');
}

/**
 * Render activity logs with pagination
 */
function renderActivityLogs(logs, total, page, totalPages) {
    const tbody = document.getElementById('activityLogsTableBody');
    const infoDiv = document.getElementById('activityResultInfo');
    
    // Update result info
    if (total > 0) {
        const start = (page - 1) * 50 + 1;
        const end = Math.min(page * 50, total);
        infoDiv.textContent = `Hiển thị ${start} - ${end} / ${total} kết quả`;
    } else {
        infoDiv.textContent = '';
    }
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-500">Không tìm thấy kết quả</td></tr>';
        renderActivityPagination(0, 1, 1);
        return;
    }
    
    tbody.innerHTML = logs.map(log => `
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-4 py-3 text-sm text-gray-600 whitespace-nowrap" data-label="Time">${formatDateTime(log.created_at)}</td>
            <td class="px-4 py-3" data-label="User">
                <div class="font-semibold text-gray-900 cursor-pointer hover:text-blue-600" onclick="viewUserActivity('${log.user_id}')">${log.user_id || 'System'}</div>
                ${log.full_name ? `<div class="text-xs text-gray-500">${log.full_name}</div>` : ''}
            </td>
            <td class="px-4 py-3" data-label="Action">
                <span class="px-2 py-1 rounded text-xs font-semibold ${getActionColor(log.action)}">
                    ${getActionText(log.action)}
                </span>
            </td>
            <td class="px-4 py-3" data-label="Details">
                <div class="max-w-md text-sm text-gray-700" title="${log.details || ''}">${log.details || 'N/A'}</div>
                ${log.ip_address ? `<div class="text-xs text-gray-400 mt-0.5">📍 ${log.ip_address}</div>` : ''}
                ${log.user_agent ? `<div class="text-xs text-gray-400 mt-0.5 truncate max-w-xs" title="${log.user_agent}">🌐 ${log.user_agent}</div>` : ''}
            </td>
        </tr>
    `).join('');
    
    // Render pagination
    renderActivityPagination(total, page, totalPages);
}

/**
 * Render activity logs pagination
 */
function renderActivityPagination(total, currentPage, totalPages) {
    const container = document.getElementById('activityPagination');
    if (!container) return;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    const start = (currentPage - 1) * 50 + 1;
    const end = Math.min(currentPage * 50, total);
    
    // Generate page numbers
    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (currentPage <= 4) {
        pages = [1, 2, 3, 4, 5, '...', totalPages];
    } else if (currentPage >= totalPages - 3) {
        pages = [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    } else {
        pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
    }
    
    const pageButtons = pages.map(p => {
        if (p === '...') return '<span class="px-3 py-2 text-gray-500">...</span>';
        return `<button onclick="searchUserActivity(${p})" class="px-3 py-2 rounded ${p === currentPage ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'} border text-sm font-medium">${p}</button>`;
    }).join('');
    
    container.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="text-sm text-gray-700">
                Hiển thị <span class="font-medium">${start}</span> đến <span class="font-medium">${end}</span> trong tổng <span class="font-medium">${total}</span>
            </div>
            <div class="flex items-center gap-1">
                <button onclick="searchUserActivity(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-2 rounded bg-white text-gray-700 hover:bg-gray-100 border text-sm disabled:opacity-50 disabled:cursor-not-allowed">← Trước</button>
                ${pageButtons}
                <button onclick="searchUserActivity(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="px-3 py-2 rounded bg-white text-gray-700 hover:bg-gray-100 border text-sm disabled:opacity-50 disabled:cursor-not-allowed">Sau →</button>
            </div>
        </div>
    `;
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

            // Debug: Log revenue data
            console.log('📊 Revenue data:', stats.revenueByDate);
            console.log('👥 User growth:', stats.userGrowth);
            console.log('⭐ VIP distribution:', stats.vipDistribution);

            // Normalize field names if backend returns payment_date instead of date
            if (stats.revenueByDate && stats.revenueByDate.length > 0) {
                stats.revenueByDate = stats.revenueByDate.map(item => ({
                    date: item.date || item.payment_date,
                    revenue: item.revenue || item.daily_revenue
                }));
                console.log('✅ Normalized revenue data:', stats.revenueByDate);
            }

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

    // Handle empty data
    if (!data || data.length === 0) {
        charts.revenue = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Chưa có dữ liệu'],
                datasets: [{
                    label: 'Doanh thu (VNĐ)',
                    data: [0],
                    borderColor: 'rgb(147, 51, 234)',
                    backgroundColor: 'rgba(147, 51, 234, 0.1)',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                }
            }
        });
        return;
    }

    // Normalize data and reverse to show oldest to newest (left to right)
    const normalizedData = data.map(item => ({
        date: item.date || item.payment_date,
        revenue: parseFloat(item.revenue || item.daily_revenue || 0)
    })).reverse();

    console.log('🎨 Chart normalized data:', normalizedData);

    charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
            labels: normalizedData.map(d => {
                const date = new Date(d.date);
                if (isNaN(date.getTime())) {
                    console.error('❌ Invalid date:', d.date);
                    return 'N/A';
                }
                return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            }),
            datasets: [{
                label: 'Doanh thu (VNĐ)',
                data: normalizedData.map(d => d.revenue),
                borderColor: 'rgb(147, 51, 234)',
                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return 'Doanh thu: ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            if (value >= 1000000) {
                                return (value / 1000000).toFixed(1) + 'M';
                            } else if (value >= 1000) {
                                return (value / 1000).toFixed(0) + 'K';
                            }
                            return value;
                        },
                        maxTicksLimit: 6
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
        <div class="border-b border-gray-200 py-3 hover:bg-gray-50 transition-colors px-2 rounded">
            <div class="flex justify-between items-start gap-3">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${getActionColor(activity.action)}">
                            ${getActionText(activity.action)}
                        </span>
                        <span class="font-semibold text-gray-900 text-sm">${activity.user_id || 'System'}</span>
                        ${activity.admin_id ? `<span class="text-sm text-purple-600">👨‍💼 ${activity.admin_id}</span>` : ''}
                    </div>
                    ${activity.details ? `<p class="text-sm text-gray-700 mt-1 line-clamp-2">${activity.details}</p>` : ''}
                </div>
                <span class="text-xs text-gray-500 whitespace-nowrap">${new Date(activity.created_at).toLocaleString('vi-VN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })}</span>
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
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${plan.id}</td>
            <td class="px-6 py-4 font-mono text-sm bg-gray-50 text-gray-700" data-label="Key">${plan.plan_key}</td>
            <td class="px-6 py-4" data-label="Tên">
                <div class="font-semibold text-gray-900">${plan.plan_name}</div>
                ${plan.description ? `<div class="text-sm text-gray-600 mt-0.5">${plan.description}</div>` : ''}
            </td>
            <td class="px-6 py-4 text-center" data-label="Thời hạn">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">⏱️ ${plan.duration_days} ngày</span>
            </td>
            <td class="px-6 py-4 font-bold text-green-600" data-label="Giá">${parseFloat(plan.price).toLocaleString('vi-VN')}đ</td>
            <td class="px-6 py-4" data-label="Trạng thái">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${plan.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${plan.is_active ? '✅ Active' : '❌ Disabled'}
                </span>
            </td>
            <td class="px-6 py-4 text-center" data-label="Thứ tự">
                <span class="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-semibold">#${plan.sort_order}</span>
            </td>
            <td class="px-6 py-4 flex gap-2 flex-wrap" data-label="Actions">
                <button onclick="openEditPlanModal(${plan.id})" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    ✏️ Sửa
                </button>
                <button onclick="togglePlanStatus(${plan.id})" class="text-${plan.is_active ? 'orange' : 'green'}-600 hover:text-${plan.is_active ? 'orange' : 'green'}-800 font-semibold text-sm transition">
                    ${plan.is_active ? '⏸️ Tắt' : '▶️ Bật'}
                </button>
                <button onclick="showConfirmModal('Xóa gói VIP', 'Bạn có chắc muốn xóa gói ${plan.plan_name}? Hành động này không thể hoàn tác.', () => deletePlan(${plan.id}))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
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