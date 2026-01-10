'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface UserProfile {
    maSinhVien: string;
    khoaHoc: string;
    hoDem: string;
    ten: string;
    gioiTinh: boolean;
    ngaySinh2: string;
    noiSinhTinh: string;
    soDienThoai: string;
    heDaoTao: string;
    loaiHinhDT: string;
    nganh: string;
    khoa: string;
    chuyenNganh: string;
    email: string;
    svNganh2: boolean;
    isAllowChangeAvatar: boolean;
}

interface AuthContextType {
    token: string | null;
    isLoggedIn: boolean;
    isLoading: boolean;
    error: string | null;
    userType: string | null;
    profile: UserProfile | null;
    login: (username: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    fetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userType, setUserType] = useState<string | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);

    const fetchProfile = useCallback(async () => {
        if (!token) return;

        try {
            const response = await fetch('/api/user/profile', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            const data = await response.json();

            if (data.success && data.body) {
                setProfile(data.body);
            }
        } catch (err) {
            console.error('Fetch profile error:', err);
        }
    }, [token]);

    const login = useCallback(async (username: string, password: string): Promise<boolean> => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (data.success && data.token) {
                setToken(data.token);
                setUserType(data.body || null);
                setError(null);
                setIsLoading(false);

                // Fetch profile after successful login
                setTimeout(async () => {
                    try {
                        const profileResponse = await fetch('/api/user/profile', {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${data.token}`,
                                'Content-Type': 'application/json',
                            },
                        });

                        const profileData = await profileResponse.json();

                        if (profileData.success && profileData.body) {
                            setProfile(profileData.body);
                        }
                    } catch (err) {
                        console.error('Fetch profile error:', err);
                    }
                }, 100);

                return true;
            } else {
                setError(data.message || 'Đăng nhập thất bại');
                setToken(null);
                setUserType(null);
                setIsLoading(false);
                return false;
            }
        } catch (err) {
            console.error('Login error:', err);
            setError('Lỗi kết nối đến server');
            setToken(null);
            setUserType(null);
            setIsLoading(false);
            return false;
        }
    }, []);

    const logout = useCallback(async () => {
        if (token) {
            try {
                await fetch('/api/auth/logout', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });
            } catch (err) {
                console.error('Logout error:', err);
            }
        }
        setToken(null);
        setUserType(null);
        setError(null);
        setProfile(null);
    }, [token]);

    const value: AuthContextType = {
        token,
        isLoggedIn: !!token,
        isLoading,
        error,
        userType,
        profile,
        login,
        logout,
        fetchProfile,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
