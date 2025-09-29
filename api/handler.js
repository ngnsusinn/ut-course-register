// UTH Course Registration Tool - Enhanced Backend Handler
// Enhanced with rate limiting, error handling, and request optimization

const fetch = require('node-fetch');

// Enhanced Request Queue for Rate Limiting
class RequestQueue {
    constructor() {
        this.queues = new Map(); // Separate queues per endpoint
        this.globalDelay = 200; // Base delay between requests
        this.maxConcurrent = 3; // Max concurrent requests per endpoint
        this.requestCounts = new Map(); // Track request frequency
        this.lastRequestTime = new Map(); // Track last request time per endpoint
    }
    
    getQueueKey(endpoint, source) {
        return `${source}_${endpoint.split('?')[0]}`;
    }
    
    async enqueue(requestFunc, endpoint, source = 'dkhp') {
        const queueKey = this.getQueueKey(endpoint, source);
        
        if (!this.queues.has(queueKey)) {
            this.queues.set(queueKey, []);
            this.requestCounts.set(queueKey, 0);
            this.lastRequestTime.set(queueKey, 0);
        }
        
        return new Promise((resolve, reject) => {
            this.queues.get(queueKey).push({
                requestFunc,
                resolve,
                reject,
                timestamp: Date.now()
            });
            this.processQueue(queueKey);
        });
    }
    
    async processQueue(queueKey) {
        const queue = this.queues.get(queueKey);
        if (!queue || queue.length === 0) return;
        
        // Count active requests for this queue
        const activeRequests = queue.filter(req => req.processing).length;
        if (activeRequests >= this.maxConcurrent) return;
        
        const request = queue.find(req => !req.processing);
        if (!request) return;
        
        request.processing = true;
        
        try {
            // Adaptive delay based on request frequency
            const now = Date.now();
            const lastRequest = this.lastRequestTime.get(queueKey);
            const requestCount = this.requestCounts.get(queueKey);
            
            // Calculate dynamic delay
            const timeSinceLastRequest = now - lastRequest;
            const dynamicDelay = Math.max(
                this.globalDelay,
                100 + (requestCount * 50), // Increase delay with request count
                500 - timeSinceLastRequest // Minimum time between requests
            );
            
            if (timeSinceLastRequest < dynamicDelay) {
                await new Promise(resolve => setTimeout(resolve, dynamicDelay - timeSinceLastRequest));
            }
            
            // Update tracking
            this.lastRequestTime.set(queueKey, Date.now());
            this.requestCounts.set(queueKey, requestCount + 1);
            
            const result = await request.requestFunc();
            request.resolve(result);
            
            // Reset counter periodically
            if (requestCount > 50) {
                setTimeout(() => {
                    this.requestCounts.set(queueKey, Math.max(0, this.requestCounts.get(queueKey) - 10));
                }, 30000);
            }
            
        } catch (error) {
            request.reject(error);
        } finally {
            // Remove completed request
            const index = queue.indexOf(request);
            if (index > -1) queue.splice(index, 1);
            
            // Continue processing queue
            setImmediate(() => this.processQueue(queueKey));
        }
    }
}

// Global request queue instance
const requestQueue = new RequestQueue();

// Enhanced Cache System
class ResponseCache {
    constructor(defaultTTL = 5 * 60 * 1000) { // 5 minutes default
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
        this.maxSize = 200;
        
        // Cleanup expired entries periodically
        setInterval(() => this.cleanup(), 60000);
    }
    
    generateKey(endpoint, token, source) {
        // Generate cache key excluding sensitive data
        const cleanEndpoint = endpoint.replace(/idDot=\d+/, 'idDot=X');
        return `${source}_${cleanEndpoint}_${token ? 'auth' : 'noauth'}`;
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.data;
    }
    
    set(key, data, ttl = this.defaultTTL) {
        // Prevent cache overflow
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        
        this.cache.set(key, {
            data,
            expires: Date.now() + ttl,
            created: Date.now()
        });
    }
    
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expires) {
                this.cache.delete(key);
            }
        }
    }
    
    clear() {
        this.cache.clear();
    }
}

// Global cache instance
const responseCache = new ResponseCache();

// Enhanced API caller with comprehensive error handling and retry logic
async function callApi(endpoint, method, token, body = null, source = 'dkhp', retries = 3) {
    // Determine base URL
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    
    const targetUrl = baseApiUrl + endpoint;
    
    // Check cache for GET requests
    if (method === 'GET' && !body) {
        const cacheKey = responseCache.generateKey(endpoint, token, source);
        const cachedResult = responseCache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }
    }
    
    // Enhanced headers with more realistic browser simulation
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Queue the request to prevent rate limiting
    return requestQueue.enqueue(async () => {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                // Progressive backoff for retries
                if (attempt > 0) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
                
                const options = {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : null,
                    signal: controller.signal
                };
                
                const response = await fetch(targetUrl, options);
                clearTimeout(timeoutId);
                
                // Handle specific HTTP status codes
                if (response.status === 429) {
                    console.warn(`Rate limited on ${endpoint}, attempt ${attempt + 1}`);
                    if (attempt < retries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                        continue;
                    }
                    return { 
                        success: false, 
                        message: 'Tần suất request quá cao, vui lòng thử lại sau', 
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
                
                if (response.status === 403) {
                    return { 
                        success: false, 
                        message: 'Không có quyền truy cập', 
                        status: 403 
                    };
                }
                
                if (response.status === 500) {
                    return { 
                        success: false, 
                        message: 'Lỗi server nội bộ', 
                        status: 500 
                    };
                }
                
                if (!response.ok) {
                    return { 
                        success: false, 
                        message: `API Error: HTTP ${response.status}`, 
                        status: response.status 
                    };
                }
                
                const result = await response.json();
                
                // Cache successful GET responses
                if (method === 'GET' && !body && result) {
                    const cacheKey = responseCache.generateKey(endpoint, token, source);
                    responseCache.set(cacheKey, result);
                }
                
                return result;
                
            } catch (error) {
                console.error(`API call failed (attempt ${attempt + 1}):`, error.message);
                
                if (error.name === 'AbortError') {
                    if (attempt === retries - 1) {
                        return { success: false, message: 'Request timeout - server không phản hồi' };
                    }
                    continue;
                }
                
                if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
                    if (attempt === retries - 1) {
                        return { success: false, message: 'Lỗi kết nối mạng' };
                    }
                    continue;
                }
                
                // Final attempt failed
                if (attempt === retries - 1) {
                    return { success: false, message: `Network error: ${error.message}` };
                }
            }
        }
    }, endpoint, source);
}

// Enhanced schedule details fetcher with better error handling
async function getScheduleDetails(classId, token, source) {
    try {
        const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
        return (result && result.success) ? result.body : { error: true, message: result?.message || 'Unknown error' };
    } catch (error) {
        return { error: true, message: error.message };
    }
}

// Enhanced batch processing function
async function processBatch(items, processor, batchSize = 5, delay = 100) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
        
        // Small delay between batches to prevent overwhelming
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return results;
}

// Main handler function
module.exports = async (req, res) => {
    // Enhanced CORS headers
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
    
    // Request validation
    if (!req.body || !req.body.action) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid request format. Action is required.' 
        });
    }
    
    const { action, payload = {} } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
    
    // Request logging for debugging
    console.log(`[${new Date().toISOString()}] Action: ${action}, Has Token: ${!!token}`);
    
    try {
        let result;
        
        switch (action) {
            // === AUTHENTICATION ACTIONS ===
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
            
            // === DATA FETCHING ACTIONS ===
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
                        
                        // Build subject type map for main source
                        if (source === 'dkhp') {
                            subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                        }
                        
                        // Process subjects in controlled batches
                        await processBatch(subjectsRes.body, async (subject) => {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApi(classEndpoint, 'GET', token, null, source);
                            
                            if (classRes.success && Array.isArray(classRes.body)) {
                                // Process classes sequentially to avoid overwhelming the server
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
                        }, 3, 200); // Process 3 subjects at a time with 200ms delay
                        
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
                            // Process registered classes in batches
                            await processBatch(regRes.body, async (reg) => {
                                const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                                const scheduleDetails = (detailRes && detailRes.success) 
                                    ? detailRes.body 
                                    : { error: true, message: detailRes?.message || 'Lỗi lấy lịch học' };
                                
                                registeredData.push({ ...reg, source, scheduleDetails });
                            }, 5, 150);
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
            
            // === UTILITY ACTIONS ===
            case 'clearCache': {
                responseCache.clear();
                result = { success: true, message: 'Cache đã được xóa' };
                break;
            }
            
            default:
                return res.status(400).json({ 
                    success: false, 
                    message: `Action không hợp lệ: ${action}` 
                });
        }
        
        // Enhanced response with metadata
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
