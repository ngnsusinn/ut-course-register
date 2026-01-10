'use client';

import { useEffect, useState } from 'react';

export default function ActivityLog() {
    const [logs, setLogs] = useState<string[]>([]);
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        // Mark that we're on the client
        setIsClient(true);

        // Initialize logs only on client side to avoid hydration mismatch
        setLogs([
            '[09:19:20] System initialized...',
            '[09:19:20] Waiting for user authentication...',
            '[09:19:21] Ready to register courses.',
        ]);
    }, []);

    useEffect(() => {
        if (!isClient) return;

        // Simulating log updates
        const timer = setTimeout(() => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            setLogs((prev) => [...prev, `[${timeString}] Listening for events...`]);
        }, 2000);
        return () => clearTimeout(timer);
    }, [isClient]);

    return (
        <div className="panel activity-log">
            <h3 className="panel-title">💻 Nhật ký hoạt động</h3>
            <div className="terminal">
                <div className="terminal-header">
                    <span className="terminal-btn red"></span>
                    <span className="terminal-btn yellow"></span>
                    <span className="terminal-btn green"></span>
                    <span className="terminal-title">Terminal</span>
                </div>
                <div className="terminal-content">
                    {logs.map((log, index) => (
                        <div key={index} className="log-line">
                            <span className="log-text">{log}</span>
                        </div>
                    ))}
                    <div className="cursor-line">
                        <span className="cursor">▋</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
