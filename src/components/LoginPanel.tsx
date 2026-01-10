'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSchedule } from '@/context/ScheduleContext';
import { useRegistered } from '@/context/RegisteredContext';

export default function LoginPanel() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [fetchConditionCourses, setFetchConditionCourses] = useState(true);
    const { login, logout, isLoggedIn, isLoading, error, profile, token } = useAuth();
    const { fetchSchedule, isLoading: scheduleLoading, loadingProgress } = useSchedule();
    const { fetchRegisteredClasses, isLoading: registeredLoading, loadingProgress: registeredProgress } = useRegistered();

    // Auto-fetch registered classes when logged in
    useEffect(() => {
        if (isLoggedIn && token) {
            fetchRegisteredClasses(token);
        }
    }, [isLoggedIn, token, fetchRegisteredClasses]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!username.trim() || !password.trim()) {
            return;
        }

        await login(username, password);
    };

    const handleLogout = async () => {
        await logout();
        setUsername('');
        setPassword('');
    };

    const handleReloadSchedule = async () => {
        if (token) {
            await fetchSchedule(token, fetchConditionCourses);
        }
    };

    // Get full name from profile
    const getFullName = () => {
        if (profile) {
            return `${profile.hoDem} ${profile.ten}`;
        }
        return 'Người dùng';
    };

    return (
        <div className="panel login-panel">
            <h3 className="panel-title">Bảng điều khiển</h3>

            {isLoggedIn ? (
                <div className="control-panel">
                    {/* Greeting */}
                    <p className="greeting">Xin chào, <strong>{getFullName()}</strong>!</p>

                    {/* VIP Status Card */}
                    <div className="vip-status-card">
                        <div className="vip-icon">⭐</div>
                        <div className="vip-info">
                            <span className="vip-title">Tài khoản VIP</span>
                            <span className="vip-days">Thời hạn còn lại: <strong>36436 ngày</strong></span>
                            <span className="vip-expire">Hết hạn vào ngày: 10/10/2125</span>
                        </div>
                    </div>

                    {/* Extend VIP Button */}
                    <button type="button" className="btn-extend-vip">
                        <span className="btn-icon">⭐</span>
                        Gia hạn VIP
                    </button>

                    {/* Toggle Condition Courses */}
                    <div className="toggle-row">
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={fetchConditionCourses}
                                onChange={(e) => setFetchConditionCourses(e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        <span className="toggle-label">Lấy dữ liệu môn điều kiện</span>
                    </div>

                    {/* Loading Progress */}
                    {(scheduleLoading || registeredLoading) && (
                        <div className="loading-progress">
                            <div className="loading-spinner"></div>
                            <span>{registeredLoading ? registeredProgress : loadingProgress}</span>
                        </div>
                    )}

                    {/* Reload Schedule Button */}
                    <button
                        type="button"
                        className="btn-reload-schedule"
                        onClick={handleReloadSchedule}
                        disabled={scheduleLoading}
                    >
                        <span className="btn-icon">{scheduleLoading ? '⏳' : '📋'}</span>
                        {scheduleLoading ? 'Đang tải...' : 'Tải lại lịch học'}
                    </button>

                    {/* Logout Button */}
                    <button type="button" className="btn-logout" onClick={handleLogout}>
                        Đăng xuất
                    </button>

                    {/* Security Warning */}
                    <div className="security-warning">
                        <p>
                            <strong>Cảnh báo bảo mật:</strong> Thông tin đăng nhập của bạn được dùng để lấy token.
                            Hãy sử dụng cẩn thận và đổi mật khẩu sau khi dùng nếu cần thiết.
                        </p>
                    </div>
                </div>
            ) : (
                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label htmlFor="username">Tên đăng nhập</label>
                        <input
                            type="text"
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Nhập tên đăng nhập..."
                            disabled={isLoading}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Mật khẩu</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Nhập mật khẩu..."
                            disabled={isLoading}
                        />
                    </div>

                    {error && (
                        <div className="error-message">
                            <span className="error-icon">❌</span>
                            <p>{error}</p>
                        </div>
                    )}

                    <button type="submit" className="btn-login" disabled={isLoading}>
                        {isLoading ? 'Đang đăng nhập...' : 'Đăng Nhập'}
                    </button>

                    <div className="security-warning">
                        <span className="warning-icon">⚠️</span>
                        <p>
                            <strong>Lưu ý bảo mật:</strong> Thông tin đăng nhập của bạn chỉ được sử dụng để lấy token xác thực.
                            Chúng tôi khuyến nghị bạn đổi mật khẩu sau khi sử dụng công cụ này.
                        </p>
                    </div>
                </form>
            )}
        </div>
    );
}
