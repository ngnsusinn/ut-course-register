'use client';

export default function SelectedCourses() {
    const selectedCourses: string[] = []; // Empty initially

    return (
        <div className="panel selected-courses">
            <h3 className="panel-title">📋 Các lớp học phần đã chọn</h3>
            <div className="courses-list">
                {selectedCourses.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📭</span>
                        <p>Chưa có lớp học phần nào được chọn</p>
                        <p className="empty-hint">Hãy đăng nhập và chọn lớp từ lịch học</p>
                    </div>
                ) : (
                    <ul>
                        {selectedCourses.map((course, index) => (
                            <li key={index}>{course}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
