'use client';

export default function StatusLegend() {
    const statuses = [
        { color: 'status-pending', label: 'Đang chờ đăng ký', colorCode: '#e3f2fd' },
        { color: 'status-planning', label: 'Đang lên kế hoạch (lớp bị khóa)', colorCode: '#fff9c4' },
        { color: 'status-open', label: 'Đã mở chính thức', colorCode: '#e8f5e9' },
        { color: 'status-closed', label: 'Đã khóa lớp', colorCode: '#ffebee' },
        { color: 'status-fee', label: 'Học phí', colorCode: '#f5f5f5' },
    ];

    return (
        <div className="panel status-legend">
            <h3 className="panel-title">🎨 Chú thích trạng thái</h3>
            <div className="legend-list">
                {statuses.map((status, index) => (
                    <div key={index} className="legend-item">
                        <span
                            className={`legend-color ${status.color}`}
                            style={{ backgroundColor: status.colorCode }}
                        ></span>
                        <span className="legend-label">{status.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
