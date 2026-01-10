import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return NextResponse.json(
                { success: false, message: 'Thiếu tên đăng nhập hoặc mật khẩu' },
                { status: 400 }
            );
        }

        const response = await fetch('https://portal.ut.edu.vn/api/v1/user/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (data.success) {
            return NextResponse.json({
                success: true,
                message: data.message || 'Đăng nhập thành công',
                token: data.token,
                body: data.body,
                timestamp: data.timestamp,
            });
        } else {
            return NextResponse.json(
                {
                    success: false,
                    message: data.message || 'Đăng nhập thất bại'
                },
                { status: 401 }
            );
        }
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { success: false, message: 'Lỗi kết nối đến server' },
            { status: 500 }
        );
    }
}
