'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Types
export interface Semester {
    id: number;
    tenHocKy: string;
    isHanCheDot: boolean;
    isHanCheThoiGian: boolean;
    isDangKyHocPhan: boolean;
    tuNgay: string | null;
    denNgay: string | null;
}

export interface Course {
    id: number;
    maHocPhan: string;
    tenHocPhan: string;
    soTinChi: number;
    isBatBuoc: boolean;
    hocPhanTruoc: string | null;
    tenHocPhanTruoc: string | null;
    hocPhanTienQuyet: string | null;
    tenHocPhanTienQuyet: string | null;
    hocPhanSongHanh: string | null;
    tenHocPhanSongHanh: string | null;
    diemTongKet: number | null;
    isConditional?: boolean; // Flag to mark conditional courses
    conditionalSemesterId?: number; // Semester ID for conditional courses
}

export interface ClassSection {
    id: number;
    isCanhBao: boolean;
    tenTrangThai: string;
    maLopHocPhan: string;
    lopDuKien: string | null;
    tenMonHoc: string;
    phanTramDangKy: number;
    isHienPhanTram: boolean;
    choDangKy: boolean;
    // Added from course
    maHocPhan?: string;
    soTinChi?: number;
    isConditional?: boolean;
}

export interface ClassDetail {
    thu: number;
    tietHoc: string;
    loaiLich: string;
    dayNha: string | null;
    phong: string | null;
    ngayBatDau: string;
    ngayKetThuc: string;
    ghiChu: string;
}

export interface ScheduleItem extends ClassSection {
    details: ClassDetail[];
}

interface ScheduleContextType {
    semesters: Semester[];
    currentSemester: Semester | null;
    courses: Course[];
    scheduleItems: ScheduleItem[];
    isLoading: boolean;
    loadingProgress: string;
    error: string | null;
    fetchSchedule: (token: string, includeConditional: boolean) => Promise<void>;
}

const ScheduleContext = createContext<ScheduleContextType | undefined>(undefined);

export function ScheduleProvider({ children }: { children: ReactNode }) {
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [currentSemester, setCurrentSemester] = useState<Semester | null>(null);
    const [courses, setCourses] = useState<Course[]>([]);
    const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState('');
    const [error, setError] = useState<string | null>(null);

    const fetchSchedule = useCallback(async (token: string, includeConditional: boolean) => {
        setIsLoading(true);
        setError(null);
        setScheduleItems([]);

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

            setSemesters(semesterData.body);
            const latestSemester = semesterData.body[0];
            setCurrentSemester(latestSemester);

            // Step 2: Get courses for latest semester
            setLoadingProgress(`Đang lấy danh sách học phần (${latestSemester.tenHocKy})...`);
            const coursesRes = await fetch(`/api/schedule/courses?idDot=${latestSemester.id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const coursesData = await coursesRes.json();

            if (!coursesData.success) {
                throw new Error('Không thể lấy danh sách học phần');
            }

            let allCourses: Course[] = (coursesData.body || []).map((c: Course) => ({ ...c, isConditional: false }));

            // Step 2.5: Get conditional courses if toggle is enabled
            if (includeConditional) {
                setLoadingProgress('Đang lấy danh sách đợt đăng ký điều kiện...');
                try {
                    // First get conditional semesters
                    const conditionalSemRes = await fetch('/api/schedule/conditional-semesters', {
                        headers: { 'Authorization': `Bearer ${token}` },
                    });
                    const conditionalSemData = await conditionalSemRes.json();

                    if (conditionalSemData.success && conditionalSemData.body?.length) {
                        const latestConditionalSem = conditionalSemData.body[0];

                        setLoadingProgress('Đang lấy danh sách học phần điều kiện...');
                        const conditionalRes = await fetch(`/api/schedule/conditional-courses?idDot=${latestConditionalSem.id}`, {
                            headers: { 'Authorization': `Bearer ${token}` },
                        });
                        const conditionalData = await conditionalRes.json();

                        if (conditionalData.success && conditionalData.body?.length) {
                            const conditionalCourses = conditionalData.body.map((c: Course) => ({
                                ...c,
                                isConditional: true,
                                conditionalSemesterId: latestConditionalSem.id
                            }));
                            allCourses = [...allCourses, ...conditionalCourses];
                        }
                    }
                } catch (err) {
                    console.error('Error fetching conditional courses:', err);
                }
            }

            setCourses(allCourses);

            if (allCourses.length === 0) {
                setLoadingProgress('Không có học phần nào');
                setIsLoading(false);
                return;
            }

            // Step 3: Get class sections for each course
            const allScheduleItems: ScheduleItem[] = [];

            for (let i = 0; i < allCourses.length; i++) {
                const course = allCourses[i];
                const typeLabel = course.isConditional ? ' (ĐK)' : '';
                setLoadingProgress(`Đang lấy lớp học (${i + 1}/${allCourses.length}): ${course.tenHocPhan}${typeLabel}...`);

                try {
                    // Use different API endpoints and idDot based on course type
                    const idDot = course.isConditional && course.conditionalSemesterId
                        ? course.conditionalSemesterId
                        : latestSemester.id;

                    const classesEndpoint = course.isConditional
                        ? `/api/schedule/conditional-classes?idDot=${idDot}&maHocPhan=${course.maHocPhan}`
                        : `/api/schedule/classes?idDot=${idDot}&maHocPhan=${course.maHocPhan}`;

                    const classesRes = await fetch(classesEndpoint, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const classesData = await classesRes.json();

                    if (classesData.success && classesData.body?.length) {
                        // Step 4: Get details for each class
                        for (const classSection of classesData.body) {
                            try {
                                const detailEndpoint = course.isConditional
                                    ? `/api/schedule/conditional-class-detail?idLopHocPhan=${classSection.id}`
                                    : `/api/schedule/class-detail?idLopHocPhan=${classSection.id}`;

                                const detailRes = await fetch(detailEndpoint, {
                                    headers: { 'Authorization': `Bearer ${token}` }
                                });
                                const detailData = await detailRes.json();

                                allScheduleItems.push({
                                    ...classSection,
                                    maHocPhan: course.maHocPhan,
                                    soTinChi: course.soTinChi,
                                    isConditional: course.isConditional,
                                    details: detailData.success ? detailData.body || [] : [],
                                });
                            } catch {
                                allScheduleItems.push({
                                    ...classSection,
                                    maHocPhan: course.maHocPhan,
                                    soTinChi: course.soTinChi,
                                    isConditional: course.isConditional,
                                    details: [],
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error fetching classes for ${course.maHocPhan}:`, err);
                }
            }

            setScheduleItems(allScheduleItems);
            setLoadingProgress(`Hoàn tất! Tìm thấy ${allScheduleItems.length} lớp học.`);

        } catch (err) {
            console.error('Fetch schedule error:', err);
            setError(err instanceof Error ? err.message : 'Lỗi kết nối');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const value: ScheduleContextType = {
        semesters,
        currentSemester,
        courses,
        scheduleItems,
        isLoading,
        loadingProgress,
        error,
        fetchSchedule,
    };

    return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useSchedule() {
    const context = useContext(ScheduleContext);
    if (context === undefined) {
        throw new Error('useSchedule must be used within a ScheduleProvider');
    }
    return context;
}
