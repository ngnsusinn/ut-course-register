const fetch = require('node-fetch');

// Tiện ích: Gọi API nội bộ của trường, chỉ dùng trong file này
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
        cache: 'no-store' // Đảm bảo fetch luôn lấy dữ liệu mới nhất
    };

    try {
        const response = await fetch(targetUrl, options);
        if (!response.ok) { // Handle non-2xx responses
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Tiện ích MỚI: Tự động thử lại khi gọi API thất bại
async function callApiWithRetry(endpoint, method, token, body = null, source = 'dkhp', retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        const result = await callApi(endpoint, method, token, body, source);
        if (result.success) {
            return result; // Thành công, trả về kết quả ngay
        }
        // Thất bại, ghi log và chờ trước khi thử lại
        console.log(`API call to ${endpoint} failed. Retrying in ${delay * Math.pow(2, i)}ms... (Attempt ${i + 1}/${retries})`);
        if (i < retries - 1) { // Chỉ chờ nếu đây không phải lần thử cuối cùng
            await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
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
            // --- HÀNH ĐỘNG XÁC THỰC ---
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApiWithRetry('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApiWithRetry(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body.length)
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot
                };
                break;
            }

            // --- HÀNH ĐỘNG LẤY DỮ LIỆU ---
            // --- HÀNH ĐỘNG LẤY DỮ LIỆU ---
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                
                // --- CÁC BIẾN LƯU TRỮ KẾT QUẢ ---
                let allClassData = [];
                let subjectTypeMap = {};
                let hasFailed = false;
                let failedRequests = [];

                // --- CÁC HẰNG SỐ CẤU HÌNH ---
                const BATCH_SIZE = 5; // Xử lý 5 môn học mỗi lần
                const DELAY_MS = 500; // Delay 0.5 giây giữa các lô

                // Lặp qua các nguồn dữ liệu (dkhp, dkhpdk)
                for (const source of sources) {
                    console.log(`Bắt đầu lấy dữ liệu từ nguồn: [${source}]`);

                    // 1. Lấy danh sách TẤT CẢ các môn học của nguồn hiện tại
                    const subjectsRes = await callApiWithRetry(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);

                    if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) {
                        hasFailed = true;
                        failedRequests.push({
                            type: 'GET_SUBJECT_LIST',
                            source: source,
                            error: subjectsRes.message || 'Response body is not an array.'
                        });
                        break; // Bỏ qua nguồn này nếu không lấy được danh sách môn học
                    }

                    const subjects = subjectsRes.body;
                    console.log(`> [${source}] Tìm thấy ${subjects.length} môn học. Bắt đầu xử lý theo lô ${BATCH_SIZE} môn...`);

                    // Ghi nhận loại môn học (Bắt buộc/Tự chọn)
                    if (source === 'dkhp') {
                        subjects.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    // 2. Lặp qua danh sách môn học theo từng lô (batch)
                    for (let i = 0; i < subjects.length; i += BATCH_SIZE) {
                        const subjectBatch = subjects.slice(i, i + BATCH_SIZE); // Lấy ra 1 lô gồm 5 môn
                        
                        console.log(`--> Đang xử lý lô ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(subjects.length / BATCH_SIZE)} (Gồm ${subjectBatch.length} môn)`);

                        // 3. Xử lý đồng thời 5 môn học trong lô hiện tại
                        const batchPromises = subjectBatch.map(async (subject) => {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApiWithRetry(classEndpoint, 'GET', token, null, source);

                            if (classRes.success && Array.isArray(classRes.body)) {
                                // Lấy chi tiết lịch học cho từng lớp của môn học này
                                const detailPromises = classRes.body.map(async (cls) => {
                                    const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                    if (scheduleDetails.error) {
                                        hasFailed = true;
                                        failedRequests.push({
                                            type: 'GET_CLASS_DETAILS',
                                            classId: cls.id,
                                            error: scheduleDetails.message
                                        });
                                    }
                                    allClassData.push({ ...subject, ...cls, source, scheduleDetails });
                                });
                                await Promise.all(detailPromises);
                            } else {
                                hasFailed = true;
                                failedRequests.push({
                                    type: 'GET_CLASS_LIST_FOR_SUBJECT',
                                    subjectCode: subject.maHocPhan,
                                    error: classRes.message || 'Response body is not an array.'
                                });
                            }
                        });
                        
                        // Đợi cho lô 5 môn học hiện tại xử lý xong
                        await Promise.all(batchPromises);

                        // 4. Nếu đây chưa phải lô cuối cùng, thì delay
                        if (i + BATCH_SIZE < subjects.length) {
                            console.log(`--- Hoàn thành lô. Delay ${DELAY_MS}ms... ---\n`);
                            await new Promise(res => setTimeout(res, DELAY_MS));
                        }
                    }

                    if (hasFailed) break; // Nếu có lỗi thì không cần xử lý nguồn tiếp theo
                }

                // --- TRẢ KẾT QUẢ CUỐI CÙNG VỀ CHO CLIENT ---
                if (hasFailed && allClassData.length === 0) {
                    console.error('--- LỖI NGHIÊM TRỌNG, KHÔNG LẤY ĐƯỢC DỮ LIỆU ---');
                    console.error(JSON.stringify(failedRequests, null, 2));
                    result = {
                        success: false,
                        message: 'Không thể lấy dữ liệu lịch học sau nhiều lần thử.',
                        errors: failedRequests
                    };
                } else {
                    result = {
                        success: !hasFailed,
                        message: hasFailed ? 'Hoàn thành nhưng có một số lỗi. Dữ liệu có thể không đầy đủ.' : 'Lấy thành công toàn bộ dữ liệu lịch học.',
                        schedule: allClassData,
                        subjectTypes: subjectTypeMap,
                        errors: failedRequests 
                    };
                }
                break;
            }

                // KIỂM TRA CUỐI CÙNG VÀ TRẢ VỀ KẾT QUẢ
                if (hasFailed) {
                    console.error('--- CÓ LỖI XẢY RA KHI FETCH DỮ LIỆU ---');
                    console.error(JSON.stringify(failedRequests, null, 2)); // In ra console server-side
                    console.error('------------------------------------------');
                    
                    // Trả về thông báo lỗi cùng với chi tiết các lỗi
                    result = { 
                        success: false, 
                        message: 'Failed to fetch some required data after multiple retries.',
                        errors: failedRequests 
                    };
                } else {
                    result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                }
                break;
            }

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

            // --- HÀNH ĐỘNG GHI (ĐĂNG KÝ/HỦY) ---
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
        res.status(200).json(result);

    } catch (error) {
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};