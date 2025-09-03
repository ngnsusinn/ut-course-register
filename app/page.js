// app/page.js (Frontend main page)
"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dots, setDots] = useState([]);
  const [selectedDotId, setSelectedDotId] = useState(null);
  const [allData, setAllData] = useState([]);
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [registered, setRegistered] = useState([]);

  const login = async () => {
    try {
      if (!username || !password) {
        alert("Vui lòng nhập tên đăng nhập và mật khẩu");
        return;
      }

      const res = await fetch("/api/login", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.success && data.token) {
        setToken(data.token);
        fetchDots(data.token);
      } else {
        alert(data.error || "Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.");
      }
    } catch (error) {
      console.error("Login error:", error);
      alert("Có lỗi xảy ra khi đăng nhập. Vui lòng thử lại sau.");
    }
  };

  const fetchDots = async (tok) => {
    const res = await fetch("/api/dots", {
      headers: { Authorization: `Bearer ${tok || token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setDots(data);
      if (data.length > 0) setSelectedDotId(data[0].id);
    }
  };

  const fetchAllData = async () => {
    const res = await fetch(`/api/all_data?dot_id=${selectedDotId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setAllData(data);
    } else {
      alert("Failed to fetch data");
    }
  };

  const toggleSelect = (classId) => {
    setSelectedClasses((prev) =>
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId]
    );
  };

  const registerSelected = async () => {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ class_ids: selectedClasses }),
    });
    if (res.ok) {
      alert("Đăng ký thành công!");
      setSelectedClasses([]);
      fetchRegistered();
    } else {
      alert("Đăng ký thất bại");
    }
  };

  const fetchRegistered = async () => {
    const res = await fetch(`/api/registered?dot_id=${selectedDotId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setRegistered(data);
    }
  };

  const cancelReg = async (regId) => {
    const res = await fetch(`/api/cancel/${regId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      alert("Hủy thành công!");
      fetchRegistered();
    } else {
      alert("Hủy thất bại");
    }
  };

  useEffect(() => {
    if (token) fetchDots();
  }, [token]);

  if (!token) {
    return (
      <div>
        <h1>Đăng ký học phần</h1>
        <input
          type="text"
          placeholder="Tài khoản"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={login}>Đăng nhập</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Đăng ký học phần</h1>
      <h2>Chọn đợt</h2>
      <select
        value={selectedDotId}
        onChange={(e) => setSelectedDotId(e.target.value)}
      >
        {dots.map((dot) => (
          <option key={dot.id} value={dot.id}>
            {dot.tenHocKy}
          </option>
        ))}
      </select>
      <button onClick={fetchAllData}>Lấy lịch học</button>

      <h2>Lịch học</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Chọn</th>
            <th>Tên môn học</th>
            <th>Số tín chỉ</th>
            <th>Thứ</th>
            <th>Tiết học</th>
            <th>Ngày bắt đầu</th>
            <th>Mã lớp</th>
          </tr>
        </thead>
        <tbody>
          {allData.map((item, idx) => (
            item.schedules.map((schedule, sIdx) => (
              <tr key={`${idx}-${sIdx}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedClasses.includes(item.class.id)}
                    onChange={() => toggleSelect(item.class.id)}
                  />
                </td>
                <td>{item.subject.tenMonHoc}</td>
                <td>{item.subject.soTinChi}</td>
                <td>{schedule.thu || ""}</td>
                <td>{schedule.tietHoc || ""}</td>
                <td>
                  {schedule.ngayBatDau
                    ? new Date(schedule.ngayBatDau).toLocaleDateString()
                    : ""}
                </td>
                <td>{item.class.maLopHocPhan}</td>
              </tr>
            ))
          ))}
        </tbody>
      </table>

      <h2>Danh sách lớp đã chọn</h2>
      <ul>
        {selectedClasses.map((id) => (
          <li key={id}>Lớp ID: {id}</li>
        ))}
      </ul>
      <button onClick={registerSelected}>Đăng ký</button>

      <h2>Quản lý đăng ký</h2>
      <button onClick={fetchRegistered}>Lấy danh sách đã đăng ký</button>
      <ul>
        {registered.map((reg) => (
          <li key={reg.id}>
            {reg.tenMonHoc} (ID: {reg.id})
            <button onClick={() => cancelReg(reg.id)}>Hủy</button>
          </li>
        ))}
      </ul>
    </div>
  );
}