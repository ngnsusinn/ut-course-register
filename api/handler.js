const fetch = require('node-fetch');

// Tiện ích: Gọi API nội bộ của trường
async function callApi(endpoint, method, token, body = null, source = 'dkhp') {
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    const targetUrl = baseApiUrl + endpoint;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        timeout: 30000,
        cache: 'no-store'
    };

    try {
        const response = await fetch(targetUrl, options);
        if (!response.ok) {
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Tiện ích: Tự động thử lại khi gọi API thất bại
async function callApiWithRetry(endpoint, method, token, body = null, source = 'dkhp', retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        const result = await callApi(endpoint, method, token, body, source);
        // FIX: Sửa điều kiện kiểm tra thành công. API có thể trả về success: true nhưng body là null hoặc rỗng.
        // Điều kiện cũ `result.success` vẫn đúng, nhưng làm rõ hơn là ta mong đợi một kết quả thành công.
        if (result && result.success) {
            return result; // Thành công, trả về kết quả ngay
        }
        
        // Thất bại, chờ trước khi thử lại
        const waitTime = delay * Math.pow(2, i);
        console.log(`API call to ${endpoint} failed. Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
        if (i < retries - 1) {
            await new Promise(res => setTimeout(res, waitTime));
        } else {
            return result; // Hết số lần thử, trả về lỗi cuối cùng
        }
    }
}

// Tiện ích: Lấy chi tiết lịch học cho một lớp
async function getScheduleDetails(classId, token, source) {
    const result = await callApiWithRetry(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// === BỘ NÃO XỬ LÝ CÁC HÀNH ĐỘNG TỪ CLIENT ===
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApiWithRetry('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApiWithRetry(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body && dotsRes.body.length)
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot
                };
                break;
            }

            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                
                let allClassData = [];
                let subjectTypeMap = {};
                let hasFailed = false;
                let failedRequests = [];
                let logs = []; // NEW: Mảng để lưu log gửi về client

                const BATCH_SIZE = 5;
                const DELAY_MS = 500;

                for (const source of sources) {
                    logs.push(`INFO: Bắt đầu lấy dữ liệu từ nguồn: [${source}]`);
                    const subjectsRes = await callApiWithRetry(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);

                    if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) {
                        hasFailed = true;
                        const errorMsg = subjectsRes.message || 'Response body is not an array.';
                        logs.push(`ERROR: Không thể lấy danh sách môn học từ nguồn [${source}]. Lỗi: ${errorMsg}`);
                        failedRequests.push({ type: 'GET_SUBJECT_LIST', source: source, error: errorMsg });
                        break;
                    }

                    const subjects = subjectsRes.body;
                    logs.push(`INFO: [${source}] Tìm thấy ${subjects.length} môn học. Bắt đầu xử lý theo lô ${BATCH_SIZE} môn...`);

                    if (source === 'dkhp') {
                        subjects.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    for (let i = 0; i < subjects.length; i += BATCH_SIZE) {
                        const subjectBatch = subjects.slice(i, i + BATCH_SIZE);
                        logs.push(`\n---> Đang xử lý lô ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(subjects.length / BATCH_SIZE)} (Gồm ${subjectBatch.length} môn)`);

                        const batchPromises = subjectBatch.map(async (subject) => {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApiWithRetry(classEndpoint, 'GET', token, null, source);

                            if (classRes.success && Array.isArray(classRes.body)) {
                                const detailPromises = classRes.body.map(async (cls) => {
                                    const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                    if (scheduleDetails.error) {
                                        hasFailed = true;
                                        logs.push(`WARN: Lấy chi tiết lớp ${cls.id} thất bại. Lỗi: ${scheduleDetails.message}`);
                                        failedRequests.push({ type: 'GET_CLASS_DETAILS', classId: cls.id, error: scheduleDetails.message });
                                    }
                                    allClassData.push({ ...subject, ...cls, source, scheduleDetails });
                                });
                                await Promise.all(detailPromises);
                            } else {
                                hasFailed = true;
                                const errorMsg = classRes.message || 'Response body is not an array.';
                                logs.push(`WARN: Lấy danh sách lớp cho môn ${subject.maHocPhan} thất bại. Lỗi: ${errorMsg}`);
                                failedRequests.push({ type: 'GET_CLASS_LIST_FOR_SUBJECT', subjectCode: subject.maHocPhan, error: errorMsg });
                            }
                        });
                        
                        await Promise.all(batchPromises);

                        if (i + BATCH_SIZE < subjects.length) {
                            logs.push(`--- Hoàn thành lô. Chờ ${DELAY_MS}ms... ---`);
                            await new Promise(res => setTimeout(res, DELAY_MS));
                        }
                    }

                    if (hasFailed) break;
                }

                if (hasFailed && allClassData.length === 0) {
                    logs.push('FATAL: Lỗi nghiêm trọng, không lấy được bất kỳ dữ liệu nào.');
                    result = {
                        success: false,
                        message: 'Không thể lấy dữ liệu lịch học sau nhiều lần thử.',
                        errors: failedRequests,
                        logs: logs // NEW
                    };
                } else {
                    const finalMessage = hasFailed ? 'Hoàn thành nhưng có một số lỗi. Dữ liệu có thể không đầy đủ.' : 'Lấy thành công toàn bộ dữ liệu lịch học.';
                    logs.push(`SUCCESS: ${finalMessage}`);
                    result = {
                        success: !hasFailed,
                        message: finalMessage,
                        schedule: allClassData,
                        subjectTypes: subjectTypeMap,
                        errors: failedRequests,
                        logs: logs // NEW
                    };
                }
                break;
            }
            
            // ... (các case khác không thay đổi)
            case 'getRegisteredClasses': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { dotId, fetchPrerequisites } = payload;
                 const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                 let registeredData = [];
                 for (const source of sources) {
                       const regRes = await callApiWithRetry(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                       if (regRes.success && Array.isArray(regRes.body)) {
                           await Promise.all(regRes.body.map(async (reg) => {
                             const detailRes = await callApiWithRetry(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                             const scheduleDetails = (detailRes && detailRes.success) ? detailRes.body : { error: true, message: detailRes.message };
                             registeredData.push({ ...reg, source, scheduleDetails });
                           }));
                       }
                 }
                 result = { success: true, body: registeredData };
                 break;
            }
            case 'checkClassStatus': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { dotId, maHocPhan, source } = payload;
                   const classEndpoint = source === 'dkhpdk'
                     ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                     : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                 result = await callApiWithRetry(classEndpoint, 'GET', token, null, source);
                 break;
            }
            case 'register': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { classId, source } = payload;
                 result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                 break;
            }
            case 'cancel': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { registrationId, source } = payload;
                 result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                 break;
            }
            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        
        // **FIX**: Xóa bỏ khối if/else kiểm tra `hasFailed` ở đây vì nó đã được xử lý trong case 'getFullSchedule'.
        // Khối code cũ ở đây sẽ gây lỗi ReferenceError cho các action khác.

        res.status(200).json(result);

    } catch (error) {
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};