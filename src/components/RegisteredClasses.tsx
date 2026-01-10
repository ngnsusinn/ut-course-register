'use client';

import { useAuth } from '@/context/AuthContext';
import { useRegistered } from '@/context/RegisteredContext';

export default function RegisteredClasses() {
    const { isLoggedIn, token } = useAuth();
    const { registeredClasses, isLoading, totalCredits, totalFee, fetchRegisteredClasses } = useRegistered();

    const handleRefresh = async () => {
        if (token) {
            await fetchRegisteredClasses(token);
        }
    };

    // Helper to get day name
    const getDayName = (thu: number) => {
        const days = ['', 'CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
        return days[thu] || `T${thu}`;
    };

    // Format currency
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('vi-VN').format(amount);
    };

    return (
        <div className="panel registered-classes">
            <div className="panel-header">
                <h3 className="panel-title">✅ Lớp đã đăng ký</h3>
                <div className="panel-actions">
                    {registeredClasses.length > 0 && (
                        <span className="summary-badge">
                            {totalCredits} TC | {formatCurrency(totalFee)}đ
                        </span>
                    )}
                    <button className="btn-refresh" onClick={handleRefresh} disabled={isLoading}>
                        🔄 {isLoading ? 'Đang tải...' : 'Làm mới'}
                    </button>
                </div>
            </div>
            <div className="classes-content">
                {!isLoggedIn ? (
                    <div className="empty-state">
                        <span className="empty-icon">🔒</span>
                        <p>Vui lòng đăng nhập để xem lớp đã đăng ký</p>
                    </div>
                ) : isLoading ? (
                    <div className="empty-state">
                        <span className="empty-icon">⏳</span>
                        <p>Đang tải dữ liệu...</p>
                    </div>
                ) : registeredClasses.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📋</span>
                        <p>Chưa có lớp nào được đăng ký</p>
                    </div>
                ) : (
                    <div className="registered-list">
                        {registeredClasses.map((cls) => (
                            <div key={cls.id} className="registered-card">
                                <div className="registered-card-body">
                                    <div className="registered-card-content">
                                        <div className="registered-header">
                                            <span className="class-code">{cls.maLopHocPhan}</span>
                                            <span className={`class-status ${cls.isAllowCancel ? 'status-open' : 'status-closed'}`}>
                                                {cls.tenTrangThaiLopHocPhan}
                                            </span>
                                        </div>
                                        <h4 className="class-name">{cls.tenMonHoc}</h4>
                                        <div className="class-info">
                                            <span className="info-item">
                                                <span className="info-label">Tín chỉ:</span> {cls.soTinChi}
                                            </span>
                                            <span className="info-item">
                                                <span className="info-label">Học phí:</span> {formatCurrency(cls.mucHocPhi)}đ
                                            </span>
                                            <span className="info-item">
                                                <span className={`payment-status ${cls.daDongHocPhi ? 'paid' : 'unpaid'}`}>
                                                    {cls.daDongHocPhi ? '✓ Đã đóng' : '○ Chưa đóng'}
                                                </span>
                                            </span>
                                        </div>
                                        {cls.schedule && cls.schedule.length > 0 && (
                                            <div className="class-schedule">
                                                {cls.schedule.map((sch, idx) => (
                                                    <div key={idx} className="schedule-detail">
                                                        <span className="detail-day">{getDayName(sch.thu)}</span>
                                                        <span className="detail-time">Tiết {sch.tietHoc}</span>
                                                        <span className="detail-type">{sch.loaiLich}</span>
                                                        {sch.phong && <span className="detail-room">{sch.phong}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {cls.isAllowCancel && (
                                        <button className="btn-cancel-class" title="Hủy đăng ký">
                                            ✕
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
