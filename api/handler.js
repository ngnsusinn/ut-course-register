// UTH Course Registration Tool - Ultra Fast Handler
// Optimized for speed and timeout prevention

const fetch = require('node-fetch');

// Performance constants
const REQUEST_TIMEOUT = 12000; // 12s timeout per request
const HANDLER_TIMEOUT = 25000; // 25s max for entire handler
const MAX_CONCURRENT = 10; // High concurrency
const MIN_DELAY = 50; // Very low delay
const MAX_RETRIES = 2;

// Ultra fast queue with minimal overhead
class UltraFastQueue {
    constructor() {
        this.activeRequests = 0;
        this.requestCount = 0;
        this.lastReset = Date.now();
    }
    
    async execute(requestFunc) {
        // Reset counter every minute
        const now = Date.now();
        if (now - this.lastReset > 60000) {
            this.requestCount = 0;
            this.lastReset = now;
        }
        
        // Immediate execution if under limit
        if (this.activeRequests < MAX_CONCURRENT) {
            this.activeRequests++;
            
            try {
                // Minimal delay to prevent rate limiting
                if (this.requestCount > 0 && this.requestCount % 5 === 0) {
                    await new Promise(r => setTimeout(r, MIN_DELAY));
                }
                
                const result = await requestFunc();
                this.requestCount++;
                return result;
            } finally {
                this.activeRequests--;
            }
        } else {
            // Wait briefly and retry
            await new Promise(r => setTimeout(r, 25));
            return this.execute(requestFunc);
        }
    }
}

const ultraQueue = new UltraFastQueue();

// Cache for repeated requests
const requestCache = new Map();
const CACHE_TTL = 30000; // 30s cache

function getCacheKey(url, token) {
    return `${url}_${token ? 'auth' : 'noauth'}`;
}

function getFromCache(key) {
    const cached = requestCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    requestCache.delete(key);
    return null;
}

function setCache(key, data) {
    if (requestCache.size > 100) {
        const firstKey = requestCache.keys().next().value;
        requestCache.delete(firstKey);
    }
    requestCache.set(key, { data, timestamp: Date.now() });
}

// Lightning fast API caller
async function callApi(endpoint, method, token, body = null, source = 'dkhp', retries = MAX_RETRIES) {
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
        const cacheKey = getCacheKey(targetUrl, token);
        const cached = getFromCache(cacheKey);
        if (cached) return cached;
    }
    
    return ultraQueue.execute(async () => {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                }
                
                const headers = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                };
                
                if (token) headers['Authorization'] = `Bearer ${token}`;
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
                
                const response = await fetch(targetUrl, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : null,
                    signal: controller.signal,
                });
                
                clearTimeout(timeoutId);
                
                if (response.status === 429) {
                    if (attempt < retries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                        continue;
                    }
                    return { success: false, message: 'Rate limited', status: 429 };
                }
                
                if (!response.ok) {
                    return { success: false, message: `HTTP ${response.status}`, status: response.status };
                }
                
                const result = await response.json();
                
                // Cache successful GET responses
                if (method === 'GET' && !body) {
                    const cacheKey = getCacheKey(targetUrl, token);
                    setCache(cacheKey, result);
                }
                
                return result;
                
            } catch (error) {
                if (error.name === 'AbortError') {
                    return { success: false, message: 'Request timeout', status: 408 };
                }
                
                if (attempt === retries - 1) {
                    return { success: false, message: error.message };
                }
            }
        }
    });
}

// Fast schedule details (optional for speed)
async function getScheduleDetailsOptional(classId, token, source, timeLeft) {
    // Skip if low on time
    if (timeLeft < 3000) return null;
    
    try {
        const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source, 1);
        return (result && result.success) ? result.body : null;
    } catch {
        return null;
    }
}

// Main handler with aggressive timeout management
module.exports = async (req, res) => {
    const startTime = Date.now();
    
    // Set response timeout
    req.setTimeout(HANDLER_TIMEOUT - 2000);
    
    // Ultra fast CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    
    const { action, payload = {} } = req.body || {};
    if (!action) return res.status(400).json({ success: false, message: 'Action required' });
    
    const token = req.headers.authorization?.split(' ')[1];
    
    // Timeout checker
    const checkTimeout = () => {
        const elapsed = Date.now() - startTime;
        if (elapsed > HANDLER_TIMEOUT - 1000) {
            throw new Error(`Handler timeout after ${elapsed}ms`);
        }
        return HANDLER_TIMEOUT - elapsed;
    };
    
    try {
        let result;
        
        switch (action) {
            case 'login': {
                const { username, password } = payload;
                if (!username || !password) {
                    return res.status(400).json({ success: false, message: 'Credentials required' });
                }
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }
            
            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Token required' });
                
                checkTimeout();
                const [profileRes, dotsRes] = await Promise.all([
                    callApi('/user/getSummaryProfile', 'GET', token),
                    callApi('/getDot', 'GET', token)
                ]);
                
                const latestDot = (dotsRes.success && dotsRes.body?.length) 
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
                if (!token) return res.status(401).json({ success: false, message: 'Token required' });
                const { dotId, fetchPrerequisites } = payload;
                if (!dotId) return res.status(400).json({ success: false, message: 'dotId required' });
                
                checkTimeout();
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};
                let processedSubjects = 0;
                let totalSubjects = 0;
                
                for (const source of sources) {
                    const timeLeft = checkTimeout();
                    
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    if (!subjectsRes?.success || !Array.isArray(subjectsRes.body)) continue;
                    
                    totalSubjects += subjectsRes.body.length;
                    
                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }
                    
                    // Ultra parallel processing
                    const MEGA_BATCH_SIZE = 20; // Very large batches
                    for (let i = 0; i < subjectsRes.body.length; i += MEGA_BATCH_SIZE) {
                        const remainingTime = checkTimeout();
                        
                        const batch = subjectsRes.body.slice(i, i + MEGA_BATCH_SIZE);
                        
                        const batchPromises = batch.map(async (subject) => {
                            try {
                                const classEndpoint = source === 'dkhpdk'
                                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                                
                                const classRes = await callApi(classEndpoint, 'GET', token, null, source, 1);
                                if (!classRes?.success || !Array.isArray(classRes.body)) return [];
                                
                                // Ultra fast parallel class processing
                                const classPromises = classRes.body.map(async (cls) => {
                                    const currentTimeLeft = Date.now() - startTime;
                                    const scheduleDetails = await getScheduleDetailsOptional(cls.id, token, source, HANDLER_TIMEOUT - currentTimeLeft);
                                    
                                    return {
                                        ...subject,
                                        ...cls,
                                        source,
                                        scheduleDetails: scheduleDetails || { 
                                            error: true, 
                                            message: 'Skipped for performance' 
                                        }
                                    };
                                });
                                
                                return Promise.all(classPromises);
                            } catch (error) {
                                console.warn(`Subject processing error:`, error.message);
                                return [];
                            }
                        });
                        
                        try {
                            const batchResults = await Promise.all(batchPromises);
                            allClassData.push(...batchResults.flat());
                            processedSubjects += batch.length;
                        } catch (error) {
                            console.warn(`Batch processing error:`, error.message);
                        }
                        
                        // Micro delay only if we have time
                        if (remainingTime > 5000 && i + MEGA_BATCH_SIZE < subjectsRes.body.length) {
                            await new Promise(resolve => setTimeout(resolve, 5));
                        }
                    }
                }
                
                result = {
                    success: true,
                    schedule: allClassData,
                    subjectTypes: subjectTypeMap,
                    totalClasses: allClassData.length,
                    processedSubjects,
                    totalSubjects,
                    processingTime: Date.now() - startTime
                };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Token required' });
                const { dotId, fetchPrerequisites } = payload;
                if (!dotId) return res.status(400).json({ success: false, message: 'dotId required' });
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];
                
                for (const source of sources) {
                    checkTimeout();
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    if (!regRes?.success || !Array.isArray(regRes.body)) continue;
                    
                    // Ultra fast parallel processing
                    const registeredPromises = regRes.body.map(async (reg) => {
                        try {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp', 1);
                            const scheduleDetails = detailRes?.success ? detailRes.body : null;
                            return { ...reg, source, scheduleDetails };
                        } catch {
                            return { ...reg, source, scheduleDetails: null };
                        }
                    });
                    
                    const batchResults = await Promise.all(registeredPromises);
                    registeredData.push(...batchResults);
                }
                
                result = { success: true, body: registeredData };
                break;
            }
            
            case 'checkClassStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Token required' });
                const { dotId, maHocPhan, source = 'dkhp' } = payload;
                if (!dotId || !maHocPhan) {
                    return res.status(400).json({ success: false, message: 'dotId and maHocPhan required' });
                }
                
                const endpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                
                result = await callApi(endpoint, 'GET', token, null, source);
                break;
            }
            
            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Token required' });
                const { classId, source = 'dkhp' } = payload;
                if (!classId) return res.status(400).json({ success: false, message: 'classId required' });
                
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }
            
            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Token required' });
                const { registrationId, source = 'dkhp' } = payload;
                if (!registrationId) return res.status(400).json({ success: false, message: 'registrationId required' });
                
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }
            
            default:
                return res.status(400).json({ success: false, message: `Invalid action: ${action}` });
        }
        
        // Lightning fast response
        const response = {
            ...result,
            timestamp: new Date().toISOString(),
            action,
            processingTime: Date.now() - startTime
        };
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error(`Handler Error for action ${action}:`, error.message);
        
        const processingTime = Date.now() - startTime;
        
        if (error.message.includes('timeout') || processingTime > HANDLER_TIMEOUT - 1000) {
            res.status(524).json({
                success: false,
                message: `Processing timeout after ${processingTime}ms - try reducing data scope`,
                action,
                processingTime,
                suggestion: 'Try unchecking "Lấy dữ liệu môn học điều kiện" to reduce load'
            });
        } else {
            res.status(500).json({
                success: false,
                message: error.message,
                action,
                processingTime
            });
        }
    }
};
