import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { success: false, message: 'Token không hợp lệ' },
                { status: 401 }
            );
        }

        const token = authHeader.split(' ')[1];

        const response = await fetch('https://portal.ut.edu.vn/api/v1/dkhp/getDot', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Get semesters error:', error);
        return NextResponse.json(
            { success: false, message: 'Lỗi kết nối đến server' },
            { status: 500 }
        );
    }
}
