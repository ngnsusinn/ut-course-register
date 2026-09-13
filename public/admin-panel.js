const API_URL="/api/admin-handler";let currentUser=null,allData={users:[],subscriptions:[],orders:[],transactions:[],vipPlans:[]},pagination={users:{currentPage:1,rowsPerPage:20},vipPlans:{currentPage:1,rowsPerPage:20},subscriptions:{currentPage:1,rowsPerPage:20},orders:{currentPage:1,rowsPerPage:20},transactions:{currentPage:1,rowsPerPage:20}},charts={revenue:null,userGrowth:null,vipDistribution:null,orderStatus:null};typeof Chart<"u"&&(Chart.defaults.animation=!1,Chart.defaults.animations={colors:!1,x:!1},Chart.defaults.transitions={active:{animation:{duration:0}}},Chart.defaults.hover.animationDuration=0,Chart.defaults.plugins.tooltip.animation=!1);async function login(){const t=document.getElementById("username").value.trim(),n=document.getElementById("password").value.trim(),e=document.querySelector("#loginScreen button"),a=document.getElementById("loginError");if(!t||!n){showToast("Vui lòng nhập đầy đủ thông tin!","error"),a.classList.remove("hidden"),a.textContent="Vui lòng nhập đầy đủ thông tin!";return}const o=e.innerHTML;e.disabled=!0,e.innerHTML='<div class="loader"></div> Đang đăng nhập...';try{const d=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"login",payload:{username:t,password:n}})})).json();d.success?(currentUser=d.admin,localStorage.setItem("adminSession",JSON.stringify({username:currentUser.username,password:n,loginTime:new Date().getTime()})),document.getElementById("adminUsername").textContent=currentUser.username,showToast("Đăng nhập thành công!","success"),document.getElementById("loginScreen").classList.add("hidden"),document.getElementById("adminDashboard").classList.remove("hidden"),await refreshData("dashboard")):(showToast(d.message||"Đăng nhập thất bại!","error"),a.textContent=d.message||"Đăng nhập thất bại!",a.classList.remove("hidden"))}catch(r){showToast("Lỗi kết nối: "+r.message,"error"),a.textContent="Lỗi kết nối: "+r.message,a.classList.remove("hidden")}finally{e.disabled=!1,e.innerHTML=o}}async function autoLogin(){const t=localStorage.getItem("adminSession");if(!t)return!1;try{const{username:n,password:e,loginTime:a}=JSON.parse(t),o=24*60*60*1e3;if(new Date().getTime()-a>o)return localStorage.removeItem("adminSession"),!1;const d=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"login",payload:{username:n,password:e}})})).json();return d.success?(currentUser=d.admin,document.getElementById("adminUsername").textContent=currentUser.username,localStorage.setItem("adminSession",JSON.stringify({username:n,password:e,loginTime:new Date().getTime()})),document.getElementById("loginScreen").classList.add("hidden"),document.getElementById("adminDashboard").classList.remove("hidden"),await refreshData("dashboard"),!0):(localStorage.removeItem("adminSession"),!1)}catch(n){return console.error("Auto-login failed:",n),localStorage.removeItem("adminSession"),!1}}function showToast(t,n="info"){const e=document.getElementById("inPageToast");e&&e.remove();const a=document.createElement("div");a.id="inPageToast",a.className=`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${n==="success"?"bg-green-500 text-white":n==="error"?"bg-red-500 text-white":"bg-blue-500 text-white"}`;const o=n==="success"?"✅":n==="error"?"❌":"ℹ️";a.innerHTML=`
        <span class="text-lg">${o}</span>
        <span class="font-medium">${t}</span>
    `,document.body.appendChild(a),setTimeout(()=>a.remove(),3e3)}function paginateArray(t,n,e){const a=(n-1)*e,o=a+e;return t.slice(a,o)}function getTotalPages(t,n){return Math.ceil(t/n)}function changePage(t,n){pagination[t].currentPage=n,renderTable(t)}function renderPaginationControls(t,n){const e=document.getElementById(`${t}Pagination`);if(!e)return;const{currentPage:a,rowsPerPage:o}=pagination[t],r=getTotalPages(n,o);if(r<=1){e.innerHTML="";return}const d=(a-1)*o+1,s=Math.min(a*o,n);e.innerHTML=`
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
                    ${a===r?"disabled":""}
                    class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    Sau
                </button>
            </div>
            <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm text-gray-700">
                        Hiển thị <span class="font-medium">${d}</span> đến <span class="font-medium">${s}</span> trong tổng số <span class="font-medium">${n}</span> kết quả
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
                        ${generatePageNumbers(t,a,r)}
                        <button 
                            onclick="changePage('${t}', ${a+1})" 
                            ${a===r?"disabled":""}
                            class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span class="sr-only">Sau</span>
                            →
                        </button>
                    </nav>
                </div>
            </div>
        </div>
    `}function generatePageNumbers(t,n,e){let a=[];if(e<=5)for(let r=1;r<=e;r++)a.push(r);else n<=3?a=[1,2,3,4,"...",e]:n>=e-2?a=[1,"...",e-3,e-2,e-1,e]:a=[1,"...",n-1,n,n+1,"...",e];return a.map(r=>r==="..."?'<span class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">...</span>':`
            <button 
                onclick="changePage('${t}', ${r})" 
                class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium ${r===n?"z-10 bg-blue-50 border-blue-500 text-blue-600":"bg-white text-gray-700 hover:bg-gray-50"}">
                ${r}
            </button>
        `).join("")}function logout(){currentUser=null,localStorage.removeItem("adminSession"),document.getElementById("loginScreen").classList.remove("hidden"),document.getElementById("adminDashboard").classList.add("hidden"),document.getElementById("username").value="",document.getElementById("password").value="",document.getElementById("loginError").classList.add("hidden"),showToast("Đã đăng xuất thành công","success")}function switchTab(t){document.querySelectorAll(".tab-btn").forEach(a=>{a.classList.remove("tab-active"),a.classList.add("text-gray-600")}),document.querySelectorAll(".tab-content").forEach(a=>a.classList.add("hidden"));const n=document.querySelector(`[data-tab="${t}"]`);n&&(n.classList.add("tab-active"),n.classList.remove("text-gray-600"));const e=document.getElementById("mobileTabSelect");e&&(e.value=t),document.getElementById(`${t}Tab`).classList.remove("hidden"),refreshData(t)}function filterOrderById(t){switchTab("orders"),setTimeout(()=>{const n=document.getElementById("ordersSearch");n&&(document.getElementById("ordersFilter").value="",n.value=`#${t}`,renderOrders(),document.getElementById("ordersTab").scrollIntoView({behavior:"smooth",block:"start"}))},300)}function filterOrderByCode(t){switchTab("orders"),setTimeout(()=>{const n=document.getElementById("ordersSearch");n&&(document.getElementById("ordersFilter").value="",n.value=t,renderOrders(),document.getElementById("ordersTab").scrollIntoView({behavior:"smooth",block:"start"}))},300)}async function refreshData(t){if(t==="dashboard"){await loadDashboard();return}let n=t==="vipPlans"?"getAllVIPPlans":`getAll${t.charAt(0).toUpperCase()+t.slice(1)}`;const e=document.querySelector(`#${t}Tab button[onclick*="refreshData"]`);if(e){const a=e.innerHTML;e.disabled=!0,e.innerHTML='<div class="loader"></div> Đang tải...'}try{const o=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:n})})).json();if(o.success){const r=t==="vipPlans"?"plans":t;allData[t]=o[r]||[],renderTable(t)}else console.error(`Error fetching ${t}:`,o.message),showToast(`Lỗi tải dữ liệu: ${o.message}`,"error")}catch(a){console.error(`Error fetching ${t}:`,a),showToast(`Lỗi kết nối: ${a.message}`,"error")}finally{e&&(e.disabled=!1,e.innerHTML=e.getAttribute("data-original-html")||"🔄 Refresh",e.getAttribute("data-original-html")||e.setAttribute("data-original-html","🔄 Refresh"))}}function renderTable(t){switch(t){case"users":renderUsers();break;case"vipPlans":renderVIPPlans();break;case"subscriptions":renderSubscriptions();break;case"orders":renderOrders();break;case"transactions":renderTransactions();break}}function renderUsers(){const t=document.getElementById("usersTableBody"),n=document.getElementById("usersSearch").value.toLowerCase(),e=allData.users.filter(i=>i.user_id.toLowerCase().includes(n)),{currentPage:a,rowsPerPage:o}=pagination.users,r=paginateArray(e,a,o);t.innerHTML=r.map(i=>{const c=i.is_vip,m=i.expiry_date?new Date(i.expiry_date):null,u=m&&m<new Date;return`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${i.id||""}</td>
            <td class="px-6 py-4" data-label="User Info">
                <div class="font-semibold text-gray-900">${i.user_id}</div>
                ${i.username?`<div class="text-xs text-gray-500 font-mono mt-0.5">@${i.username}</div>`:""}
                ${i.full_name?`<div class="text-sm text-gray-600 mt-0.5">${i.full_name}</div>`:""}
                ${i.email?`<div class="text-sm text-gray-500 mt-0.5">📧 ${i.email}</div>`:""}
            </td>
            <td class="px-6 py-4" data-label="Active">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${i.is_active?"bg-green-100 text-green-800":"bg-gray-100 text-gray-800"}">
                    ${i.is_active?"✅ Active":"❌ Inactive"}
                </span>
            </td>
            <td class="px-6 py-4" data-label="VIP Status">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${c&&!u?"bg-green-100 text-green-800":"bg-gray-100 text-gray-800"}">
                    ${c&&!u?"✅ VIP Active":"❌ No VIP"}
                </span>
            </td>
            <td class="px-6 py-4" data-label="Expiry">
                ${m?`
                    <div class="${u?"text-red-600":"text-green-600"} font-semibold text-sm">
                        ${formatDateTime(m)}
                    </div>
                `:'<span class="text-gray-400 text-sm">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Last Login">
                ${i.last_login?formatDateTime(i.last_login):'<span class="text-gray-400">N/A</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Created">${i.created_at?formatDateTime(i.created_at):"N/A"}</td>
            <td class="px-6 py-4 text-sm text-gray-600" data-label="Updated">${i.updated_at?formatDateTime(i.updated_at):"N/A"}</td>
            <td class="px-6 py-4 flex gap-2" data-label="Actions">
                <button onclick="openAddVIPModal('${i.user_id}')" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    ➕ Thêm VIP
                </button>
                <button onclick="showConfirmModal('Xóa User', 'Bạn có chắc muốn xóa user này không? Mọi dữ liệu liên quan sẽ bị xóa.', () => deleteUser('${i.user_id}'))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
        `}).join("");const d=e.length,s=e.filter(i=>i.is_vip&&new Date(i.expiry_date)>new Date).length,l=e.filter(i=>i.expiry_date&&new Date(i.expiry_date)<new Date).length;document.getElementById("usersStats").innerHTML=`
        <div class="bg-blue-50 p-4 rounded-lg text-center">
            <div class="text-2xl font-bold text-blue-600">${d}</div>
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
    `,renderPaginationControls("users",d)}function renderSubscriptions(){const t=document.getElementById("subscriptionsTableBody"),n=document.getElementById("subscriptionsSearch").value.toLowerCase(),e=document.getElementById("subscriptionsFilter").value,a=allData.subscriptions.filter(s=>{const l=s.user_id.toLowerCase().includes(n)||s.plan_type.toLowerCase().includes(n),i=new Date(s.expiry_date)>new Date;return l&&(!e||e==="active"&&i||e==="expired"&&!i)}),{currentPage:o,rowsPerPage:r}=pagination.subscriptions,d=paginateArray(a,o,r);t.innerHTML=d.map(s=>{const l=new Date(s.expiry_date)>new Date,i=s.created_by_admin?`👨‍💼 Admin (${s.created_by_admin})`:"👤 User",c=s.order_code?`<a href="#orders" onclick="filterOrderByCode('${s.order_code}')" class="text-blue-600 hover:text-blue-800 font-semibold font-mono text-sm transition">${s.order_code}</a>`:'<span class="text-purple-600 font-semibold text-sm">👨‍💼 Admin</span>';return`
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
                ${i}
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
        `}).join(""),renderPaginationControls("subscriptions",a.length)}function renderOrders(){const t=document.getElementById("ordersTableBody"),n=document.getElementById("ordersSearch").value.toLowerCase(),e=document.getElementById("ordersFilter").value,a=allData.orders.filter(s=>{const l=s.user_id.toLowerCase().includes(n)||s.plan_name.toLowerCase().includes(n)||s.order_code&&s.order_code.toLowerCase().includes(n),i=!e||s.payment_status===e;return l&&i}),{currentPage:o,rowsPerPage:r}=pagination.orders,d=paginateArray(a,o,r);t.innerHTML=d.map(s=>{const l=s.cancelled_at!==null&&s.cancelled_at!==void 0,i=s.payment_status==="Paid";return`
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
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${l?"bg-red-100 text-red-800":i?"bg-green-100 text-green-800":"bg-yellow-100 text-yellow-800"}">
                    ${l?"❌ Cancelled":i?"✅ Paid":"⏳ Unpaid"}
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
    `}).join(""),renderPaginationControls("orders",a.length)}function renderTransactions(){const t=document.getElementById("transactionsTableBody"),n=document.getElementById("transactionsSearch").value.toLowerCase(),e=document.getElementById("amountFilter").value,a=allData.transactions.filter(s=>{const l=s.reference_number?.toLowerCase().includes(n)||s.transaction_content?.toLowerCase().includes(n),i=!e||parseFloat(s.amount_in)===parseFloat(e);return l&&i}),{currentPage:o,rowsPerPage:r}=pagination.transactions,d=paginateArray(a,o,r);t.innerHTML=d.map(s=>{const l=s.order_code?`<a href="#orders" onclick="filterOrderByCode('${s.order_code}')" class="text-blue-600 hover:text-blue-800 font-semibold font-mono text-sm transition">${s.order_code}</a>`:'<span class="text-gray-400 text-sm">N/A</span>';return`
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
    `}).join(""),renderPaginationControls("transactions",a.length)}async function openAddVIPModal(t=""){document.getElementById("vipUserId").value=t,await loadVIPPlansForModal(),document.getElementById("addVIPModal").classList.remove("hidden")}async function loadVIPPlansForModal(){const t=document.getElementById("vipPlanType");try{t.innerHTML='<option value="">Đang tải gói VIP...</option>',t.disabled=!0;const e=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getAllVIPPlans"})})).json();if(e.success&&e.plans){t.innerHTML="";const a=e.plans.sort((o,r)=>(o.sort_order||0)-(r.sort_order||0));if(a.length===0){t.innerHTML='<option value="">Chưa có gói VIP nào trong hệ thống</option>',showToast("Chưa có gói VIP nào. Vui lòng tạo gói VIP trong tab VIP Plans","warning");return}a.forEach(o=>{const r=document.createElement("option");r.value=o.plan_key;const d=o.duration_days===36500?"Vĩnh viễn":`${o.duration_days} ngày`,s=o.is_active===1?"✅":"🔴";r.textContent=`${s} ${o.plan_name} (${d}) - ${parseFloat(o.price).toLocaleString("vi-VN")}đ`,r.setAttribute("data-duration",o.duration_days),r.setAttribute("data-price",o.price),r.setAttribute("data-active",o.is_active),t.appendChild(r)}),t.disabled=!1}else t.innerHTML='<option value="">Lỗi tải dữ liệu</option>',showToast("Không thể tải danh sách gói VIP từ database","error")}catch(n){console.error("Error loading VIP plans:",n),t.innerHTML='<option value="">Lỗi kết nối</option>',showToast("Lỗi kết nối đến server","error")}}function closeAddVIPModal(){document.getElementById("addVIPModal").classList.add("hidden")}async function submitAddVIP(){const t=document.getElementById("vipUserId").value.trim(),n=document.getElementById("vipPlanType").value,e=document.getElementById("submitVIPBtn");if(!t){showToast("Vui lòng nhập User ID!","error");return}const a=e.innerHTML;e.disabled=!0,e.innerHTML='<div class="loader"></div> Đang xử lý...';try{const r=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"addVIPSubscription",payload:{userId:t,planType:n}})})).json();r.success?(showToast("✅ Đã thêm VIP thành công!","success"),closeAddVIPModal(),await Promise.all([refreshData("users"),refreshData("subscriptions")])):showToast("Lỗi: "+r.message,"error")}catch(o){showToast("Lỗi kết nối: "+o.message,"error")}finally{e.disabled=!1,e.innerHTML=a}}function formatDateTime(t){return new Date(t).toLocaleString("vi-VN",{timeZone:"Asia/Bangkok"})}function showConfirmModal(t,n,e){document.getElementById("confirmTitle").textContent=t,document.getElementById("confirmMessage").textContent=n,document.getElementById("confirmActionBtn").onclick=()=>{closeConfirmModal(),e()},document.getElementById("confirmModal").classList.remove("hidden")}function closeConfirmModal(){document.getElementById("confirmModal").classList.add("hidden")}async function deleteUser(t){const n=document.querySelector(`button[onclick*="deleteUser('${t}')"]`),e=n.innerHTML;n.disabled=!0,n.innerHTML='<div class="loader"></div>';try{const o=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteUser",payload:{userId:t}})})).json();o.success?(showToast("✅ Đã xóa user thành công!","success"),await Promise.all([refreshData("users"),refreshData("subscriptions")])):showToast("Lỗi: "+o.message,"error")}catch(a){showToast("Lỗi kết nối: "+a.message,"error")}finally{n.disabled=!1,n.innerHTML=e}}async function deleteSubscription(t){const n=document.querySelector(`button[onclick*="deleteSubscription(${t})"]`),e=n.innerHTML;n.disabled=!0,n.innerHTML='<div class="loader"></div>';try{const o=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteSubscription",payload:{subscriptionId:t}})})).json();o.success?(showToast("✅ Đã xóa subscription!","success"),await Promise.all([refreshData("subscriptions"),refreshData("users")])):showToast("Lỗi: "+o.message,"error")}catch(a){showToast("Lỗi kết nối: "+a.message,"error")}finally{n.disabled=!1,n.innerHTML=e}}document.addEventListener("DOMContentLoaded",async function(){await autoLogin()||document.getElementById("loginScreen").classList.remove("hidden");const n=["usersSearch","subscriptionsSearch","ordersSearch","transactionsSearch","logsSearch"],e=["subscriptionsFilter","ordersFilter","logsFilter","amountFilter"];n.forEach(o=>{const r=document.getElementById(o);r&&r.addEventListener("input",debounce(()=>{const d=o.replace("Search","");renderTable(d)},300))}),e.forEach(o=>{const r=document.getElementById(o);r&&r.addEventListener("change",()=>{let d=o.replace("Filter","");o==="amountFilter"&&(d="transactions"),renderTable(d)})});const a=document.getElementById("password");a&&a.addEventListener("keydown",o=>{o.key==="Enter"&&login()})});function debounce(t,n){let e;return function(...o){const r=()=>{clearTimeout(e),t(...o)};clearTimeout(e),e=setTimeout(r,n)}}async function loadDashboard(){try{const n=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"getDashboardStats"})})).json();if(n.success){const e=n.stats;console.log("📊 Revenue data:",e.revenueByDate),console.log("👥 User growth:",e.userGrowth),console.log("⭐ VIP distribution:",e.vipDistribution),e.revenueByDate&&e.revenueByDate.length>0&&(e.revenueByDate=e.revenueByDate.map(a=>({date:a.date||a.payment_date,revenue:a.revenue||a.daily_revenue})),console.log("✅ Normalized revenue data:",e.revenueByDate)),document.getElementById("totalUsers").textContent=e.totalUsers,document.getElementById("vipUsers").textContent=e.vipUsers,document.getElementById("totalRevenue").textContent=formatCurrency(e.totalRevenue),document.getElementById("totalOrders").textContent=e.orders.total,renderRevenueChart(e.revenueByDate),renderUserGrowthChart(e.userGrowth),renderVipDistributionChart(e.vipDistribution),renderOrderStatusChart(e.orders)}}catch(t){console.error("Error loading dashboard:",t),showToast("Lỗi khi tải dashboard!","error")}}function renderRevenueChart(t){const n=document.getElementById("revenueChart").getContext("2d");if(charts.revenue&&charts.revenue.destroy(),!t||t.length===0){charts.revenue=new Chart(n,{type:"line",data:{labels:["Chưa có dữ liệu"],datasets:[{label:"Doanh thu (VNĐ)",data:[0],borderColor:"rgb(147, 51, 234)",backgroundColor:"rgba(147, 51, 234, 0.1)"}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1}}}});return}const e=t.map(a=>({date:a.date||a.payment_date,revenue:parseFloat(a.revenue||a.daily_revenue||0)})).reverse();console.log("🎨 Chart normalized data:",e),charts.revenue=new Chart(n,{type:"line",data:{labels:e.map(a=>{const o=new Date(a.date);return isNaN(o.getTime())?(console.error("❌ Invalid date:",a.date),"N/A"):o.toLocaleDateString("vi-VN",{day:"2-digit",month:"2-digit"})}),datasets:[{label:"Doanh thu (VNĐ)",data:e.map(a=>a.revenue),borderColor:"rgb(147, 51, 234)",backgroundColor:"rgba(147, 51, 234, 0.1)",tension:.4,fill:!0,pointRadius:4,pointHoverRadius:6}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1},tooltip:{callbacks:{label:function(a){return"Doanh thu: "+formatCurrency(a.parsed.y)}}}},scales:{y:{beginAtZero:!0,ticks:{callback:function(a){return a>=1e6?(a/1e6).toFixed(1)+"M":a>=1e3?(a/1e3).toFixed(0)+"K":a},maxTicksLimit:6}}}}})}function renderUserGrowthChart(t){const n=document.getElementById("userGrowthChart").getContext("2d");charts.userGrowth&&charts.userGrowth.destroy(),charts.userGrowth=new Chart(n,{type:"bar",data:{labels:t.map(e=>new Date(e.date).toLocaleDateString("vi-VN")),datasets:[{label:"Người dùng mới",data:t.map(e=>e.count),backgroundColor:"rgb(59, 130, 246)",borderRadius:4}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1}},scales:{y:{beginAtZero:!0,ticks:{stepSize:1}}}}})}function renderVipDistributionChart(t){const n=document.getElementById("vipDistributionChart").getContext("2d");charts.vipDistribution&&charts.vipDistribution.destroy();const e={"1day":"1 ngày","3days":"3 ngày","7days":"7 ngày","30days":"30 ngày",infinite:"Vĩnh viễn"};charts.vipDistribution=new Chart(n,{type:"pie",data:{labels:t.map(a=>e[a.plan_type]||a.plan_type),datasets:[{data:t.map(a=>a.count),backgroundColor:["rgb(59, 130, 246)","rgb(16, 185, 129)","rgb(251, 146, 60)","rgb(147, 51, 234)","rgb(236, 72, 153)"]}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{position:"bottom",labels:{boxWidth:12,padding:10,font:{size:11}}}}}})}function renderOrderStatusChart(t){const n=document.getElementById("orderStatusChart").getContext("2d");charts.orderStatus&&charts.orderStatus.destroy(),charts.orderStatus=new Chart(n,{type:"doughnut",data:{labels:["Đã thanh toán","Chưa thanh toán","Đã hủy"],datasets:[{data:[t.paid,t.unpaid,t.cancelled],backgroundColor:["rgb(16, 185, 129)","rgb(251, 146, 60)","rgb(239, 68, 68)"]}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{position:"bottom",labels:{boxWidth:12,padding:10,font:{size:11}}}}}})}function formatCurrency(t){return new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND"}).format(t)}function renderVIPPlans(){const t=document.getElementById("vipPlansTableBody"),{currentPage:n,rowsPerPage:e}=pagination.vipPlans,a=paginateArray(allData.vipPlans,n,e);t.innerHTML=a.map(o=>`
        <tr class="hover:bg-blue-50 transition-colors">
            <td class="px-6 py-4 font-semibold text-gray-700" data-label="ID">#${o.id}</td>
            <td class="px-6 py-4 font-mono text-sm bg-gray-50 text-gray-700" data-label="Key">${o.plan_key}</td>
            <td class="px-6 py-4" data-label="Tên">
                <div class="font-semibold text-gray-900">${o.plan_name}</div>
                ${o.description?`<div class="text-sm text-gray-600 mt-0.5">${o.description}</div>`:""}
            </td>
            <td class="px-6 py-4 text-center" data-label="Thời hạn">
                <span class="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-semibold">⏱️ ${o.duration_days} ngày</span>
            </td>
            <td class="px-6 py-4 font-bold text-green-600" data-label="Giá">${parseFloat(o.price).toLocaleString("vi-VN")}đ</td>
            <td class="px-6 py-4" data-label="Trạng thái">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${o.is_active?"bg-green-100 text-green-800":"bg-red-100 text-red-800"}">
                    ${o.is_active?"✅ Active":"❌ Disabled"}
                </span>
            </td>
            <td class="px-6 py-4 text-center" data-label="Thứ tự">
                <span class="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-semibold">#${o.sort_order}</span>
            </td>
            <td class="px-6 py-4 flex gap-2 flex-wrap" data-label="Actions">
                <button onclick="openEditPlanModal(${o.id})" class="text-blue-600 hover:text-blue-800 font-semibold text-sm transition">
                    ✏️ Sửa
                </button>
                <button onclick="togglePlanStatus(${o.id})" class="text-${o.is_active?"orange":"green"}-600 hover:text-${o.is_active?"orange":"green"}-800 font-semibold text-sm transition">
                    ${o.is_active?"⏸️ Tắt":"▶️ Bật"}
                </button>
                <button onclick="showConfirmModal('Xóa gói VIP', 'Bạn có chắc muốn xóa gói ${o.plan_name}? Hành động này không thể hoàn tác.', () => deletePlan(${o.id}))" class="text-red-600 hover:text-red-800 font-semibold text-sm transition">
                    🗑️ Xóa
                </button>
            </td>
        </tr>
    `).join(""),renderPaginationControls("vipPlans",allData.vipPlans.length)}function openCreatePlanModal(){document.getElementById("planModalTitle").textContent="➕ Thêm gói VIP mới",document.getElementById("planId").value="",document.getElementById("planKey").value="",document.getElementById("planKey").disabled=!1,document.getElementById("planName").value="",document.getElementById("planDuration").value="",document.getElementById("planPrice").value="",document.getElementById("planSortOrder").value="0",document.getElementById("planDescription").value="",document.getElementById("planModal").classList.remove("hidden")}function openEditPlanModal(t){const n=allData.vipPlans.find(e=>e.id===t);n&&(document.getElementById("planModalTitle").textContent="✏️ Chỉnh sửa gói VIP",document.getElementById("planId").value=n.id,document.getElementById("planKey").value=n.plan_key,document.getElementById("planKey").disabled=!0,document.getElementById("planName").value=n.plan_name,document.getElementById("planDuration").value=n.duration_days,document.getElementById("planPrice").value=n.price,document.getElementById("planSortOrder").value=n.sort_order,document.getElementById("planDescription").value=n.description||"",document.getElementById("planModal").classList.remove("hidden"))}function closePlanModal(){document.getElementById("planModal").classList.add("hidden")}async function submitPlan(){const t=document.getElementById("planId").value,n=document.getElementById("planKey").value.trim(),e=document.getElementById("planName").value.trim(),a=parseInt(document.getElementById("planDuration").value),o=parseFloat(document.getElementById("planPrice").value),r=parseInt(document.getElementById("planSortOrder").value)||0,d=document.getElementById("planDescription").value.trim();if(!n||!e||!a||!o){showToast("Vui lòng điền đầy đủ các trường bắt buộc!","error");return}if(!/^[a-z0-9_]+$/.test(n)){showToast("Plan Key chỉ được chứa chữ thường, số và gạch dưới!","error");return}const s=document.getElementById("submitPlanBtn"),l=s.innerHTML;s.disabled=!0,s.innerHTML='<div class="loader inline-block"></div> Đang lưu...';try{const i=t?"updateVIPPlan":"createVIPPlan",c={planKey:n,planName:e,durationDays:a,price:o,sortOrder:r,description:d};t&&(c.id=parseInt(t));const u=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:i,payload:c})})).json();u.success?(showToast(u.message||(t?"Cập nhật thành công!":"Tạo gói VIP thành công!"),"success"),closePlanModal(),await refreshData("vipPlans")):showToast(u.message||"Có lỗi xảy ra!","error")}catch(i){showToast("Lỗi kết nối: "+i.message,"error")}finally{s.disabled=!1,s.innerHTML=l}}async function deletePlan(t){try{const e=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"deleteVIPPlan",payload:{id:t}})})).json();e.success?(showToast("Xóa gói VIP thành công!","success"),await refreshData("vipPlans")):showToast(e.message||"Không thể xóa gói VIP!","error")}catch(n){showToast("Lỗi kết nối: "+n.message,"error")}}async function togglePlanStatus(t){try{const e=await(await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"toggleVIPPlanStatus",payload:{id:t}})})).json();e.success?(showToast(e.message||"Cập nhật trạng thái thành công!","success"),await refreshData("vipPlans")):showToast(e.message||"Có lỗi xảy ra!","error")}catch(n){showToast("Lỗi kết nối: "+n.message,"error")}}
