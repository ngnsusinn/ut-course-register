'use client';

import { AuthProvider } from '@/context/AuthContext';
import { ScheduleProvider } from '@/context/ScheduleContext';
import { RegisteredProvider } from '@/context/RegisteredContext';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
    return (
        <AuthProvider>
            <ScheduleProvider>
                <RegisteredProvider>
                    {children}
                </RegisteredProvider>
            </ScheduleProvider>
        </AuthProvider>
    );
}
