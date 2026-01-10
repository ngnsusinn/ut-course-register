'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Types
export interface RegisteredClass {
    id: number;
    maLopHocPhan: string;
    tenMonHoc: string;
    lopDuKien: string;
    soTinChi: number;
    mucHocPhi: number;
    ngayHetHanNopHP: string | null;
    daDongHocPhi: boolean;
    tenTrangThaiDangKy: string;
    ngayDangKy: string;
    tenTrangThaiLopHocPhan: string;
    isAllowCancel: boolean;
    schedule?: ClassSchedule[];
}

export interface ClassSchedule {
    thu: number;
    tietHoc: string;
    loaiLich: string;
    dayNha: string;
    phong: string;
    ngayBatDau: string;
    ngayKetThuc: string;
    ghiChu: string;
}

interface RegisteredContextType {
    registeredClasses: RegisteredClass[];
    isLoading: boolean;
    loadingProgress: string;
    error: string | null;
    totalCredits: number;
    totalFee: number;
    fetchRegisteredClasses: (token: string) => Promise<void>;
}

const RegisteredContext = createContext<RegisteredContextType | undefined>(undefined);

export function RegisteredProvider({ children }: { children: ReactNode }) {
    const [registeredClasses, setRegisteredClasses] = useState<RegisteredClass[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState('');
    const [error, setError] = useState<string | null>(null);

    const fetchRegisteredClasses = useCallback(async (token: string) => {
        setIsLoading(true);
        setError(null);
        setRegisteredClasses([]);

        try {
            // Step 1: Get semesters
            setLoadingProgress('Đang lấy danh sách đợt đăng ký...');
            const semesterRes = await fetch('/api/schedule/semesters', {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const semesterData = await semesterRes.json();

            if (!semesterData.success || !semesterData.body?.length) {
                throw new Error('Không thể lấy danh sách đợt đăng ký');
            }

            const latestSemester = semesterData.body[0];

            // Step 2: Get registered classes
            setLoadingProgress('Đang lấy danh sách lớp đã đăng ký...');
            const classesRes = await fetch(`/api/registered/classes?idDot=${latestSemester.id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const classesData = await classesRes.json();

            if (!classesData.success) {
                throw new Error('Không thể lấy danh sách lớp đã đăng ký');
            }

            const classes: RegisteredClass[] = classesData.body || [];

            if (classes.length === 0) {
                setLoadingProgress('Chưa có lớp nào được đăng ký');
                setRegisteredClasses([]);
                setIsLoading(false);
                return;
            }

            // Step 3: Get schedule for each class
            const classesWithSchedule: RegisteredClass[] = [];

            for (let i = 0; i < classes.length; i++) {
                const cls = classes[i];
                setLoadingProgress(`Đang lấy lịch học (${i + 1}/${classes.length}): ${cls.tenMonHoc}...`);

                try {
                    const scheduleRes = await fetch(`/api/registered/schedule?idDangKy=${cls.id}`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                    });
                    const scheduleData = await scheduleRes.json();

                    classesWithSchedule.push({
                        ...cls,
                        schedule: scheduleData.success ? scheduleData.body || [] : [],
                    });
                } catch {
                    classesWithSchedule.push({
                        ...cls,
                        schedule: [],
                    });
                }
            }

            setRegisteredClasses(classesWithSchedule);
            setLoadingProgress(`Hoàn tất! Đã đăng ký ${classesWithSchedule.length} lớp.`);

        } catch (err) {
            console.error('Fetch registered classes error:', err);
            setError(err instanceof Error ? err.message : 'Lỗi kết nối');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Calculate totals
    const totalCredits = registeredClasses.reduce((sum, cls) => sum + cls.soTinChi, 0);
    const totalFee = registeredClasses.reduce((sum, cls) => sum + cls.mucHocPhi, 0);

    const value: RegisteredContextType = {
        registeredClasses,
        isLoading,
        loadingProgress,
        error,
        totalCredits,
        totalFee,
        fetchRegisteredClasses,
    };

    return <RegisteredContext.Provider value={value}>{children}</RegisteredContext.Provider>;
}

export function useRegistered() {
    const context = useContext(RegisteredContext);
    if (context === undefined) {
        throw new Error('useRegistered must be used within a RegisteredProvider');
    }
    return context;
}
