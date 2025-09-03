let token = '';
let selectedClasses = [];
let currentDotId = null;

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (res.ok) {
        const data = await res.json();
        token = data.token;
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        fetchDots();
    } else {
        alert('Login failed');
    }
}

async function fetchDots() {
    const res = await fetch('/api/dots', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
        const dots = await res.json();
        const select = document.getElementById('dot-select');
        select.innerHTML = '';
        dots.forEach(dot => {
            const option = document.createElement('option');
            option.value = dot.id;
            option.textContent = dot.tenHocKy;
            select.appendChild(option);
        });
    }
}

async function fetchData() {
    currentDotId = document.getElementById('dot-select').value;
    const res = await fetch(`/api/all_data/${currentDotId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
        const data = await res.json();
        renderTable(data);
    } else {
        alert('Failed to fetch data');
    }
}

function renderTable(data) {
    const tbody = document.querySelector('#schedule-table tbody');
    tbody.innerHTML = '';
    data.forEach(item => {
        const subject = item.subject;
        const cls = item.class;
        item.schedules.forEach(schedule => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="checkbox" data-class-id="${cls.id}" onchange="toggleSelect(${cls.id})"></td>
                <td>${subject.tenMonHoc}</td>
                <td>${subject.soTinChi}</td>
                <td>${schedule.thu || ''}</td>
                <td>${schedule.tietHoc || ''}</td>
                <td>${schedule.ngayBatDau ? new Date(schedule.ngayBatDau).toLocaleDateString() : ''}</td>
                <td>${cls.maLopHocPhan}</td>
            `;
            tbody.appendChild(row);
        });
    });
}

function toggleSelect(classId) {
    if (selectedClasses.includes(classId)) {
        selectedClasses = selectedClasses.filter(id => id !== classId);
    } else {
        selectedClasses.push(classId);
    }
    renderSelectedList();
}

function renderSelectedList() {
    const ul = document.getElementById('selected-list');
    ul.innerHTML = '';
    selectedClasses.forEach(id => {
        const li = document.createElement('li');
        li.textContent = `Lớp ID: ${id}`;
        ul.appendChild(li);
    });
}

async function registerSelected() {
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ class_ids: selectedClasses })
    });
    if (res.ok) {
        alert('Đăng ký thành công!');
        selectedClasses = [];
        renderSelectedList();
    } else {
        alert('Đăng ký thất bại');
    }
}

async function fetchRegistered() {
    const res = await fetch(`/api/registered/${currentDotId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
        const registered = await res.json();
        const ul = document.getElementById('registered-list');
        ul.innerHTML = '';
        registered.forEach(reg => {
            const li = document.createElement('li');
            li.textContent = `${reg.tenMonHoc} (ID: ${reg.id})`;
            const btn = document.createElement('button');
            btn.textContent = 'Hủy';
            btn.onclick = () => cancelReg(reg.id);
            li.appendChild(btn);
            ul.appendChild(li);
        });
    }
}

async function cancelReg(regId) {
    const res = await fetch(`/api/cancel/${regId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
        alert('Hủy thành công!');
        fetchRegistered();
    } else {
        alert('Hủy thất bại');
    }
}