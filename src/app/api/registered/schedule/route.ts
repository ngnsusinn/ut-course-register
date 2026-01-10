import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization');
        const { searchParams } = new URL(request.url);
        const idDangKy = searchParams.get('idDangKy');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { success: false, message: 'Token không hợp lệ' },
                { status: 401 }
            );
        }

        if (!idDangKy) {
            return NextResponse.json(
                { success: false, message: 'Thiếu idDangKy' },
                { status: 400 }
            );
        }

        const token = authHeader.split(' ')[1];

        const response = await fetch(`https://portal.ut.edu.vn/api/v1/dkhp/getLichHoc?idDangKy=${idDangKy}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Get class schedule error:', error);
        return NextResponse.json(
            { success: false, message: 'Lỗi kết nối đến server' },
            { status: 500 }
        );
    }
}
