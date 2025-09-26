const fetch = require('node-fetch');

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
    jitterMax: 1000, // Random jitter up to 1 second
    concurrentLimit: 3, // Max concurrent requests per source
    batchDelay: 800, // Delay between batches
    retryOn: [429, 502, 503, 504, 520, 521, 522, 523, 524] // Status codes to retry
};

// Global request queue and semaphores for rate limiting
const requestQueues = new Map(); // Per-source queues
const semaphores = new Map(); // Per-source semaphores

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

        return new Promise(resolve => {
            this.queue.push(resolve);
        });
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

// Get or create semaphore for a source
function getSemaphore(source) {
    if (!semaphores.has(source)) {
        semaphores.set(source, new RequestSemaphore(RATE_LIMIT_CONFIG.concurrentLimit));
    }
    return semaphores.get(source);
}

// Calculate delay with exponential backoff and jitter
function calculateDelay(attempt, isRateLimit = false) {
    let delay = RATE_LIMIT_CONFIG.baseDelay * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt - 1);
    
    // For rate limits, use longer delays
    if (isRateLimit) {
        delay *= 3;
    }
    
    // Cap at max delay
    delay = Math.min(delay, RATE_LIMIT_CONFIG.maxDelay);
    
    // Add random jitter to avoid thundering herd
    const jitter = Math.random() * RATE_LIMIT_CONFIG.jitterMax;
    return delay + jitter;
}

// Enhanced API call with advanced rate limiting and retry logic
async function callApi(endpoint, method, token, body = null, source = 'dkhp') {
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
        source = 'user'; // Separate rate limiting for user endpoints
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    
    const targetUrl = baseApiUrl + endpoint;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const semaphore = getSemaphore(source);

    for (let attempt = 1; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
        // Acquire semaphore to limit concurrent requests
        await semaphore.acquire();

        try {
            const options = { 
                method, 
                headers, 
                body: body ? JSON.stringify(body) : null, 
                timeout: 90000 // Increased to 90s for slower responses
            };

            console.log(`[${source}] [Attempt ${attempt}/${RATE_LIMIT_CONFIG.maxRetries}] ${method} ${endpoint}`);
            
            const response = await fetch(targetUrl, options);
            
            console.log(`[${source}] Response: ${response.status} ${response.statusText} for ${endpoint}`);

            // Handle successful responses
            if (response.ok) {
                const responseText = await response.text();
                
                if (!responseText) {
                    console.warn(`[${source}] Empty response from: ${endpoint}`);
                    semaphore.release();
                    return { success: false, message: 'Empty response from server' };
                }

                try {
                    const jsonData = JSON.parse(responseText);
                    console.log(`[${source}] ✅ Success: ${endpoint}`);
                    semaphore.release();
                    return jsonData;
                } catch (parseError) {
                    console.error(`[${source}] JSON Parse error for ${endpoint}:`, parseError.message);
                    semaphore.release();
                    return { success: false, message: 'Invalid JSON response', details: responseText.substring(0, 200) };
                }
            }

            // Handle error responses
            const errorText = await response.text().catch(() => '');
            const shouldRetry = RATE_LIMIT_CONFIG.retryOn.includes(response.status) && attempt < RATE_LIMIT_CONFIG.maxRetries;
            
            if (response.status === 429) {
                // Rate limit - extract retry-after header if available
                const retryAfter = response.headers.get('retry-after');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : calculateDelay(attempt, true);
                
                console.warn(`[${source}] 🚫 Rate limited (${response.status}). Retrying after ${Math.round(delay/1000)}s... (${attempt}/${RATE_LIMIT_CONFIG.maxRetries})`);
                
                if (shouldRetry) {
                    semaphore.release();
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            } else if (shouldRetry) {
                const delay = calculateDelay(attempt, false);
                console.warn(`[${source}] ⚠️ Server error (${response.status}). Retrying after ${Math.round(delay/1000)}s... (${attempt}/${RATE_LIMIT_CONFIG.maxRetries})`);
                semaphore.release();
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            console.error(`[${source}] ❌ API Error: ${response.status} for ${endpoint}`);
            semaphore.release();
            return { 
                success: false, 
                message: `API Error: Status ${response.status}`, 
                status: response.status,
                details: errorText.substring(0, 200)
            };

        } catch (error) {
            console.error(`[${source}] 🔌 Network error for ${endpoint} (attempt ${attempt}):`, error.message);
            
            const shouldRetry = attempt < RATE_LIMIT_CONFIG.maxRetries && (
                error.code === 'ECONNRESET' || 
                error.code === 'ETIMEDOUT' || 
                error.code === 'ENOTFOUND' ||
                error.message.includes('timeout')
            );
            
            if (shouldRetry) {
                const delay = calculateDelay(attempt, false);
                console.log(`[${source}] 🔄 Network retry after ${Math.round(delay/1000)}s...`);
                semaphore.release();
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            semaphore.release();
            return { success: false, message: `Network error: ${error.message}` };
        }
    }

    return { success: false, message: `Max retries (${RATE_LIMIT_CONFIG.maxRetries}) exceeded` };
}

// Rate-limited batch processing with progressive backoff
async function processBatch(items, asyncFn, batchSize = 2, source = 'dkhp') {
    const results = [];
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        console.log(`[${source}] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(items.length/batchSize)} (${batch.length} items)`);
        
        try {
            const batchResults = await Promise.all(batch.map(asyncFn));
            results.push(...batchResults);
            consecutiveErrors = 0; // Reset error counter on success
            
            // Dynamic delay based on recent errors
            if (i + batchSize < items.length) {
                const delay = RATE_LIMIT_CONFIG.batchDelay + (consecutiveErrors * 500);
                console.log(`[${source}] Batch delay: ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
        } catch (batchError) {
            console.error(`[${source}] Batch error:`, batchError.message);
            consecutiveErrors++;
            
            // If too many consecutive errors, increase delay significantly
            if (consecutiveErrors >= maxConsecutiveErrors) {
                console.warn(`[${source}] Too many consecutive errors, cooling down...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                consecutiveErrors = 0;
            }
            
            // Add empty results for failed batch
            results.push(...batch.map(() => ({ error: true, message: 'Batch processing failed' })));
        }
    }
    
    return results;
}

// Enhanced schedule details fetcher with caching
const scheduleCache = new Map();
async function getScheduleDetails(classId, token, source) {
    const cacheKey = `${source}-${classId}`;
    
    if (scheduleCache.has(cacheKey)) {
        console.log(`[${source}] 📋 Cache hit for class ${classId}`);
        return scheduleCache.get(cacheKey);
    }

    console.log(`[${source}] 📋 Getting schedule details for class ${classId}`);
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    
    if (result && result.success) {
        console.log(`[${source}] 📋 Schedule details retrieved for class ${classId}`);
        scheduleCache.set(cacheKey, result.body);
        return result.body;
    } else {
        console.warn(`[${source}] 📋 Failed to get schedule details for class ${classId}:`, result?.message);
        const errorResult = { error: true, message: result?.message || 'Unknown error' };
        scheduleCache.set(cacheKey, errorResult); // Cache errors too to avoid repeated failures
        return errorResult;
    }
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

    const startTime = Date.now();
    console.log(`🚀 [${new Date().toISOString()}] Starting action: ${action}`);

    try {
        let result;
        switch (action) {
            // --- HÀNH ĐỘNG XÁC THỰC ---
            case 'login': {
                const { username, password } = payload;
                console.log(`🔐 Login attempt for user: ${username}`);
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                console.log('📊 Getting initial data...');
                
                // Sequential calls to avoid overwhelming the server
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                
                const latestDot = (dotsRes.success && dotsRes.body && dotsRes.body.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                    
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot
                };
                console.log('📊 Initial data retrieved:', { hasProfile: !!result.profile, hasDot: !!result.dot });
                break;
            }

            // --- HÀNH ĐỘNG LẤY DỮ LIỆU ---
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                console.log(`📅 Getting full schedule for dot ${dotId}, fetchPrerequisites: ${fetchPrerequisites}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                for (const source of sources) {
                    console.log(`📚 Processing source: ${source}`);
                    
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    
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

                    // Process subjects with aggressive rate limiting
                    const subjectResults = await processBatch(subjectsRes.body, async (subject) => {
                        try {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApi(classEndpoint, 'GET', token, null, source);

                            if (classRes.success && Array.isArray(classRes.body)) {
                                console.log(`📚 Found ${classRes.body.length} classes for subject ${subject.maHocPhan}`);
                                
                                // Process classes sequentially to be extra careful with rate limits
                                const classResults = [];
                                for (const cls of classRes.body) {
                                    const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                    classResults.push({ ...subject, ...cls, source, scheduleDetails });
                                    
                                    // Small delay between class detail requests
                                    if (classRes.body.length > 1) {
                                        await new Promise(resolve => setTimeout(resolve, 300));
                                    }
                                }
                                
                                allClassData.push(...classResults);
                            } else {
                                console.warn(`📚 No classes found for subject ${subject.maHocPhan} from ${source}`);
                            }
                        } catch (error) {
                            console.error(`📚 Error processing subject ${subject.maHocPhan}:`, error.message);
                        }
                    }, 1, source); // Process only 1 subject at a time to be very conservative
                }
                
                console.log(`📅 Total classes retrieved: ${allClassData.length}`);
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                console.log(`📋 Getting registered classes for dot ${dotId}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    console.log(`📋 Getting registered classes from ${source}`);
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (regRes.success && Array.isArray(regRes.body)) {
                        console.log(`📋 Found ${regRes.body.length} registered classes from ${source}`);
                        
                        // Process registered classes sequentially with delays
                        for (const reg of regRes.body) {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes && detailRes.success) 
                                ? detailRes.body 
                                : { error: true, message: detailRes?.message || 'Failed to get schedule details' };
                            registeredData.push({ ...reg, source, scheduleDetails });
                            
                            // Delay between registered class detail requests
                            if (regRes.body.length > 1) {
                                await new Promise(resolve => setTimeout(resolve, 400));
                            }
                        }
                    }
                }
                
                console.log(`📋 Total registered classes: ${registeredData.length}`);
                result = { success: true, body: registeredData };
                break;
            }
            
            case 'checkClassStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, maHocPhan, source } = payload;
                console.log(`🔍 Checking class status for ${maHocPhan} from ${source}`);
                
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }

            // --- HÀNH ĐỘNG GHI (ĐĂNG KÝ/HỦY) ---
            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                console.log(`✅ Registering class ${classId} from ${source}`);
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                console.log(`❌ Canceling registration ${registrationId} from ${source}`);
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ [${new Date().toISOString()}] Action ${action} completed successfully in ${duration}ms`);
        res.status(200).json(result);

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ [${new Date().toISOString()}] Handler error for action ${action} after ${duration}ms:`, error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};