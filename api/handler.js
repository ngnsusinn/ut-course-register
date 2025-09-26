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
        'dkhp': 4,      // Main registration API
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

// Request deduplication cache with smart invalidation
const requestCache = new Map();
const cacheTimeout = 3000; // Reduced to 3 seconds cache

function getCacheKey(endpoint, source, token) {
    // Include more context in cache key to avoid collisions
    const bodyHash = endpoint.includes('?') ? endpoint.split('?')[1] : '';
    return `${source}:${endpoint.split('?')[0]}:${bodyHash}:${token?.substring(0, 10) || 'notoken'}`;
}

function shouldCacheResponse(response, endpoint) {
    // Don't cache empty or failed responses
    if (!response || !response.success) return false;
    
    // Don't cache responses with empty important data
    if (endpoint.includes('getHocPhanHocMoi') && (!response.body || !Array.isArray(response.body) || response.body.length === 0)) {
        console.log('Not caching empty subjects response');
        return false;
    }
    
    if (endpoint.includes('getLopHocPhan') && (!response.body || !Array.isArray(response.body) || response.body.length === 0)) {
        console.log('Not caching empty classes response');
        return false;
    }
    
    return true;
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
            // Additional validation for cached data
            if (shouldCacheResponse(cached.data, endpoint)) {
                console.log(`[${actualSource}] 💨 Cache hit: ${endpoint}`);
                return cached.data;
            } else {
                // Remove invalid cached data
                console.log(`[${actualSource}] 🗑️ Removing invalid cache: ${endpoint}`);
                requestCache.delete(cacheKey);
            }
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
                    
                    // Cache successful GET responses with validation
                    if (method === 'GET' && allowCache && shouldCacheResponse(jsonData, endpoint)) {
                        const cacheKey = getCacheKey(endpoint, actualSource, token);
                        requestCache.set(cacheKey, {
                            data: jsonData,
                            timestamp: Date.now()
                        });
                        console.log(`[${actualSource}] 💾 Cached response for: ${endpoint}`);
                        
                        // Clean old cache entries periodically
                        if (Math.random() < 0.1) { // 10% chance
                            cleanCache();
                        }
                    } else if (method === 'GET' && allowCache) {
                        console.log(`[${actualSource}] ⚠️ Not caching response for: ${endpoint} (validation failed)`);
                    }
                    
                    requestManager.recordSuccess(actualSource);
                    requestManager.releaseSlot(actualSource);
                    console.log(`[${actualSource}] ✅ ${endpoint} (${Array.isArray(jsonData.body) ? jsonData.body.length + ' items' : 'success'})`);
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
    let cleaned = 0;
    for (const [key, value] of requestCache.entries()) {
        if (now - value.timestamp > cacheTimeout) {
            requestCache.delete(key);
            cleaned++;
        }
    }
    
    // Also clean schedule cache
    for (const [key, value] of scheduleCache.entries()) {
        if (now - value.timestamp > SCHEDULE_CACHE_TTL) {
            scheduleCache.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🗑️ Cleaned ${cleaned} expired cache entries`);
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

// Smart schedule cache with better invalidation
const scheduleCache = new Map();
const SCHEDULE_CACHE_TTL = 10000; // Reduced to 10 seconds

async function getScheduleDetails(classId, token, source) {
    const cacheKey = `${source}-${classId}`;
    const cached = scheduleCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < SCHEDULE_CACHE_TTL) {
        // Validate cached data
        if (cached.data && !cached.data.error) {
            console.log(`[${source}] 💨 Schedule cache hit: ${classId}`);
            return cached.data;
        } else {
            // Remove invalid cache
            scheduleCache.delete(cacheKey);
        }
    }

    console.log(`[${source}] 📋 Fetching schedule details for class ${classId}`);
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source, false); // Disable cache for schedule details
    
    if (result && result.success && result.body) {
        const data = result.body;
        scheduleCache.set(cacheKey, { data, timestamp: Date.now() });
        console.log(`[${source}] 💾 Cached schedule for class ${classId}`);
        return data;
    } else {
        console.warn(`[${source}] ❌ Failed to get schedule for class ${classId}:`, result?.message);
        const errorData = { error: true, message: result?.message || 'Failed to fetch schedule details' };
        // Don't cache errors to allow retry
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
                console.log(`📅 Getting full schedule for dot ${dotId}, fetchPrerequisites: ${fetchPrerequisites}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                // Process sources sequentially to avoid overwhelming the server
                for (const source of sources) {
                    console.log(`📚 Processing source: ${source}`);
                    
                    // Always fetch fresh data for subjects
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source, false);
                    
                    if (!subjectsRes.success) {
                        console.warn(`📚 Failed to get subjects from ${source}:`, subjectsRes.message);
                        continue;
                    }
                    
                    if (!Array.isArray(subjectsRes.body)) {
                        console.warn(`📚 Invalid subjects response from ${source}:`, typeof subjectsRes.body);
                        continue;
                    }

                    console.log(`📚 Found ${subjectsRes.body.length} subjects from ${source}`);

                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    // Process subjects with better error handling
                    const sourceClasses = [];
                    for (const subject of subjectsRes.body) {
                        try {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            // Fetch fresh class data
                            const classRes = await callApi(classEndpoint, 'GET', token, null, source, false);

                            if (classRes.success && Array.isArray(classRes.body)) {
                                console.log(`📚 Found ${classRes.body.length} classes for subject ${subject.maHocPhan}`);
                                
                                // Process classes with schedule details
                                for (const cls of classRes.body) {
                                    const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                    sourceClasses.push({ ...subject, ...cls, source, scheduleDetails });
                                    
                                    // Small delay between schedule requests
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                }
                            } else {
                                console.warn(`📚 No classes for subject ${subject.maHocPhan} from ${source}`);
                            }
                        } catch (error) {
                            console.error(`📚 Error processing subject ${subject.maHocPhan}:`, error.message);
                        }
                        
                        // Small delay between subjects
                        await new Promise(resolve => setTimeout(resolve, 150));
                    }
                    
                    allClassData.push(...sourceClasses);
                    console.log(`📚 Added ${sourceClasses.length} classes from ${source}`);
                }
                
                console.log(`📅 Total classes retrieved: ${allClassData.length}`);
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