const express = require('express');
const mysql = require('mysql2/promise');

// Cấu hình thông tin kết nối cơ sở dữ liệu
const dbConfig = {
    host: '103.97.126.29',
    user: 'roacqgfa_test',
    password: 'testtest',
    database: 'roacqgfa_test'
};

// Khởi tạo ứng dụng Express
const app = express();

// Middleware để tự động phân tích cú pháp (parse) JSON từ request body
app.use(express.json());

// Định nghĩa một route để nhận dữ liệu từ webhook (phương thức POST)
app.post('/webhook-receiver', async (req, res) => {
    let connection;
    try {
        // Lấy dữ liệu từ body của request
        const data = req.body;

        // Kiểm tra xem dữ liệu có phải là một object hợp lệ không
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ success: false, message: 'No data received' });
        }

        // Trích xuất dữ liệu từ object
        const {
            gateway,
            transactionDate: transaction_date, // Đổi tên để khớp với cột trong CSDL
            accountNumber: account_number,
            subAccount: sub_account,
            transferType,
            transferAmount,
            accumulated,
            code,
            content: transaction_content,
            referenceCode: reference_number,
            description: body
        } = data;

        // Khởi tạo các biến amount
        let amount_in = 0;
        let amount_out = 0;

        // Kiểm tra loại giao dịch để gán giá trị amount
        if (transferType === "in") {
            amount_in = transferAmount;
        } else if (transferType === "out") {
            amount_out = transferAmount;
        }

        // Tạo kết nối đến MySQL
        connection = await mysql.createConnection(dbConfig);

        // Chuẩn bị câu lệnh SQL với các placeholder (?) để chống SQL Injection
        const sql = `
            INSERT INTO tb_transactions 
            (gateway, transaction_date, account_number, sub_account, amount_in, amount_out, accumulated, code, transaction_content, reference_number, body) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Dữ liệu sẽ được chèn vào các placeholder theo thứ tự
        const values = [
            gateway, transaction_date, account_number, sub_account, 
            amount_in, amount_out, accumulated, code, 
            transaction_content, reference_number, body
        ];
        
        // Thực thi câu lệnh SQL
        await connection.execute(sql, values);

        // Gửi phản hồi thành công
        res.status(200).json({ success: true });

    } catch (error) {
        // Ghi lại lỗi ra console để debug
        console.error('Webhook processing error:', error);
        
        // Gửi phản hồi lỗi
        res.status(500).json({ success: false, message: 'An internal server error occurred: ' + error.message });

    } finally {
        // Đảm bảo kết nối luôn được đóng sau khi hoàn tất
        if (connection) {
            await connection.end();
        }
    }
});

// Khởi động server
const PORT = 3000; // Bạn có thể thay đổi cổng nếu cần
app.listen(PORT, () => {
    console.log(`Webhook server is running on http://localhost:${PORT}`);
});