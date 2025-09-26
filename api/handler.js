const fetch = require('node-fetch');

// Advanced rate limiting with intelligent patterns
const RATE_LIMIT_CONFIG = {
    maxRetries: 5,
    baseDelay: 500, // Reduced base delay
    maxDelay: 15000, // Reduced max delay
    backoffMultiplier: 1.5, // Gentler backoff
    jitterMax: 500,
    
    // Per-source concurrent limits (tuned for each API)
    concurrentLimits: {
        'user': 3,      // User APIs can handle more
        'dkhp': 3,      // Main registration API
        'dkhpdk': 3,    // Prerequisite API
    },
    
    // Adaptive timing
    batchDelay: 200,           // Minimal batch delay
    dynamicDelayEnabled: true, // Enable adaptive delays
    burstMode: true,          // Allow bursts of requests
    
    // Request patterns
    burstSize: 8,             // Allow bursts of 8 requests
    burstCooldown: 2000,      // 2s cooldown after burst
    
    retryOn: [429, 502, 503, 504, 520, 521, 522, 523, 524]
};

// Intelligent request distribution
class RequestManager {
    constructor() {
        this.sourceLimits = new Map();
        this.requestCounts = new Map();
        this.lastRequestTime = new Map();
        this.burstCounts = new Map();
        this.lastBurstTime = new Map();
        this.adaptiveDelays = new Map();
        
        // Initialize for each source
        ['user', 'dkhp', 'dkhpdk'].forEach(source => {
            this.sourceLimits.set(source, new RequestSemaphore(RATE_LIMIT_CONFIG.concurrentLimits[source]));
            this.requestCounts.set(source, 0);
            this.lastRequestTime.set(source, 0);
            this.burstCounts.set(source, 0);
            this.lastBurstTime.set(source, 0);
            this.adaptiveDelays.set(source, 0);
        });
    }

    async acquireSlot(source) {
        const semaphore = this.sourceLimits.get(source);
        const now = Date.now();
        
        // Check if we can do a burst
        if (RATE_LIMIT_CONFIG.burstMode) {
            const lastBurst = this.lastBurstTime.get(source);
            const burstCount = this.burstCounts.get(source);
            
            if (now - lastBurst > RATE_LIMIT_CONFIG.burstCooldown) {
                // Reset burst counter
                this.burstCounts.set(source, 0);
                this.lastBurstTime.set(source, now);
            }
            
            if (burstCount < RATE_LIMIT_CONFIG.burstSize) {
                this.burstCounts.set(source, burstCount + 1);
                await semaphore.acquire();
                return { isBurst: true };
            }
        }
        
        // Apply adaptive delay based on recent success/failure
        const adaptiveDelay = this.adaptiveDelays.get(source);
        if (adaptiveDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
        }
        
        await semaphore.acquire();
        this.lastRequestTime.set(source, now);
        return { isBurst: false };
    }

    releaseSlot(source) {
        const semaphore = this.sourceLimits.get(source);
        semaphore.release();
    }

    recordSuccess(source) {
        // Reduce adaptive delay on success
        const currentDelay = this.adaptiveDelays.get(source);
        this.adaptiveDelays.set(source, Math.max(0, currentDelay - 50));
    }

    recordRateLimit(source) {
        // Increase adaptive delay on rate limit
        const currentDelay = this.adaptiveDelays.get(source);
        this.adaptiveDelays.set(source, Math.min(2000, currentDelay + 200));
    }
}

class RequestSemaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.current < this.maxConcurrent) {
            this.current++;
            return;
        }
        return new Promise(resolve => this.queue.push(resolve));
    }

    release() {
        this.current--;
        if (this.queue.length > 0) {
            const resolve = this.queue.shift();
            this.current++;
            resolve();
        }
    }
}

// Global request manager
const requestManager = new RequestManager();

// Smart delay calculation
function calculateSmartDelay(attempt, isRateLimit = false, source = 'dkhp') {
    let delay = RATE_LIMIT_CONFIG.baseDelay * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt - 1);
    
    // Rate limit gets special treatment
    if (isRateLimit) {
        delay *= 2; // Less aggressive than before
    }
    
    delay = Math.min(delay, RATE_LIMIT_CONFIG.maxDelay);
    
    // Add jitter
    const jitter = Math.random() * RATE_LIMIT_CONFIG.jitterMax;
    return delay + jitter;
}

// Request deduplication cache
const requestCache = new Map();
const cacheTimeout = 5000; // 5 seconds cache

function getCacheKey(endpoint, source, token) {
    return `${source}:${endpoint}:${token?.substring(0, 10) || 'notoken'}`;
}

// Enhanced API call with smart request management
async function callApi(endpoint, method, token, body = null, source = 'dkhp', allowCache = true) {
    let baseApiUrl;
    let actualSource = source;
    
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
        actualSource = 'user';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    
    const targetUrl = baseApiUrl + endpoint;
    
    // Check cache for GET requests (except POST/DELETE operations)
    if (method === 'GET' && allowCache) {
        const cacheKey = getCacheKey(endpoint, actualSource, token);
        const cached = requestCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cacheTimeout) {
            console.log(`[${actualSource}] 💨 Cache hit: ${endpoint}`);
            return cached.data;
        }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    for (let attempt = 1; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
        const slotInfo = await requestManager.acquireSlot(actualSource);
        
        try {
            const options = { 
                method, 
                headers, 
                body: body ? JSON.stringify(body) : null, 
                timeout: 45000 // Optimized timeout
            };

            const burstIndicator = slotInfo.isBurst ? '🚀' : '📡';
            console.log(`[${actualSource}] ${burstIndicator} [${attempt}/${RATE_LIMIT_CONFIG.maxRetries}] ${method} ${endpoint}`);
            
            const response = await fetch(targetUrl, options);
            
            if (response.ok) {
                const responseText = await response.text();
                
                if (!responseText) {
                    requestManager.releaseSlot(actualSource);
                    return { success: false, message: 'Empty response' };
                }

                try {
                    const jsonData = JSON.parse(responseText);
                    
                    // Cache successful GET responses
                    if (method === 'GET' && allowCache) {
                        const cacheKey = getCacheKey(endpoint, actualSource, token);
                        requestCache.set(cacheKey, {
                            data: jsonData,
                            timestamp: Date.now()
                        });
                        
                        // Clean old cache entries periodically
                        if (Math.random() < 0.1) { // 10% chance
                            cleanCache();
                        }
                    }
                    
                    requestManager.recordSuccess(actualSource);
                    requestManager.releaseSlot(actualSource);
                    console.log(`[${actualSource}] ✅ ${endpoint}`);
                    return jsonData;
                    
                } catch (parseError) {
                    requestManager.releaseSlot(actualSource);
                    return { success: false, message: 'Invalid JSON response' };
                }
            }

            // Handle errors
            const shouldRetry = RATE_LIMIT_CONFIG.retryOn.includes(response.status) && attempt < RATE_LIMIT_CONFIG.maxRetries;
            
            if (response.status === 429) {
                requestManager.recordRateLimit(actualSource);
                
                // Try to extract retry-after
                const retryAfter = response.headers.get('retry-after');
                const delay = retryAfter ? Math.min(parseInt(retryAfter) * 1000, 5000) : calculateSmartDelay(attempt, true, actualSource);
                
                console.warn(`[${actualSource}] 🚫 Rate limit. Retry in ${Math.round(delay/1000)}s...`);
                
                if (shouldRetry) {
                    requestManager.releaseSlot(actualSource);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            } else if (shouldRetry) {
                const delay = calculateSmartDelay(attempt, false, actualSource);
                console.warn(`[${actualSource}] ⚠️ Error ${response.status}. Retry in ${Math.round(delay/1000)}s...`);
                requestManager.releaseSlot(actualSource);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            requestManager.releaseSlot(actualSource);
            return { 
                success: false, 
                message: `API Error: ${response.status}`, 
                status: response.status
            };

        } catch (error) {
            const shouldRetry = attempt < RATE_LIMIT_CONFIG.maxRetries && (
                error.code === 'ECONNRESET' || 
                error.code === 'ETIMEDOUT' || 
                error.message.includes('timeout')
            );
            
            if (shouldRetry) {
                const delay = calculateSmartDelay(attempt, false, actualSource);
                requestManager.releaseSlot(actualSource);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            requestManager.releaseSlot(actualSource);
            return { success: false, message: `Network error: ${error.message}` };
        }
    }

    return { success: false, message: 'Max retries exceeded' };
}

function cleanCache() {
    const now = Date.now();
    for (const [key, value] of requestCache.entries()) {
        if (now - value.timestamp > cacheTimeout) {
            requestCache.delete(key);
        }
    }
}

// Intelligent parallel processing with load balancing
async function processIntelligently(items, asyncFn, source = 'dkhp') {
    const results = [];
    const concurrentLimit = RATE_LIMIT_CONFIG.concurrentLimits[source] || 2;
    
    // Use sliding window approach for better throughput
    const slidingWindow = [];
    let processed = 0;
    
    const processNext = async () => {
        if (processed >= items.length) return;
        
        const item = items[processed++];
        const itemIndex = processed - 1;
        
        try {
            const result = await asyncFn(item, itemIndex);
            results[itemIndex] = result;
        } catch (error) {
            results[itemIndex] = { error: true, message: error.message };
        }
        
        // Process next item
        if (processed < items.length) {
            return processNext();
        }
    };
    
    // Start initial batch
    const initialPromises = [];
    for (let i = 0; i < Math.min(concurrentLimit, items.length); i++) {
        initialPromises.push(processNext());
    }
    
    await Promise.all(initialPromises);
    
    // Ensure all results are filled
    while (results.length < items.length) {
        results.push({ error: true, message: 'Processing incomplete' });
    }
    
    return results;
}

// Smart schedule cache with invalidation
const scheduleCache = new Map();
const SCHEDULE_CACHE_TTL = 30000; // 30 seconds

async function getScheduleDetails(classId, token, source) {
    const cacheKey = `${source}-${classId}`;
    const cached = scheduleCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < SCHEDULE_CACHE_TTL) {
        console.log(`[${source}] 💨 Schedule cache hit: ${classId}`);
        return cached.data;
    }

    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    
    if (result && result.success) {
        const data = result.body;
        scheduleCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    } else {
        const errorData = { error: true, message: result?.message || 'Unknown error' };
        // Don't cache errors for too long
        scheduleCache.set(cacheKey, { data: errorData, timestamp: Date.now() - SCHEDULE_CACHE_TTL + 5000 });
        return errorData;
    }
}

// Request queue optimization
async function optimizeRequestOrder(requests) {
    // Sort requests by priority: user endpoints first, then by source
    return requests.sort((a, b) => {
        const sourceWeight = { 'user': 0, 'dkhp': 1, 'dkhpdk': 2 };
        return (sourceWeight[a.source] || 3) - (sourceWeight[b.source] || 3);
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization?.split(' ')[1];

    const startTime = Date.now();
    console.log(`🚀 [${new Date().toISOString()}] Action: ${action}`);

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
                
                // Parallel execution for independent calls
                const [profileRes, dotsRes] = await Promise.all([
                    callApi('/user/getSummaryProfile', 'GET', token),
                    callApi(`/getDot`, 'GET', token)
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
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                // Process sources in parallel when possible
                const sourcePromises = sources.map(async (source) => {
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) {
                        console.warn(`Failed to get subjects from ${source}`);
                        return { source, classes: [] };
                    }

                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    // Process subjects intelligently
                    const sourceClasses = [];
                    await processIntelligently(subjectsRes.body, async (subject) => {
                        const classEndpoint = source === 'dkhpdk'
                            ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                            : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                        
                        const classRes = await callApi(classEndpoint, 'GET', token, null, source);

                        if (classRes.success && Array.isArray(classRes.body)) {
                            // Process classes in parallel with intelligent batching
                            const classPromises = classRes.body.map(async (cls) => {
                                const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                return { ...subject, ...cls, source, scheduleDetails };
                            });
                            
                            const classResults = await Promise.all(classPromises);
                            sourceClasses.push(...classResults);
                        }
                    }, source);
                    
                    return { source, classes: sourceClasses };
                });

                const sourceResults = await Promise.all(sourcePromises);
                sourceResults.forEach(({ classes }) => allClassData.push(...classes));
                
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (regRes.success && Array.isArray(regRes.body)) {
                        // Process registered classes in parallel
                        const regPromises = regRes.body.map(async (reg) => {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes?.success) 
                                ? detailRes.body 
                                : { error: true, message: detailRes?.message || 'Failed to get details' };
                            return { ...reg, source, scheduleDetails };
                        });
                        
                        const regResults = await Promise.all(regPromises);
                        registeredData.push(...regResults);
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
                
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }

            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source, false);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source, false);
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ Action ${action} completed in ${duration}ms`);
        res.status(200).json(result);

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ Handler error for ${action} after ${duration}ms:`, error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};