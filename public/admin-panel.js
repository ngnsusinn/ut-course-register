const API_URL="/api/admin-handler";let currentUser=null,allData={users:[],subscriptions:[],orders:[],transactions:[],logs:[],vipPlans:[],userActivity:{logs:[],userSummary:[],actionStats:[],activeNow:[],total:0,page:1,totalPages:1}},pagination={users:{currentPage:1,rowsPerPage:20},vipPlans:{currentPage:1,rowsPerPage:20},subscriptions:{currentPage:1,rowsPerPage:20},orders:{currentPage:1,rowsPerPage:20},transactions:{currentPage:1,rowsPerPage:20},logs:{currentPage:1,rowsPerPage:20}},charts={revenue:null,userGrowth:null,vipDistribution:null,orderStatus:null};typeof Chart<"u"&&(Chart.defaults.animation=!1,Chart.defaults.animations={colors:!1,x:!1},Chart.defaults.transitions={active:{animation:{duration:0}}},Chart.defaults.hover.animationDuration=0,Chart.defaults.plugins.tooltip.animation=!1);async function login(){const t=document.getElementById("username").value.trim(),n=document.getElementById("password").value.trim(),e=document.querySelector("#loginScreen button"),a=document.getElementById("loginError");if(!t||!n){showToast("Vui lòng nhập đầy đủ thông tin!","error"),a.classList.remove("hidden"),a.textContent="Vui lòng nhập đầy đủ thông tin!";return}const r=e.innerHTML;e.disabled=!0,e.innerHTML='<div class="loader"></div> Đang đăng nhập...';try{const i=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"login",payload:{username:t,password:n}})})).json();i.success?(currentUser=i.admin,localStorage.setItem("adminSession",JSON.stringify({username:currentUser.username,password:n,loginTime:new Date().getTime()})),document.getElementById("adminUsername").textContent=currentUser.username,showToast("Đăng nhập thành công!","success"),document.getElementById("loginScreen").classList.add("hidden"),document.getElementById("adminDashboard").classList.remove("hidden"),await refreshData("dashboard")):(showToast(i.message||"Đăng nhập thất bại!","error"),a.textContent=i.message||"Đăng nhập thất bại!",a.classList.remove("hidden"))}catch(o){showToast("Lỗi kết nối: "+o.message,"error"),a.textContent="Lỗi kết nối: "+o.message,a.classList.remove("hidden")}finally{e.disabled=!1,e.innerHTML=r}}async function autoLogin(){const t=localStorage.getItem("adminSession");if(!t)return!1;try{const{username:n,password:e,loginTime:a}=JSON.parse(t),r=24*60*60*1e3;if(new Date().getTime()-a>r)return localStorage.removeItem("adminSession"),!1;const i=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"login",payload:{username:n,password:e}})})).json();return i.success?(currentUser=i.admin,document.getElementById("adminUsername").textContent=currentUser.username,localStorage.setItem("adminSession",JSON.stringify({username:n,password:e,loginTime:new Date().getTime()})),document.getElementById("loginScreen").classList.add("hidden"),document.getElementById("adminDashboard").classList.remove("hidden"),await refreshData("dashboard"),!0):(localStorage.removeItem("adminSession"),!1)}catch(n){return console.error("Auto-login failed:",n),localStorage.removeItem("adminSession"),!1}}function showToast(t,n="info"){const e=document.getElementById("inPageToast");e&&e.remove();const a=document.createElement("div");a.id="inPageToast",a.className=`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${n==="success"?"bg-green-500 text-white":n==="error"?"bg-red-500 text-white":"bg-blue-500 text-white"}`;const r=n==="success"?"✅":n==="error"?"❌":"ℹ️";a.innerHTML=`
        <span class="text-lg">${r}</span>
        <span class="font-medium">${t}</span>
    `,document.body.appendChild(a),setTimeout(()=>a.remove(),3e3)}function paginateArray(t,n,e){const a=(n-1)*e,r=a+e;return t.slice(a,r)}function getTotalPages(t,n){return Math.ceil(t/n)}function changePage(t,n){pagination[t].currentPage=n,renderTable(t)}function renderPaginationControls(t,n){const e=document.getElementById(`${t}Pagination`);if(!e)return;const{currentPage:a,rowsPerPage:r}=pagination[t],o=getTotalPages(n,r);if(o<=1){e.innerHTML="";return}const i=(a-1)*r+1,s=Math.min(a*r,n);e.innerHTML=`
        <div class="flex items-center justify-between bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
            <div class="flex-1 flex justify-between sm:hidden">
                <button 
                    onclick="changePage('${t}', ${a-1})" 
                    ${a===1?"disabled":""}
                    class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    Trước
                </button>
                <button 
                    onclick="changePage('${t}', ${a+1})" 
                    ${a===o?"disabled":""}
                    class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    Sau
                </button>
            </div>
            <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm text-gray-700">
                        Hiển thị <span class="font-medium">${i}</span> đến <span class="font-medium">${s}</span> trong tổng số <span class="font-medium">${n}</span> kết quả
                    </p>
                </div>
                <div>
                    <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                        <button 
                            onclick="changePage('${t}', ${a-1})" 
                            ${a===1?"disabled":""}
                            class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span class="sr-only">Trước</span>
                            ←
                        </button>
                        ${generatePageNumbers(t,a,o)}
                        <button 
                            onclick="changePage('${t}', ${a+1})" 
                            ${a===o?"disabled":""}
                            class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span class="sr-only">Sau</span>
                            →
                        </button>
                    </nav>
                </div>
            </div>
        </div>
    `}function generatePageNumbers(t,n,e){let a=[];if(e<=5)for(let o=1;o<=e;o++)a.push(o);else n<=3?a=[1,2,3,4,"...",e]:n>=e-2?a=[1,"...",e-3,e-2,e-1,e]:a=[1,"...",n-1,n,n+1,"...",e];return a.map(o=>o==="..."?'<span class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">...</span>':`
            <button 
                onclick="changePage('${t}', ${o})" 
                class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium ${o===n?"z-10 bg-blue-50 border-blue-500 text-blue-600":"bg-white text-gray-700 hover:bg-gray-50"}">
                ${o}
            </button>
        `).join("")}function logout(){currentUser=null,localStorage.removeItem("adminSession"),document.getElementById("loginScreen").classList.remove("hidden"),document.getElementById("adminDashboard").classList.add("hidden"),document.getElementById("username").value="",document.getElementById("password").value="",document.getElementById("loginError").classList.add("hidden"),showToast("Đã đăng xuất thành công","success")}function switchTab(t){document.querySelectorAll(".tab-btn").forEach(a=>{a.classList.remove("tab-active"),a.classList.add("text-gray-600")}),document.querySelectorAll(".tab-content").forEach(a=>a.classList.add("hidden"));const n=document.querySelector(`[data-tab="${t}"]`);n&&(n.classList.add("tab-active"),n.classList.remove("text-gray-600"));const e=document.getElementById("mobileTabSelect");e&&(e.value=t),document.getElementById(`${t}Tab`).classList.remove("hidden"),refreshData(t)}function filterOrderById(t){switchTab("orders"),setTimeout(()=>{const n=document.getElementById("ordersSearch");n&&(document.getElementById("ordersFilter").value="",n.value=`#${t}`,renderOrders(),document.getElementById("ordersTab").scrollIntoView({behavior:"smooth",block:"start"}))},300)}function filterOrderByCode(t){switchTab("orders"),setTimeout(()=>{const n=document.getElementById("ordersSearch");n&&(document.getElementById("ordersFilter").value="",n.value=t,renderOrders(),document.getElementById("ordersTab").scrollIntoView({behavior:"smooth",block:"start"}))},300)}async function refreshData(t){if(t==="dashboard"){await loadDashboard();return}if(t==="userActivity"){await refreshUserActivity();return}let n=t==="vipPlans"?"getAllVIPPlans":`getAll${t.charAt(0).toUpperCase()+t.slice(1)}`;const e=document.querySelector(`#${t}Tab button[onclick*="refreshData"]`);if(e){const a=e.innerHTML;e.disabled=!0,e.innerHTML='<div class="loader"></div> Đang tải...'}try{const r=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:n})})).json();if(r.success){const o=t==="vipPlans"?"plans":t;allData[t]=r[o]||[],renderTable(t)}else console.error(`Error fetching ${t}:`,r.message),showToast(`Lỗi tải dữ liệu: ${r.message}`,"error")}catch(a){console.error(`Error fetching ${t}:`,a),showToast(`Lỗi kết nối: ${a.message}`,"error")}finally{e&&(e.disabled=!1,e.innerHTML=e.getAttribute("data-original-html")||"🔄 Refresh",e.getAttribute("data-original-html")||e.setAttribute("data-original-html","🔄 Refresh"))}}function renderTable(t){switch(t){case"users":renderUsers();break;case"vipPlans":renderVIPPlans();break;case"subscriptions":renderSubscriptions();break;case"orders":renderOrders();break;case"transactions":renderTransactions();break;case"logs":renderLogs();break;case"userActivity":renderUserActivityData();break}}function renderUsers(){const t=document.getElementById("usersTableBody"),n=document.getElementById("usersSearch").value.toLowerCase(),e=allData.users.filter(d=>d.user_id.toLowerCase().includes(n)),{currentPage:a,rowsPerPage:r}=pagination.users,o=paginateArray(e,a,r);t.innerHTML=o.map(d=>{const c=d.is_vip,g=d.expiry_date?new Date(d.expiry_date):null,u=g&&g<new Date;return`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${d.id||""}</td>
            <td class="px-6 py-4" data-label="User Info">
                <div class="font-semibold text-gray-900">${d.user_id}</div>
                ${d.username?`<div class="text-xs text-gray-500 font-mono mt-0.5">@${d.username}</div>`:""}
                ${d.full_name?`<div class="text-sm text-gray-600 mt-0.5">${d.full_name}</div>`:""}
                ${d.email?`<div class="text-sm text-gray-500 mt-0.5">📧 ${d.email}</div>`:""}
            </td>
            <td class="px-6 py-4" data-label="Active">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${d.is_active?"bg-green-100 text-green-800":"bg-gray-100 text-gray-800"}">
                    ${d.is_active?"✅ Active":"❌ Inactive"}
                </span>
            </td>
            <td class="px-6 py-4" data-label="VIP Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${c&&!u?"bg-green-100 text-green-800":"bg-gray-100 text-gray-800"}">
                    ${c&&!u?"✅ VIP Active":"❌ No VIP"}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Expiry">
                ${g?`
                    <div class="${u?"text-red-600":"text-green-600"} font-semibold text-sm">
                        ${formatDateTime(g)}
                    </div>
                `:'<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Last Login">
                ${d.last_login?formatDateTime(d.last_login):'<span class="text-gray-400">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${d.created_at?formatDateTime(d.created_at):"N/A"}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${d.updated_at?formatDateTime(d.updated_at):"N/A"}</td>
            <td class="px-6 py-4 flex gap-2" data-label="Actions">
                <button onclick="openAddVIPModal('${d.user_id}')" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    ➕ Thêm VIP
                </button>
                <button onclick="showConfirmModal('Xóa User', 'Bạn có chắc muốn xóa user này không? Mọi dữ liệu liên quan sẽ bị xóa.', () => deleteUser('${d.user_id}'))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
        `}).join("");const i=e.length,s=e.filter(d=>d.is_vip&&new Date(d.expiry_date)>new Date).length,l=e.filter(d=>d.expiry_date&&new Date(d.expiry_date)<new Date).length;document.getElementById("usersStats").innerHTML=`
        <div class="bg-blue-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-blue-600">${i}</div>
            <div class="text-sm text-gray-600">Tổng Users</div>
        </div>
        <div class="bg-green-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-green-600">${s}</div>
            <div class="text-sm text-gray-600">VIP Active</div>
        </div>
        <div class="bg-red-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-red-600">${l}</div>
            <div class="text-sm text-gray-600">VIP Expired</div>
        </div>
    `,renderPaginationControls("users",i)}function renderSubscriptions(){const t=document.getElementById("subscriptionsTableBody"),n=document.getElementById("subscriptionsSearch").value.toLowerCase(),e=document.getElementById("subscriptionsFilter").value,a=allData.subscriptions.filter(s=>{const l=s.user_id.toLowerCase().includes(n)||s.plan_type.toLowerCase().includes(n),d=new Date(s.expiry_date)>new Date;return l&&(!e||e==="active"&&d||e==="expired"&&!d)}),{currentPage:r,rowsPerPage:o}=pagination.subscriptions,i=paginateArray(a,r,o);t.innerHTML=i.map(s=>{const l=new Date(s.expiry_date)>new Date,d=s.created_by_admin?`👨‍💼 Admin (${s.created_by_admin})`:"👤 User",c=s.order_code?`<a href="#orders" onclick="filterOrderByCode('${s.order_code}')" class="text-blue-600 hover:text-blue-800 font-semibold font-mono text-sm transition">${s.order_code}</a>`:'<span class="text-purple-600 font-semibold text-sm">👨‍💼 Admin</span>';return`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${s.id}</td>
            <td class="px-6 py-4" data-label="User">
                <div class="font-semibold text-gray-900">${s.user_id}</div>
                ${s.plan_name?`<div class="text-sm text-gray-600 mt-0.5">${s.plan_name}</div>`:""}
            </td>
            <td class="px-6 py-4" data-label="Plan ID">
                <span class="text-xs text-gray-500 font-mono">${s.plan_id||"N/A"}</span>
            </td>
            <td class="px-6 py-4" data-label="Plan">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">${s.plan_type}</span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Source">
                ${d}
            </td>
            <td class="px-6 py-4" data-label="Order">${c}</td>
            <td class="px-6 py-4" data-label="Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${l?"bg-green-100 text-green-800":"bg-red-100 text-red-800"}">
                    ${l?"✅ Active":"❌ Expired"}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Expiry">
                <div class="${l?"text-green-600":"text-red-600"} font-semibold text-sm">
                    ${formatDateTime(s.expiry_date)}
                </div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${formatDateTime(s.created_at)}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${s.updated_at?formatDateTime(s.updated_at):"N/A"}</td>
            <td class="px-6 py-4" data-label="Actions">
                <button onclick="showConfirmModal('Xóa VIP Subscription', 'Bạn có chắc muốn xóa subscription này không?', () => deleteSubscription(${s.id}))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
        `}).join(""),renderPaginationControls("subscriptions",a.length)}function renderOrders(){const t=document.getElementById("ordersTableBody"),n=document.getElementById("ordersSearch").value.toLowerCase(),e=document.getElementById("ordersFilter").value,a=allData.orders.filter(s=>{const l=s.user_id.toLowerCase().includes(n)||s.plan_name.toLowerCase().includes(n)||s.order_code&&s.order_code.toLowerCase().includes(n),d=!e||s.payment_status===e;return l&&d}),{currentPage:r,rowsPerPage:o}=pagination.orders,i=paginateArray(a,r,o);t.innerHTML=i.map(s=>{const l=s.cancelled_at!==null&&s.cancelled_at!==void 0,d=s.payment_status==="Paid";return`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${s.id}</td>
            <td class="px-6 py-4" data-label="Order Code">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-mono font-bold">${s.order_code||"N/A"}</span>
            </td>
            <td class="px-6 py-4" data-label="User">
                <div class="font-semibold text-gray-900">${s.user_id}</div>
            </td>
            <td class="px-6 py-4" data-label="Plan">
                <div>
                    <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">${s.plan_name}</span>
                    ${s.plan_type?`<div class="text-xs text-gray-500 mt-1">📋 ${s.plan_type}</div>`:""}
                    ${s.gateway?`<div class="text-sm text-gray-600 mt-1">💳 ${s.gateway}</div>`:""}
                </div>
            </td>
            <td class="px-6 py-4 font-bold text-green-600 text-sm" data-label="Amount">${parseFloat(s.amount).toLocaleString("vi-VN")}đ</td>
            <td class="px-6 py-4" data-label="Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${l?"bg-red-100 text-red-800":d?"bg-green-100 text-green-800":"bg-yellow-100 text-yellow-800"}">
                    ${l?"❌ Cancelled":d?"✅ Paid":"⏳ Unpaid"}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Transaction Ref">
                <span class="text-xs font-mono text-gray-600">${s.transaction_ref||"N/A"}</span>
            </td>
            <td class="px-6 py-4" data-label="Paid At">
                ${s.paid_at?`<div class="text-green-600 font-semibold text-sm">${formatDateTime(s.paid_at)}</div>`:'<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4" data-label="Cancelled At">
                ${s.cancelled_at?`<div class="text-red-600 font-semibold text-sm">${formatDateTime(s.cancelled_at)}</div>`:'<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${formatDateTime(s.created_at)}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${s.updated_at?formatDateTime(s.updated_at):"N/A"}</td>
        </tr>
    `}).join(""),renderPaginationControls("orders",a.length)}function renderTransactions(){const t=document.getElementById("transactionsTableBody"),n=document.getElementById("transactionsSearch").value.toLowerCase(),e=document.getElementById("amountFilter").value,a=allData.transactions.filter(s=>{const l=s.reference_number?.toLowerCase().includes(n)||s.transaction_content?.toLowerCase().includes(n),d=!e||parseFloat(s.amount_in)===parseFloat(e);return l&&d}),{currentPage:r,rowsPerPage:o}=pagination.transactions,i=paginateArray(a,r,o);t.innerHTML=i.map(s=>{const l=s.order_code?`<a href="#orders" onclick="filterOrderByCode('${s.order_code}')" class="text-blue-600 hover:text-blue-800 font-semibold font-mono text-sm transition">${s.order_code}</a>`:'<span class="text-gray-400 text-sm">N/A</span>';return`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${s.id}</td>
            <td class="px-6 py-4" data-label="Order">${l}</td>
            <td class="px-6 py-4" data-label="Gateway">
                <span class="px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs font-semibold">💳 ${s.gateway}</span>
            </td>
            <td class="px-6 py-4" data-label="Account">
                <div class="text-sm text-gray-700">${s.account_number||"N/A"}</div>
                ${s.sub_account?`<div class="text-xs text-gray-500 mt-0.5">Sub: ${s.sub_account}</div>`:""}
            </td>
            <td class="px-6 py-4 font-bold text-green-600" data-label="Amount In">
                <div class="text-base">${parseFloat(s.amount_in).toLocaleString("vi-VN")}đ</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Amount Out">
                ${s.amount_out?`${parseFloat(s.amount_out).toLocaleString("vi-VN")}đ`:"0đ"}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Accumulated">
                ${s.accumulated?`${parseFloat(s.accumulated).toLocaleString("vi-VN")}đ`:"N/A"}
            </td>
            <td class="px-6 py-4" data-label="Code">
                <span class="text-xs font-mono text-gray-600">${s.code||"N/A"}</span>
            </td>
            <td class="px-6 py-4" data-label="Content">
                <div class="max-w-xs truncate text-sm text-gray-700" title="${s.transaction_content||"N/A"}">${s.transaction_content||"N/A"}</div>
            </td>
            <td class="px-6 py-4 text-xs font-mono bg-gray-50 text-gray-600" data-label="Reference">${s.reference_number||"N/A"}</td>
            <td class="px-6 py-4" data-label="Body">
                <div class="max-w-xs truncate text-xs text-gray-500" title="${s.body||"N/A"}">${s.body||"N/A"}</div>
            </td>
            <td class="px-6 py-4" data-label="Txn Date">
                <div class="text-sm text-gray-600">${s.transaction_date?formatDateTime(s.transaction_date):"N/A"}</div>
            </td>
            <td class="px-6 py-4" data-label="Received">
                <div class="text-sm text-gray-600">${formatDateTime(s.received_at)}</div>
            </td>
        </tr>
    `}).join(""),renderPaginationControls("transactions",a.length)}function renderLogs(){const t=document.getElementById("logsTableBody"),n=document.getElementById("logsSearch").value.toLowerCase(),e=document.getElementById("logsFilter").value,a=allData.logs.filter(s=>{const l=s.user_id?.toLowerCase().includes(n)||s.action?.toLowerCase().includes(n),d=!e||s.action===e;return l&&d}),{currentPage:r,rowsPerPage:o}=pagination.logs,i=paginateArray(a,r,o);t.innerHTML=i.map(s=>`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${s.id}</td>
            <td class="px-6 py-4" data-label="User">
                <div class="font-semibold text-gray-900">${s.user_id||"System"}</div>
                ${s.admin_id?`<div class="text-sm text-purple-600 mt-0.5">👨‍💼 Admin: ${s.admin_id}</div>`:""}
            </td>
            <td class="px-6 py-4" data-label="Action">
                <span class="px-2 py-1 rounded text-xs font-semibold ${getActionColor(s.action)}">
                    ${getActionText(s.action)}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Details">
                <div class="max-w-md truncate text-sm text-gray-700" title="${s.details||"N/A"}">${s.details||"N/A"}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="IP">${s.ip_address||"N/A"}</td>
            <td class="px-6 py-4" data-label="User Agent">
                <div class="max-w-xs truncate text-xs text-gray-500" title="${s.user_agent||"N/A"}">${s.user_agent||"N/A"}</div>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Date">${s.created_date||""}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Time">${formatDateTime(s.created_at)}</td>
        </tr>
    `).join(""),renderPaginationControls("logs",a.length)}function getActionColor(t){switch(t){case"USER_LOGIN":return"bg-blue-100 text-blue-800";case"VIP_PURCHASE":return"bg-green-100 text-green-800";case"ADMIN_ADD_VIP":return"bg-purple-100 text-purple-800";case"ADMIN_DELETE_VIP":return"bg-red-100 text-red-800";case"ADMIN_DELETE_USER":return"bg-red-100 text-red-800";case"ADMIN_CREATE_PLAN":return"bg-purple-100 text-purple-800";case"ADMIN_UPDATE_PLAN":return"bg-purple-100 text-purple-800";case"ADMIN_DELETE_PLAN":return"bg-red-100 text-red-800";case"ADMIN_TOGGLE_PLAN":return"bg-purple-100 text-purple-800";case"ORDER_CREATED":return"bg-blue-100 text-blue-800";case"ORDER_PAID":return"bg-green-100 text-green-800";case"ORDER_CANCELLED":return"bg-red-100 text-red-800";case"ORDER_AUTO_CANCELLED":return"bg-orange-100 text-orange-800";case"CREATE_VIP_ORDER":return"bg-yellow-100 text-yellow-800";case"VIP_ACTIVATED":return"bg-green-100 text-green-800";case"VIP_EXTENDED":return"bg-blue-100 text-blue-800";case"VIP_EXPIRED":return"bg-yellow-100 text-yellow-800";case"PAYMENT_RECEIVED":return"bg-green-100 text-green-800";case"WEBHOOK_PROCESSED":return"bg-indigo-100 text-indigo-800";case"FETCH_SCHEDULE":return"bg-cyan-100 text-cyan-800";case"FETCH_SCHEDULE_DONE":return"bg-cyan-100 text-cyan-800";case"FETCH_REGISTERED":return"bg-teal-100 text-teal-800";case"REGISTER_CLASS":return"bg-indigo-100 text-indigo-800";case"REGISTER_SUCCESS":return"bg-green-100 text-green-800";case"REGISTER_FAILED":return"bg-red-100 text-red-800";case"CANCEL_CLASS":return"bg-orange-100 text-orange-800";case"CANCEL_SUCCESS":return"bg-green-100 text-green-800";case"CANCEL_FAILED":return"bg-red-100 text-red-800";case"CHECK_AVAILABILITY":return"bg-yellow-100 text-yellow-800";case"SYNC_DATA":return"bg-indigo-100 text-indigo-800";case"SYNC_DATA_DONE":return"bg-indigo-100 text-indigo-800";case"START_AUTO_REGISTER":return"bg-emerald-100 text-emerald-800";case"STOP_AUTO_REGISTER":return"bg-gray-100 text-gray-800";case"START_AUTO_INSERT":return"bg-emerald-100 text-emerald-800";case"STOP_AUTO_INSERT":return"bg-gray-100 text-gray-800";case"SELECT_CLASS":return"bg-sky-100 text-sky-800";case"DESELECT_CLASS":return"bg-gray-100 text-gray-800";case"VIEW_TIMETABLE":return"bg-blue-100 text-blue-800";case"EXPORT_TIMETABLE":return"bg-blue-100 text-blue-800";case"CHECK_VIP_STATUS":return"bg-yellow-100 text-yellow-800";case"OPEN_VIP_MODAL":return"bg-yellow-100 text-yellow-800";case"SWAP_CLASS":return"bg-purple-100 text-purple-800";case"SWAP_CLASS_SETUP":return"bg-purple-100 text-purple-800";case"SWAP_FROM_REGISTERED":return"bg-purple-100 text-purple-800";case"SELECT_FROM_SWAP_MODAL":return"bg-sky-100 text-sky-800";case"OPEN_SWAP_MODAL":return"bg-purple-100 text-purple-800";case"REMOVE_SELECTED":return"bg-orange-100 text-orange-800";case"REMOVE_SWAP":return"bg-orange-100 text-orange-800";case"LOGIN_SUCCESS":return"bg-blue-100 text-blue-800";case"AUTO_LOGIN":return"bg-blue-100 text-blue-800";case"LOGOUT":return"bg-gray-100 text-gray-800";case"FETCH_SCHEDULE_BTN":return"bg-cyan-100 text-cyan-800";case"REFRESH_REGISTERED":return"bg-teal-100 text-teal-800";case"OPEN_GUIDE":return"bg-indigo-100 text-indigo-800";case"BUY_VIP_PLAN":return"bg-yellow-100 text-yellow-800";case"CANCEL_PAYMENT":return"bg-red-100 text-red-800";case"CANCEL_CLASS_CONFIRM":return"bg-orange-100 text-orange-800";case"SEARCH_SCHEDULE":return"bg-gray-100 text-gray-800";case"FILTER_SUBJECT":return"bg-gray-100 text-gray-800";case"PAGE_LOAD":return"bg-gray-100 text-gray-800";case"PAGE_UNLOAD":return"bg-gray-100 text-gray-800";case"USER_ACTION":return"bg-gray-100 text-gray-800";default:return"bg-gray-100 text-gray-800"}}function getActionText(t){switch(t){case"USER_LOGIN":return"🔐 Đăng nhập";case"VIP_PURCHASE":return"💳 Mua VIP";case"ADMIN_ADD_VIP":return"⭐ Admin thêm VIP";case"ADMIN_DELETE_VIP":return"🗑️ Admin xóa VIP";case"ADMIN_DELETE_USER":return"🗑️ Admin xóa User";case"ADMIN_CREATE_PLAN":return"➕ Admin tạo gói";case"ADMIN_UPDATE_PLAN":return"✏️ Admin sửa gói";case"ADMIN_DELETE_PLAN":return"🗑️ Admin xóa gói";case"ADMIN_TOGGLE_PLAN":return"🔄 Admin đổi trạng thái gói";case"ORDER_CREATED":return"📝 Tạo đơn hàng";case"ORDER_PAID":return"💰 Thanh toán thành công";case"ORDER_CANCELLED":return"❌ Hủy đơn hàng";case"ORDER_AUTO_CANCELLED":return"⏰ Tự động hủy đơn";case"CREATE_VIP_ORDER":return"🛒 Tạo đơn VIP";case"VIP_ACTIVATED":return"✅ Kích hoạt VIP";case"VIP_EXTENDED":return"🔄 Gia hạn VIP";case"VIP_EXPIRED":return"⌛ VIP hết hạn";case"PAYMENT_RECEIVED":return"💳 Nhận thanh toán";case"WEBHOOK_PROCESSED":return"🔗 Xử lý webhook";case"FETCH_SCHEDULE":return"📋 Tải lịch học";case"FETCH_SCHEDULE_DONE":return"✅ Tải lịch xong";case"FETCH_REGISTERED":return"📑 Tải lớp đã ĐK";case"REGISTER_CLASS":return"📝 Đăng ký lớp";case"REGISTER_SUCCESS":return"✅ ĐK thành công";case"REGISTER_FAILED":return"❌ ĐK thất bại";case"CANCEL_CLASS":return"🗑️ Hủy đăng ký";case"CANCEL_SUCCESS":return"✅ Hủy thành công";case"CANCEL_FAILED":return"❌ Hủy thất bại";case"CHECK_AVAILABILITY":return"🔍 Kiểm tra chỗ trống";case"SYNC_DATA":return"🔄 Đồng bộ dữ liệu";case"SYNC_DATA_DONE":return"✅ Đồng bộ xong";case"START_AUTO_REGISTER":return"🤖 Bắt đầu tự động ĐK";case"STOP_AUTO_REGISTER":return"⏹️ Dừng tự động ĐK";case"START_AUTO_INSERT":return"🤖 Bắt đầu tự động chèn";case"STOP_AUTO_INSERT":return"⏹️ Dừng tự động chèn";case"SELECT_CLASS":return"✓ Chọn lớp";case"DESELECT_CLASS":return"✗ Bỏ chọn lớp";case"VIEW_TIMETABLE":return"📅 Xem thời khóa biểu";case"EXPORT_TIMETABLE":return"📤 Xuất thời khóa biểu";case"CHECK_VIP_STATUS":return"🔍 Kiểm tra VIP";case"OPEN_VIP_MODAL":return"💎 Mở mua VIP";case"SWAP_CLASS":return"🔀 Hoán đổi lớp";case"SWAP_CLASS_SETUP":return"🔀 Thiết lập đổi lớp";case"SWAP_FROM_REGISTERED":return"🔀 Đổi lớp từ đã ĐK";case"SELECT_FROM_SWAP_MODAL":return"✅ Chọn từ modal đổi";case"OPEN_SWAP_MODAL":return"🔀 Mở modal đổi lớp";case"REMOVE_SELECTED":return"❌ Xóa lớp đã chọn";case"REMOVE_SWAP":return"❌ Hủy đổi lớp";case"LOGIN_SUCCESS":return"🔐 Đăng nhập thành công";case"AUTO_LOGIN":return"🔄 Tự động đăng nhập";case"LOGOUT":return"🚪 Đăng xuất";case"FETCH_SCHEDULE_BTN":return"📋 Bấm tải lịch học";case"REFRESH_REGISTERED":return"🔄 Làm mới lớp đã ĐK";case"OPEN_GUIDE":return"📖 Mở hướng dẫn";case"BUY_VIP_PLAN":return"💳 Bấm mua VIP";case"CANCEL_PAYMENT":return"❌ Hủy thanh toán";case"CANCEL_CLASS_CONFIRM":return"🗑️ Bấm hủy đăng ký";case"SEARCH_SCHEDULE":return"🔍 Tìm kiếm lịch học";case"FILTER_SUBJECT":return"📊 Lọc môn học";case"PAGE_LOAD":return"🌐 Mở trang";case"PAGE_UNLOAD":return"👋 Đóng trang";case"USER_ACTION":return"📌 Hành động";default:return t?t.replace(/_/g," "):"Unknown"}}async function openAddVIPModal(t=""){document.getElementById("vipUserId").value=t,await loadVIPPlansForModal(),document.getElementById("addVIPModal").classList.remove("hidden")}async function loadVIPPlansForModal(){const t=document.getElementById("vipPlanType");try{t.innerHTML='<option value="">Đang tải gói VIP...</option>',t.disabled=!0;const e=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getAllVIPPlans"})})).json();if(e.success&&e.plans){t.innerHTML="";const a=e.plans.sort((r,o)=>(r.sort_order||0)-(o.sort_order||0));if(a.length===0){t.innerHTML='<option value="">Chưa có gói VIP nào trong hệ thống</option>',showToast("Chưa có gói VIP nào. Vui lòng tạo gói VIP trong tab VIP Plans","warning");return}a.forEach(r=>{const o=document.createElement("option");o.value=r.plan_key;const i=r.duration_days===36500?"Vĩnh viễn":`${r.duration_days} ngày`,s=r.is_active===1?"✅":"🔴";o.textContent=`${s} ${r.plan_name} (${i}) - ${parseFloat(r.price).toLocaleString("vi-VN")}đ`,o.setAttribute("data-duration",r.duration_days),o.setAttribute("data-price",r.price),o.setAttribute("data-active",r.is_active),t.appendChild(o)}),t.disabled=!1}else t.innerHTML='<option value="">Lỗi tải dữ liệu</option>',showToast("Không thể tải danh sách gói VIP từ database","error")}catch(n){console.error("Error loading VIP plans:",n),t.innerHTML='<option value="">Lỗi kết nối</option>',showToast("Lỗi kết nối đến server","error")}}function closeAddVIPModal(){document.getElementById("addVIPModal").classList.add("hidden")}async function submitAddVIP(){const t=document.getElementById("vipUserId").value.trim(),n=document.getElementById("vipPlanType").value,e=document.getElementById("submitVIPBtn");if(!t){showToast("Vui lòng nhập User ID!","error");return}const a=e.innerHTML;e.disabled=!0,e.innerHTML='<div class="loader"></div> Đang xử lý...';try{const o=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"addVIPSubscription",payload:{userId:t,planType:n}})})).json();o.success?(showToast("✅ Đã thêm VIP thành công!","success"),closeAddVIPModal(),await Promise.all([refreshData("users"),refreshData("subscriptions")])):showToast("Lỗi: "+o.message,"error")}catch(r){showToast("Lỗi kết nối: "+r.message,"error")}finally{e.disabled=!1,e.innerHTML=a}}function formatDateTime(t){return new Date(t).toLocaleString("vi-VN",{timeZone:"Asia/Bangkok"})}function showConfirmModal(t,n,e){document.getElementById("confirmTitle").textContent=t,document.getElementById("confirmMessage").textContent=n,document.getElementById("confirmActionBtn").onclick=()=>{closeConfirmModal(),e()},document.getElementById("confirmModal").classList.remove("hidden")}function closeConfirmModal(){document.getElementById("confirmModal").classList.add("hidden")}async function deleteUser(t){const n=document.querySelector(`button[onclick*="deleteUser('${t}')"]`),e=n.innerHTML;n.disabled=!0,n.innerHTML='<div class="loader"></div>';try{const r=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteUser",payload:{userId:t}})})).json();r.success?(showToast("✅ Đã xóa user thành công!","success"),await Promise.all([refreshData("users"),refreshData("subscriptions")])):showToast("Lỗi: "+r.message,"error")}catch(a){showToast("Lỗi kết nối: "+a.message,"error")}finally{n.disabled=!1,n.innerHTML=e}}async function deleteSubscription(t){const n=document.querySelector(`button[onclick*="deleteSubscription(${t})"]`),e=n.innerHTML;n.disabled=!0,n.innerHTML='<div class="loader"></div>';try{const r=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteSubscription",payload:{subscriptionId:t}})})).json();r.success?(showToast("✅ Đã xóa subscription!","success"),await Promise.all([refreshData("subscriptions"),refreshData("users")])):showToast("Lỗi: "+r.message,"error")}catch(a){showToast("Lỗi kết nối: "+a.message,"error")}finally{n.disabled=!1,n.innerHTML=e}}document.addEventListener("DOMContentLoaded",async function(){await autoLogin()||document.getElementById("loginScreen").classList.remove("hidden");const n=["usersSearch","subscriptionsSearch","ordersSearch","transactionsSearch","logsSearch"],e=["subscriptionsFilter","ordersFilter","logsFilter","amountFilter"];n.forEach(r=>{const o=document.getElementById(r);o&&o.addEventListener("input",debounce(()=>{const i=r.replace("Search","");renderTable(i)},300))}),e.forEach(r=>{const o=document.getElementById(r);o&&o.addEventListener("change",()=>{let i=r.replace("Filter","");r==="amountFilter"&&(i="transactions"),renderTable(i)})});const a=document.getElementById("password");a&&a.addEventListener("keydown",r=>{r.key==="Enter"&&login()})});function debounce(t,n){let e;return function(...r){const o=()=>{clearTimeout(e),t(...r)};clearTimeout(e),e=setTimeout(o,n)}}async function refreshUserActivity(){try{const n=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getUserActivity",payload:{page:1,limit:50}})})).json();n.success?(allData.userActivity=n,renderUserActivityData()):showToast("Lỗi tải dữ liệu hoạt động: "+(n.message||""),"error")}catch(t){console.error("Error refreshing user activity:",t),showToast("Lỗi kết nối: "+t.message,"error")}}async function searchUserActivity(t=1){const n=document.getElementById("activitySearchUser").value.trim(),e=document.getElementById("activitySearchAction").value,a=document.getElementById("activityDateFrom").value,r=document.getElementById("activityDateTo").value;try{const i=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getUserActivity",payload:{userId:n,action:e,dateFrom:a,dateTo:r,page:t,limit:50}})})).json();i.success?(allData.userActivity=i,renderUserActivityData(),document.getElementById("activityLogsTableBody").closest(".bg-white").scrollIntoView({behavior:"smooth",block:"start"})):showToast("Lỗi tìm kiếm: "+(i.message||""),"error")}catch(o){showToast("Lỗi kết nối: "+o.message,"error")}}function viewUserActivity(t){document.getElementById("activitySearchUser").value=t,document.getElementById("activitySearchAction").value="",document.getElementById("activityDateFrom").value="",document.getElementById("activityDateTo").value="",searchUserActivity(1)}function renderUserActivityData(){const t=allData.userActivity;renderActiveUsersGrid(t.activeNow||[]),renderActivityStats(t.actionStats||[]),renderUserSummaryTable(t.userSummary||[]),renderActivityLogs(t.logs||[],t.total||0,t.page||1,t.totalPages||1)}function renderActiveUsersGrid(t){const n=document.getElementById("activeUsersGrid");if(!t||t.length===0){n.innerHTML='<p class="text-gray-500 text-center py-4 col-span-full">Không có user nào đang hoạt động</p>';return}n.innerHTML=t.map(e=>{const a=Math.floor((new Date-new Date(e.last_activity))/1e3/60),r=a<1?"Vừa xong":`${a} phút trước`,o=a<2;return`
        <div class="border ${o?"border-green-300 bg-green-50":"border-gray-200 bg-white"} rounded-lg p-4 hover:shadow-md transition cursor-pointer" onclick="viewUserActivity('${e.user_id}')">
            <div class="flex items-center gap-3 mb-2">
                <div class="w-3 h-3 rounded-full ${o?"bg-green-500 animate-pulse":"bg-yellow-500"}"></div>
                <div class="font-semibold text-gray-900">${e.user_id}</div>
            </div>
            ${e.full_name?`<div class="text-sm text-gray-600 mb-1">${e.full_name}</div>`:""}
            <div class="text-xs text-gray-500 mb-2">⏱️ ${r}</div>
            <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-xs font-semibold ${getActionColor(e.last_action)}">
                    ${getActionText(e.last_action)}
                </span>
            </div>
            ${e.last_details?`<div class="text-xs text-gray-500 mt-1 truncate" title="${e.last_details}">${e.last_details}</div>`:""}
        </div>
        `}).join("")}function renderActivityStats(t){const n=document.getElementById("activityStatsCards");if(!t||t.length===0){n.innerHTML="";return}const e=t.reduce((i,s)=>i+s.count,0),a=t.filter(i=>i.action==="USER_LOGIN").reduce((i,s)=>i+s.count,0),r=t.filter(i=>["REGISTER_CLASS","REGISTER_SUCCESS"].includes(i.action)).reduce((i,s)=>i+s.count,0),o=t.filter(i=>["START_AUTO_REGISTER","CHECK_AVAILABILITY"].includes(i.action)).reduce((i,s)=>i+s.count,0);n.innerHTML=`
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-blue-600">${e}</div>
            <div class="text-sm text-gray-600">Hành động (24h)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-green-600">${a}</div>
            <div class="text-sm text-gray-600">Đăng nhập (24h)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-purple-600">${r}</div>
            <div class="text-sm text-gray-600">Đăng ký lớp (24h)</div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 text-center">
            <div class="text-3xl font-bold text-orange-600">${o}</div>
            <div class="text-sm text-gray-600">Tự động ĐK (24h)</div>
        </div>
    `}function renderUserSummaryTable(t){const n=document.getElementById("userSummaryTableBody");if(!t||t.length===0){n.innerHTML='<tr><td colspan="8" class="text-center py-8 text-gray-500">Chưa có dữ liệu</td></tr>';return}n.innerHTML=t.map(e=>{const a=new Date(e.last_activity);return`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-4 py-3" data-label="User">
                <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full ${new Date-a<15*60*1e3?"bg-green-500":"bg-gray-300"}"></div>
                    <div>
                        <div class="font-semibold text-gray-900">${e.user_id}</div>
                        ${e.full_name?`<div class="text-xs text-gray-500">${e.full_name}</div>`:""}
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 font-bold text-blue-600" data-label="Tổng">${e.total_actions}</td>
            <td class="px-4 py-3 text-sm" data-label="Login">${e.login_count||0}</td>
            <td class="px-4 py-3 text-sm" data-label="Register">${e.register_count||0}</td>
            <td class="px-4 py-3 text-sm" data-label="Auto">${e.auto_register_count||0}</td>
            <td class="px-4 py-3 text-sm" data-label="Fetch">${e.fetch_count||0}</td>
            <td class="px-4 py-3 text-sm text-gray-600" data-label="Last">${formatDateTime(e.last_activity)}</td>
            <td class="px-4 py-3" data-label="Actions">
                <button onclick="viewUserActivity('${e.user_id}')" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    🔍 Xem
                </button>
            </td>
        </tr>
        `}).join("")}function renderActivityLogs(t,n,e,a){const r=document.getElementById("activityLogsTableBody"),o=document.getElementById("activityResultInfo");if(n>0){const i=(e-1)*50+1,s=Math.min(e*50,n);o.textContent=`Hiển thị ${i} - ${s} / ${n} kết quả`}else o.textContent="";if(!t||t.length===0){r.innerHTML='<tr><td colspan="4" class="text-center py-8 text-gray-500">Không tìm thấy kết quả</td></tr>',renderActivityPagination(0,1,1);return}r.innerHTML=t.map(i=>`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-4 py-3 text-sm text-gray-600 whitespace-nowrap" data-label="Time">${formatDateTime(i.created_at)}</td>
            <td class="px-4 py-3" data-label="User">
                <div class="font-semibold text-gray-900 cursor-pointer hover:text-blue-600" onclick="viewUserActivity('${i.user_id}')">${i.user_id||"System"}</div>
                ${i.full_name?`<div class="text-xs text-gray-500">${i.full_name}</div>`:""}
            </td>
            <td class="px-4 py-3" data-label="Action">
                <span class="px-2 py-1 rounded text-xs font-semibold ${getActionColor(i.action)}">
                    ${getActionText(i.action)}
                </span>
            </td>
            <td class="px-4 py-3" data-label="Details">
                <div class="max-w-md text-sm text-gray-700" title="${i.details||""}">${i.details||"N/A"}</div>
                ${i.ip_address?`<div class="text-xs text-gray-400 mt-0.5">📍 ${i.ip_address}</div>`:""}
                ${i.user_agent?`<div class="text-xs text-gray-400 mt-0.5 truncate max-w-xs" title="${i.user_agent}">🌐 ${i.user_agent}</div>`:""}
            </td>
        </tr>
    `).join(""),renderActivityPagination(n,e,a)}function renderActivityPagination(t,n,e){const a=document.getElementById("activityPagination");if(!a)return;if(e<=1){a.innerHTML="";return}const r=(n-1)*50+1,o=Math.min(n*50,t);let i=[];if(e<=7)for(let l=1;l<=e;l++)i.push(l);else n<=4?i=[1,2,3,4,5,"...",e]:n>=e-3?i=[1,"...",e-4,e-3,e-2,e-1,e]:i=[1,"...",n-1,n,n+1,"...",e];const s=i.map(l=>l==="..."?'<span class="px-3 py-2 text-gray-500">...</span>':`<button onclick="searchUserActivity(${l})" class="px-3 py-2 rounded ${l===n?"bg-blue-600 text-white":"bg-white text-gray-700 hover:bg-gray-100"} border text-sm font-medium">${l}</button>`).join("");a.innerHTML=`
        <div class="flex items-center justify-between">
            <div class="text-sm text-gray-700">
                Hiển thị <span class="font-medium">${r}</span> đến <span class="font-medium">${o}</span> trong tổng <span class="font-medium">${t}</span>
            </div>
            <div class="flex items-center gap-1">
                <button onclick="searchUserActivity(${n-1})" ${n===1?"disabled":""} class="px-3 py-2 rounded bg-white text-gray-700 hover:bg-gray-100 border text-sm disabled:opacity-50 disabled:cursor-not-allowed">← Trước</button>
                ${s}
                <button onclick="searchUserActivity(${n+1})" ${n===e?"disabled":""} class="px-3 py-2 rounded bg-white text-gray-700 hover:bg-gray-100 border text-sm disabled:opacity-50 disabled:cursor-not-allowed">Sau →</button>
            </div>
        </div>
    `}async function loadDashboard(){try{const n=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getDashboardStats"})})).json();if(n.success){const e=n.stats;console.log("📊 Revenue data:",e.revenueByDate),console.log("👥 User growth:",e.userGrowth),console.log("⭐ VIP distribution:",e.vipDistribution),e.revenueByDate&&e.revenueByDate.length>0&&(e.revenueByDate=e.revenueByDate.map(a=>({date:a.date||a.payment_date,revenue:a.revenue||a.daily_revenue})),console.log("✅ Normalized revenue data:",e.revenueByDate)),document.getElementById("totalUsers").textContent=e.totalUsers,document.getElementById("vipUsers").textContent=e.vipUsers,document.getElementById("totalRevenue").textContent=formatCurrency(e.totalRevenue),document.getElementById("totalOrders").textContent=e.orders.total,renderRevenueChart(e.revenueByDate),renderUserGrowthChart(e.userGrowth),renderVipDistributionChart(e.vipDistribution),renderOrderStatusChart(e.orders),renderRecentActivities(e.recentActivities)}}catch(t){console.error("Error loading dashboard:",t),showToast("Lỗi khi tải dashboard!","error")}}function renderRevenueChart(t){const n=document.getElementById("revenueChart").getContext("2d");if(charts.revenue&&charts.revenue.destroy(),!t||t.length===0){charts.revenue=new Chart(n,{type:"line",data:{labels:["Chưa có dữ liệu"],datasets:[{label:"Doanh thu (VNĐ)",data:[0],borderColor:"rgb(147, 51, 234)",backgroundColor:"rgba(147, 51, 234, 0.1)"}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1}}}});return}const e=t.map(a=>({date:a.date||a.payment_date,revenue:parseFloat(a.revenue||a.daily_revenue||0)})).reverse();console.log("🎨 Chart normalized data:",e),charts.revenue=new Chart(n,{type:"line",data:{labels:e.map(a=>{const r=new Date(a.date);return isNaN(r.getTime())?(console.error("❌ Invalid date:",a.date),"N/A"):r.toLocaleDateString("vi-VN",{day:"2-digit",month:"2-digit"})}),datasets:[{label:"Doanh thu (VNĐ)",data:e.map(a=>a.revenue),borderColor:"rgb(147, 51, 234)",backgroundColor:"rgba(147, 51, 234, 0.1)",tension:.4,fill:!0,pointRadius:4,pointHoverRadius:6}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1},tooltip:{callbacks:{label:function(a){return"Doanh thu: "+formatCurrency(a.parsed.y)}}}},scales:{y:{beginAtZero:!0,ticks:{callback:function(a){return a>=1e6?(a/1e6).toFixed(1)+"M":a>=1e3?(a/1e3).toFixed(0)+"K":a},maxTicksLimit:6}}}}})}function renderUserGrowthChart(t){const n=document.getElementById("userGrowthChart").getContext("2d");charts.userGrowth&&charts.userGrowth.destroy(),charts.userGrowth=new Chart(n,{type:"bar",data:{labels:t.map(e=>new Date(e.date).toLocaleDateString("vi-VN")),datasets:[{label:"Người dùng mới",data:t.map(e=>e.count),backgroundColor:"rgb(59, 130, 246)",borderRadius:4}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1}},scales:{y:{beginAtZero:!0,ticks:{stepSize:1}}}}})}function renderVipDistributionChart(t){const n=document.getElementById("vipDistributionChart").getContext("2d");charts.vipDistribution&&charts.vipDistribution.destroy();const e={"1day":"1 ngày","3days":"3 ngày","7days":"7 ngày","30days":"30 ngày",infinite:"Vĩnh viễn"};charts.vipDistribution=new Chart(n,{type:"pie",data:{labels:t.map(a=>e[a.plan_type]||a.plan_type),datasets:[{data:t.map(a=>a.count),backgroundColor:["rgb(59, 130, 246)","rgb(16, 185, 129)","rgb(251, 146, 60)","rgb(147, 51, 234)","rgb(236, 72, 153)"]}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{position:"bottom",labels:{boxWidth:12,padding:10,font:{size:11}}}}}})}function renderOrderStatusChart(t){const n=document.getElementById("orderStatusChart").getContext("2d");charts.orderStatus&&charts.orderStatus.destroy(),charts.orderStatus=new Chart(n,{type:"doughnut",data:{labels:["Đã thanh toán","Chưa thanh toán","Đã hủy"],datasets:[{data:[t.paid,t.unpaid,t.cancelled],backgroundColor:["rgb(16, 185, 129)","rgb(251, 146, 60)","rgb(239, 68, 68)"]}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{position:"bottom",labels:{boxWidth:12,padding:10,font:{size:11}}}}}})}function renderRecentActivities(t){const n=t.map(e=>`
        <div class="border-b border-gray-200 py-3 hover:bg-gray-50 transition-colors px-2 rounded">
            <div class="flex justify-between items-start gap-3">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${getActionColor(e.action)}">
                            ${getActionText(e.action)}
                        </span>
                        <span class="font-semibold text-gray-900 text-sm">${e.user_id||"System"}</span>
                        ${e.admin_id?`<span class="text-sm text-purple-600">👨‍💼 ${e.admin_id}</span>`:""}
                    </div>
                    ${e.details?`<p class="text-sm text-gray-700 mt-1 line-clamp-2">${e.details}</p>`:""}
                </div>
                <span class="text-xs text-gray-500 whitespace-nowrap">${new Date(e.created_at).toLocaleString("vi-VN",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
            </div>
        </div>
    `).join("");document.getElementById("recentActivitiesList").innerHTML=n||'<p class="text-gray-500 text-center py-4">Chưa có hoạt động nào</p>'}function formatCurrency(t){return new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND"}).format(t)}function renderVIPPlans(){const t=document.getElementById("vipPlansTableBody"),{currentPage:n,rowsPerPage:e}=pagination.vipPlans,a=paginateArray(allData.vipPlans,n,e);t.innerHTML=a.map(r=>`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${r.id}</td>
            <td class="px-6 py-4 font-mono text-sm bg-gray-50 text-gray-700" data-label="Key">${r.plan_key}</td>
            <td class="px-6 py-4" data-label="Tên">
                <div class="font-semibold text-gray-900">${r.plan_name}</div>
                ${r.description?`<div class="text-sm text-gray-600 mt-0.5">${r.description}</div>`:""}
            </td>
            <td class="px-6 py-4 text-center" data-label="Thời hạn">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">⏱️ ${r.duration_days} ngày</span>
            </td>
            <td class="px-6 py-4 font-bold text-green-600" data-label="Giá">${parseFloat(r.price).toLocaleString("vi-VN")}đ</td>
            <td class="px-6 py-4" data-label="Trạng thái">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${r.is_active?"bg-green-100 text-green-800":"bg-red-100 text-red-800"}">
                    ${r.is_active?"✅ Active":"❌ Disabled"}
                </span>
            </td>
            <td class="px-6 py-4 text-center" data-label="Thứ tự">
                <span class="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-semibold">#${r.sort_order}</span>
            </td>
            <td class="px-6 py-4 flex gap-2 flex-wrap" data-label="Actions">
                <button onclick="openEditPlanModal(${r.id})" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    ✏️ Sửa
                </button>
                <button onclick="togglePlanStatus(${r.id})" class="text-${r.is_active?"orange":"green"}-600 hover:text-${r.is_active?"orange":"green"}-800 font-semibold text-sm transition">
                    ${r.is_active?"⏸️ Tắt":"▶️ Bật"}
                </button>
                <button onclick="showConfirmModal('Xóa gói VIP', 'Bạn có chắc muốn xóa gói ${r.plan_name}? Hành động này không thể hoàn tác.', () => deletePlan(${r.id}))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
    `).join(""),renderPaginationControls("vipPlans",allData.vipPlans.length)}function openCreatePlanModal(){document.getElementById("planModalTitle").textContent="➕ Thêm gói VIP mới",document.getElementById("planId").value="",document.getElementById("planKey").value="",document.getElementById("planKey").disabled=!1,document.getElementById("planName").value="",document.getElementById("planDuration").value="",document.getElementById("planPrice").value="",document.getElementById("planSortOrder").value="0",document.getElementById("planDescription").value="",document.getElementById("planModal").classList.remove("hidden")}function openEditPlanModal(t){const n=allData.vipPlans.find(e=>e.id===t);n&&(document.getElementById("planModalTitle").textContent="✏️ Chỉnh sửa gói VIP",document.getElementById("planId").value=n.id,document.getElementById("planKey").value=n.plan_key,document.getElementById("planKey").disabled=!0,document.getElementById("planName").value=n.plan_name,document.getElementById("planDuration").value=n.duration_days,document.getElementById("planPrice").value=n.price,document.getElementById("planSortOrder").value=n.sort_order,document.getElementById("planDescription").value=n.description||"",document.getElementById("planModal").classList.remove("hidden"))}function closePlanModal(){document.getElementById("planModal").classList.add("hidden")}async function submitPlan(){const t=document.getElementById("planId").value,n=document.getElementById("planKey").value.trim(),e=document.getElementById("planName").value.trim(),a=parseInt(document.getElementById("planDuration").value),r=parseFloat(document.getElementById("planPrice").value),o=parseInt(document.getElementById("planSortOrder").value)||0,i=document.getElementById("planDescription").value.trim();if(!n||!e||!a||!r){showToast("Vui lòng điền đầy đủ các trường bắt buộc!","error");return}if(!/^[a-z0-9_]+$/.test(n)){showToast("Plan Key chỉ được chứa chữ thường, số và gạch dưới!","error");return}const s=document.getElementById("submitPlanBtn"),l=s.innerHTML;s.disabled=!0,s.innerHTML='<div class="loader inline-block"></div> Đang lưu...';try{const d=t?"updateVIPPlan":"createVIPPlan",c={planKey:n,planName:e,durationDays:a,price:r,sortOrder:o,description:i};t&&(c.id=parseInt(t));const u=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:d,payload:c})})).json();u.success?(showToast(u.message||(t?"Cập nhật thành công!":"Tạo gói VIP thành công!"),"success"),closePlanModal(),await refreshData("vipPlans")):showToast(u.message||"Có lỗi xảy ra!","error")}catch(d){showToast("Lỗi kết nối: "+d.message,"error")}finally{s.disabled=!1,s.innerHTML=l}}async function deletePlan(t){try{const e=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteVIPPlan",payload:{id:t}})})).json();e.success?(showToast("Xóa gói VIP thành công!","success"),await refreshData("vipPlans")):showToast(e.message||"Không thể xóa gói VIP!","error")}catch(n){showToast("Lỗi kết nối: "+n.message,"error")}}async function togglePlanStatus(t){try{const e=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"toggleVIPPlanStatus",payload:{id:t}})})).json();e.success?(showToast(e.message||"Cập nhật trạng thái thành công!","success"),await refreshData("vipPlans")):showToast(e.message||"Có lỗi xảy ra!","error")}catch(n){showToast("Lỗi kết nối: "+n.message,"error")}}
