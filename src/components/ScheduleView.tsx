'use client';

import { useState, useMemo } from 'react';
import CustomDropdown from './CustomDropdown';
import { useSchedule } from '@/context/ScheduleContext';
import { useAuth } from '@/context/AuthContext';

export default function ScheduleView() {
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const { isLoggedIn } = useAuth();
    const { scheduleItems, courses, isLoading, currentSemester } = useSchedule();

    // Generate filter options from courses
    const filterOptions = useMemo(() => {
        const options = [{ value: 'all', label: 'Tất cả môn học' }];
        courses.forEach(course => {
            options.push({
                value: course.maHocPhan,
                label: course.tenHocPhan
            });
        });
        return options;
    }, [courses]);

    // Filter and search schedule items
    const filteredItems = useMemo(() => {
        return scheduleItems.filter(item => {
            // Filter by course
            if (filter !== 'all' && item.maHocPhan !== filter) {
                return false;
            }
            // Search
            if (searchTerm) {
                const search = searchTerm.toLowerCase();
                return (
                    item.tenMonHoc.toLowerCase().includes(search) ||
                    item.maLopHocPhan.toLowerCase().includes(search)
                );
            }
            return true;
        });
    }, [scheduleItems, filter, searchTerm]);

    // Helper to get day name
    const getDayName = (thu: number) => {
        const days = ['', 'CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        return days[thu] || `T${thu}`;
    };

    // Helper to get status color
    const getStatusClass = (tenTrangThai: string, choDangKy: boolean) => {
        if (tenTrangThai.includes('Đã đăng ký')) return 'status-registered';
        if (choDangKy) return 'status-open';
        return 'status-closed';
    };

    return (
        <div className="panel schedule-view">
            <div className="panel-header">
                <h3 className="panel-title">📅 Lịch học chi tiết</h3>
                {currentSemester && (
                    <span className="semester-badge">{currentSemester.tenHocKy}</span>
                )}
            </div>
            <div className="schedule-toolbar">
                <CustomDropdown
                    options={filterOptions}
                    value={filter}
                    onChange={setFilter}
                    placeholder="Chọn bộ lọc"
                />
                <input
                    type="text"
                    className="search-input"
                    placeholder="🔍 Tìm kiếm..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <div className="schedule-content">
                {!isLoggedIn ? (
                    <div className="empty-state">
                        <span className="empty-icon">🔒</span>
                        <p>Vui lòng đăng nhập để xem lịch học</p>
                    </div>
                ) : isLoading ? (
                    <div className="empty-state">
                        <span className="empty-icon">⏳</span>
                        <p>Đang tải dữ liệu...</p>
                    </div>
                ) : scheduleItems.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📋</span>
                        <p>Nhấn &quot;Tải lại lịch học&quot; để xem dữ liệu</p>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">🔍</span>
                        <p>Không tìm thấy kết quả phù hợp</p>
                    </div>
                ) : (
                    <div className="schedule-list">
                        {filteredItems.map((item) => (
                            <div key={item.id} className={`schedule-card ${item.isConditional ? 'conditional' : ''}`}>
                                <div className="schedule-card-body">
                                    <div className="schedule-card-content">
                                        <div className="class-code-wrapper">
                                            <span className="class-code">{item.maLopHocPhan}</span>
                                            {item.isConditional && <span className="conditional-badge">ĐK</span>}
                                        </div>
                                        <h4 className="class-name">{item.tenMonHoc}</h4>
                                        <div className="class-info">
                                            {item.soTinChi !== undefined && item.soTinChi !== null && item.soTinChi > 0 && (
                                                <span className="info-item">
                                                    <span className="info-label">Tín chỉ:</span> {item.soTinChi}
                                                </span>
                                            )}
                                            <span className="info-item">
                                                <span className="info-label">Đăng ký:</span> {item.phanTramDangKy}%
                                            </span>
                                        </div>
                                        {item.details && item.details.length > 0 && (
                                            <div className="class-schedule">
                                                {item.details.map((detail, idx) => (
                                                    <div key={idx} className="schedule-detail">
                                                        <span className="detail-day">{getDayName(detail.thu)}</span>
                                                        <span className="detail-time">Tiết {detail.tietHoc}</span>
                                                        <span className="detail-type">{detail.loaiLich}</span>
                                                        {detail.phong && <span className="detail-room">{detail.phong}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="schedule-card-actions">
                                        <span className={`class-status ${getStatusClass(item.tenTrangThai, item.choDangKy)}`}>
                                            {item.tenTrangThai}
                                        </span>
                                        {item.choDangKy && (
                                            <button className="btn-select-class">
                                                ✓
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
