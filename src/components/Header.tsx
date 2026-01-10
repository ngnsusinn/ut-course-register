'use client';

export default function Header() {
    return (
        <header className="header">
            <div className="header-left">
                <div className="logo">
                    <span className="logo-icon">📚</span>
                    <span className="logo-text">UTH Course Registration</span>
                </div>
                <span className="logo-subtitle">Công cụ đăng ký học phần tự động</span>
            </div>
            <div className="header-right">
                <button className="btn-guide">
                    <span>📖</span> Hướng dẫn
                </button>
            </div>
        </header>
    );
}
