// UTH Course Registration Tool - Backend Handler (Stable Enhanced Version)
// Giữ nguyên logic gốc với cải tiến rate limiting cơ bản

const fetch = require('node-fetch');

// Simple rate limiting với queue cơ bản
class SimpleRequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.baseDelay = 300; // 300ms delay cơ bản
        this.requestCount = 0;
        this.lastReset = Date.now();
    }
    
    async add(requestFunc) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFunc, resolve, reject });
            if (!this.processing) {
                this.process();
            }
        });
    }
    
    async process() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const { requestFunc, resolve, reject } = this.queue.shift();
            
            try {
                // Reset counter mỗi phút
                const now = Date.now();
                if (now - this.lastReset > 60000) {
                    this.requestCount = 0;
                    this.lastReset = now;
                }
                
                // Dynamic delay dựa trên số request
                const dynamicDelay = this.baseDelay + (this.requestCount * 50);
                await new Promise(r => setTimeout(r, Math.min(dynamicDelay, 2000)));
                
                const result = await requestFunc();
                this.requestCount++;
                resolve(result);
                
            } catch (error) {
                reject(error);
            }
        }
        
        this.processing = false;
    }
}

// Global instance
const requestQueue = new SimpleRequestQueue();

// Enhanced callApi function với retry đơn giản
async function callApi(endpoint, method, token, body = null, source = 'dkhp', retries = 3) {
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    
    const targetUrl = baseApiUrl + endpoint;
    
    return requestQueue.add(async () => {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                // Progressive delay cho retry
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
                
                const headers = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                };
                
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                
                const options = {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : null,
                };
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                options.signal = controller.signal;
                
                const response = await fetch(targetUrl, options);
                clearTimeout(timeoutId);
                
                // Handle specific status codes
                if (response.status === 429) {
                    console.warn(`Rate limited on ${endpoint}, attempt ${attempt + 1}`);
                    if (attempt < retries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                        continue;
                    }
                    return { 
                        success: false, 
                        message: 'Request quá nhanh, vui lòng thử lại sau', 
                        status: 429 
                    };
                }
                
                if (response.status === 401) {
                    return { 
                        success: false, 
                        message: 'Token hết hạn hoặc không hợp lệ', 
                        status: 401 
                    };
                }
                
                if (!response.ok) {
                    return { 
                        success: false, 
                        message: `API Error: HTTP ${response.status}`, 
                        status: response.status 
                    };
                }
                
                return await response.json();
                
            } catch (error) {
                console.error(`API call failed (attempt ${attempt + 1}):`, error.message);
                
                if (error.name === 'AbortError') {
                    if (attempt === retries - 1) {
                        return { success: false, message: 'Request timeout' };
                    }
                    continue;
                }
                
                if (attempt === retries - 1) {
                    return { success: false, message: `Network error: ${error.message}` };
                }
            }
        }
    });
}

// Enhanced schedule details function
async function getScheduleDetails(classId, token, source) {
    try {
        const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
        return (result && result.success) ? result.body : { error: true, message: result?.message || 'Unknown error' };
    } catch (error) {
        return { error: true, message: error.message };
    }
}

// Main handler - giữ nguyên logic gốc nhưng có cải tiến
module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method Not Allowed. Only POST requests are supported.' 
        });
    }
    
    if (!req.body || !req.body.action) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid request format. Action is required.' 
        });
    }
    
    const { action, payload = {} } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
    
    console.log(`[${new Date().toISOString()}] Action: ${action}, Has Token: ${!!token}`);
    
    try {
        let result;
        
        switch (action) {
            // === AUTHENTICATION ===
            case 'login': {
                const { username, password } = payload;
                
                if (!username || !password) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Username và password là bắt buộc' 
                    });
                }
                
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }
            
            case 'getInitialData': {
                if (!token) {
                    return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
                }
                
                const [profileRes, dotsRes] = await Promise.all([
                    callApi('/user/getSummaryProfile', 'GET', token),
                    callApi('/getDot', 'GET', token)
                ]);
                
                const latestDot = (dotsRes.success && dotsRes.body.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot,
                    message: !profileRes.success ? 'Lỗi lấy thông tin profile' : 
                             !latestDot ? 'Không tìm thấy đợt đăng ký' : undefined
                };
                break;
            }
            
            // === DATA FETCHING - Giữ nguyên logic gốc ===
            case 'getFullSchedule': {
                if (!token) {
                    return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
                }
                
                const { dotId, fetchPrerequisites } = payload;
                
                if (!dotId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'dotId là bắt buộc' 
                    });
                }
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};
                
                for (const source of sources) {
                    try {
                        const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                        
                        if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) {
                            console.warn(`Failed to fetch subjects for source ${source}:`, subjectsRes.message);
                            continue;
                        }
                        
                        // Build subject type map cho main source
                        if (source === 'dkhp') {
                            subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                        }
                        
                        // Process subjects với controlled batching
                        const batchSize = 5;
                        for (let i = 0; i < subjectsRes.body.length; i += batchSize) {
                            const batch = subjectsRes.body.slice(i, i + batchSize);
                            
                            await Promise.all(batch.map(async (subject) => {
                                const classEndpoint = source === 'dkhpdk'
                                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                                
                                const classRes = await callApi(classEndpoint, 'GET', token, null, source);
                                
                                if (classRes.success && Array.isArray(classRes.body)) {
                                    // Process classes sequentially để tránh overwhelming server
                                    for (const cls of classRes.body) {
                                        const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                        allClassData.push({ 
                                            ...subject, 
                                            ...cls, 
                                            source, 
                                            scheduleDetails 
                                        });
                                    }
                                }
                            }));
                            
                            // Small delay giữa các batch
                            if (i + batchSize < subjectsRes.body.length) {
                                await new Promise(resolve => setTimeout(resolve, 200));
                            }
                        }
                        
                    } catch (error) {
                        console.error(`Error processing source ${source}:`, error.message);
                    }
                }
                
                result = { 
                    success: true, 
                    schedule: allClassData, 
                    subjectTypes: subjectTypeMap,
                    totalClasses: allClassData.length
                };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) {
                    return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
                }
                
                const { dotId, fetchPrerequisites } = payload;
                
                if (!dotId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'dotId là bắt buộc' 
                    });
                }
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];
                
                for (const source of sources) {
                    try {
                        const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                        
                        if (regRes.success && Array.isArray(regRes.body)) {
                            // Process registered classes với limited concurrency
                            const batchSize = 3;
                            for (let i = 0; i < regRes.body.length; i += batchSize) {
                                const batch = regRes.body.slice(i, i + batchSize);
                                
                                await Promise.all(batch.map(async (reg) => {
                                    const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                                    const scheduleDetails = (detailRes && detailRes.success) 
                                        ? detailRes.body 
                                        : { error: true, message: detailRes?.message || 'Lỗi lấy lịch học' };
                                    
                                    registeredData.push({ ...reg, source, scheduleDetails });
                                }));
                                
                                // Delay giữa batches
                                if (i + batchSize < regRes.body.length) {
                                    await new Promise(resolve => setTimeout(resolve, 150));
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error fetching registered classes for source ${source}:`, error.message);
                    }
                }
                
                result = { success: true, body: registeredData };
                break;
            }
            
            case 'checkClassStatus': {
                if (!token) {
                    return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
                }
                
                const { dotId, maHocPhan, source = 'dkhp' } = payload;
                
                if (!dotId || !maHocPhan) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'dotId và maHocPhan là bắt buộc' 
                    });
                }
                
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }
            
            // === REGISTRATION ACTIONS ===
            case 'register': {
                if (!token) {
                    return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
                }
                
                const { classId, source = 'dkhp' } = payload;
                
                if (!classId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'classId là bắt buộc' 
                    });
                }
                
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }
            
            case 'cancel': {
                if (!token) {
                    return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
                }
                
                const { registrationId, source = 'dkhp' } = payload;
                
                if (!registrationId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'registrationId là bắt buộc' 
                    });
                }
                
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }
            
            default:
                return res.status(400).json({ 
                    success: false, 
                    message: `Action không hợp lệ: ${action}` 
                });
        }
        
        // Response với timestamp
        const response = {
            ...result,
            timestamp: new Date().toISOString(),
            action
        };
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error(`Handler Error for action ${action}:`, error);
        
        res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error: ' + error.message,
            action,
            timestamp: new Date().toISOString()
        });
    }
};
