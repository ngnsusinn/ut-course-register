document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const resultTitle = document.getElementById('result-title');
    const resultMessage = document.getElementById('result-message');
    const resultIcon = document.getElementById('result-icon');
    const infoContainer = document.getElementById('info-container');
    const responseCode = params.get('vnp_ResponseCode');

    const successIcon = `<svg class="w-16 h-16 mx-auto text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    const failIcon = `<svg class="w-16 h-16 mx-auto text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;

    if (responseCode === '00') {
        resultIcon.innerHTML = successIcon;
        resultTitle.textContent = 'Giao dịch thành công!';
        resultMessage.textContent = 'Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi.';
    } else {
        resultIcon.innerHTML = failIcon;
        resultTitle.textContent = 'Giao dịch thất bại!';
        resultMessage.textContent = 'Đã có lỗi xảy ra. Vui lòng thử lại hoặc liên hệ hỗ trợ.';
    }

    const infoMap = {
        'vnp_Amount': 'Số tiền',
        'vnp_BankCode': 'Ngân hàng',
        'vnp_OrderInfo': 'Nội dung',
        'vnp_PayDate': 'Ngày thanh toán',
        'vnp_TransactionNo': 'Mã giao dịch VNPAY',
        'vnp_TxnRef': 'Mã đơn hàng'
    };
    
    let infoHTML = '';
    for (const [key, label] of Object.entries(infoMap)) {
        if (params.has(key)) {
            let value = params.get(key);
            if (key === 'vnp_Amount') {
                value = (parseInt(value) / 100).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });
            }
            if (key === 'vnp_PayDate') {
                const y = value.substring(0,4), m = value.substring(4,6), d = value.substring(6,8);
                const h = value.substring(8,10), min = value.substring(10,12), s = value.substring(12,14);
                value = `${d}/${m}/${y} ${h}:${min}:${s}`;
            }
            infoHTML += `<div class="flex justify-between"><p class="font-semibold text-gray-700">${label}:</p><p class="text-gray-900">${value}</p></div>`;
        }
    }
    infoContainer.innerHTML = infoHTML;
});