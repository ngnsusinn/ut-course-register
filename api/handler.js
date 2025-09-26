const fetch = require('node-fetch');

// Ultra-conservative rate limiting to completely avoid rate limits
const RATE_LIMIT_CONFIG = {
    maxRetries: 8, // More retries
    baseDelay: 2000, // Start with 2 seconds
    maxDelay: 60000, // Up to 60 seconds
    backoffMultiplier: 1.8,
    jitterMax: 1000,
    
    // Very conservative concurrent limits
    concurrentLimits: {
        'user': 1,      // Only 1 concurrent request for user APIs
        'dkhp': 1,      // Only 1 concurrent request for dkhp
        'dkhpdk': 1,    // Only 1 concurrent request for dkhpdk
    },
    
    // Longer delays between requests
    requestDelay: 1500,        // 1.5s between requests
    sequentialDelay: 800,      // 0.8s between sequential items
    batchDelay: 3000,          // 3s between batches
    
    retryOn: [429, 502, 503, 504, 520, 521, 522, 523, 524, 500]
};

// Simple semaphore for strict rate limiting
class StrictSemaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.current = 0;
        this.queue = [];
        this.lastRequestTime = 0;
    }

    async acquire(source) {
        // Ensure minimum delay between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const minDelay = RATE_LIMIT_CONFIG.requestDelay;
        
        if (timeSinceLastRequest < minDelay) {
            const waitTime = minDelay - timeSinceLastRequest;
            console.log(`[${source}] ⏳ Waiting ${waitTime}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        if (this.current < this.maxConcurrent) {
            this.current++;
            this.lastRequestTime = Date.now();
            return;
        }

        return new Promise(resolve => {
            this.queue.push(() => {
                this.current++;
                this.lastRequestTime = Date.now();
                resolve();
            });
        });
    }

    release() {
        this.current--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        }
    }
}

// Global semaphores
const semaphores = new Map();
function getSemaphore(source) {
    if (!semaphores.has(source)) {
        const limit = RATE_LIMIT_CONFIG.concurrentLimits[source] || 1;
        semaphores.set(source, new StrictSemaphore(limit));
    }
    return semaphores.get(source);
}

// Enhanced delay calculation with more aggressive backoff for rate limits
function calculateDelay(attempt, isRateLimit = false, hasRetryAfter = false, retryAfterSeconds = 0) {
    if (hasRetryAfter && retryAfterSeconds > 0) {
        // Use server-provided retry-after, but cap it
        return Math.min(retryAfterSeconds * 1000, RATE_LIMIT_CONFIG.maxDelay);
    }
    
    let delay = RATE_LIMIT_CONFIG.baseDelay * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt - 1);
    
    if (isRateLimit) {
        // Much more aggressive backoff for rate limits
        delay *= 5; // 5x longer for rate limits
        delay += 10000; // Add extra 10 seconds base
    }
    
    delay = Math.min(delay, RATE_LIMIT_CONFIG.maxDelay);
    
    // Add jitter
    const jitter = Math.random() * RATE_LIMIT_CONFIG.jitterMax;
    return delay + jitter;
}

// Completely redesigned API call function with NO CACHING
async function callApiWithoutCache(endpoint, method, token, body = null, source = 'dkhp') {
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
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const semaphore = getSemaphore(actualSource);

    for (let attempt = 1; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
        await semaphore.acquire(actualSource);
        
        try {
            const options = { 
                method, 
                headers, 
                body: body ? JSON.stringify(body) : null, 
                timeout: 120000 // 2 minute timeout
            };

            console.log(`[${actualSource}] 🔄 [${attempt}/${RATE_LIMIT_CONFIG.maxRetries}] ${method} ${endpoint}`);
            
            const startTime = Date.now();
            const response = await fetch(targetUrl, options);
            const responseTime = Date.now() - startTime;
            
            console.log(`[${actualSource}] 📡 Response: ${response.status} in ${responseTime}ms`);

            if (response.ok) {
                const responseText = await response.text();
                
                if (!responseText) {
                    console.warn(`[${actualSource}] ⚠️ Empty response from: ${endpoint}`);
                    semaphore.release();
                    return { success: false, message: 'Empty response from server' };
                }

                try {
                    const jsonData = JSON.parse(responseText);
                    const dataSize = Array.isArray(jsonData.body) ? jsonData.body.length : 'N/A';
                    console.log(`[${actualSource}] ✅ Success: ${endpoint} (${dataSize} items, ${responseTime}ms)`);
                    
                    semaphore.release();
                    return jsonData;
                    
                } catch (parseError) {
                    console.error(`[${actualSource}] 💥 JSON Parse error:`, parseError.message);
                    console.error(`[${actualSource}] 📄 Response text (first 500 chars):`, responseText.substring(0, 500));
                    semaphore.release();
                    return { success: false, message: 'Invalid JSON response', details: responseText.substring(0, 200) };
                }
            }

            // Handle error responses
            const errorText = await response.text().catch(() => 'No error text');
            const shouldRetry = RATE_LIMIT_CONFIG.retryOn.includes(response.status) && attempt < RATE_LIMIT_CONFIG.maxRetries;
            
            if (response.status === 429) {
                // Rate limit detected
                const retryAfterHeader = response.headers.get('retry-after');
                const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader) : 0;
                const delay = calculateDelay(attempt, true, !!retryAfterHeader, retryAfterSeconds);
                
                console.error(`[${actualSource}] 🚫 RATE LIMITED! Status: ${response.status}`);
                console.error(`[${actualSource}] 📄 Error response:`, errorText.substring(0, 300));
                console.warn(`[${actualSource}] ⏰ Waiting ${Math.round(delay/1000)}s before retry (attempt ${attempt}/${RATE_LIMIT_CONFIG.maxRetries})`);
                
                if (shouldRetry) {
                    semaphore.release();
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            } else if (shouldRetry) {
                const delay = calculateDelay(attempt, false);
                console.warn(`[${actualSource}] ⚠️ Server error ${response.status}. Retrying in ${Math.round(delay/1000)}s... Error: ${errorText.substring(0, 200)}`);
                semaphore.release();
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            console.error(`[${actualSource}] ❌ Final error: ${response.status} for ${endpoint}`);
            console.error(`[${actualSource}] 📄 Error details:`, errorText.substring(0, 300));
            semaphore.release();
            return { 
                success: false, 
                message: `API Error: ${response.status}`, 
                status: response.status,
                details: errorText.substring(0, 200)
            };

        } catch (error) {
            const isNetworkError = error.code === 'ECONNRESET' || 
                                  error.code === 'ETIMEDOUT' || 
                                  error.code === 'ENOTFOUND' ||
                                  error.message.includes('timeout') ||
                                  error.message.includes('network');
                                  
            console.error(`[${actualSource}] 🔌 Network error (attempt ${attempt}):`, error.message);
            
            const shouldRetry = attempt < RATE_LIMIT_CONFIG.maxRetries && isNetworkError;
            
            if (shouldRetry) {
                const delay = calculateDelay(attempt, false);
                console.log(`[${actualSource}] 🔄 Network retry in ${Math.round(delay/1000)}s...`);
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

// Ultra-safe sequential processing with delays
async function processSequentiallyWithDelays(items, asyncFn, source = 'dkhp', itemName = 'item') {
    const results = [];
    
    console.log(`[${source}] 🔄 Processing ${items.length} ${itemName}s sequentially...`);
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`[${source}] 📋 Processing ${itemName} ${i + 1}/${items.length}`);
        
        try {
            const result = await asyncFn(item, i);
            results.push(result);
            console.log(`[${source}] ✅ Completed ${itemName} ${i + 1}/${items.length}`);
        } catch (error) {
            console.error(`[${source}] ❌ Error processing ${itemName} ${i + 1}:`, error.message);
            results.push({ error: true, message: error.message });
        }
        
        // Add delay between items (except for the last one)
        if (i < items.length - 1) {
            console.log(`[${source}] ⏳ Waiting ${RATE_LIMIT_CONFIG.sequentialDelay}ms before next ${itemName}...`);
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.sequentialDelay));
        }
    }
    
    return results;
}

// Get schedule details without any caching
async function getScheduleDetailsNow(classId, token, source) {
    console.log(`[${source}] 📋 Getting schedule details for class ${classId}`);
    const result = await callApiWithoutCache(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    
    if (result && result.success && result.body) {
        console.log(`[${source}] ✅ Schedule details retrieved for class ${classId}`);
        return result.body;
    } else {
        console.warn(`[${source}] ❌ Failed to get schedule details for class ${classId}:`, result?.message);
        return { error: true, message: result?.message || 'Failed to fetch schedule details' };
    }
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
    console.log(`🚀 [${new Date().toISOString()}] Starting action: ${action}`);
    console.log(`📊 Payload:`, JSON.stringify(payload));

    try {
        let result;
        
        switch (action) {
            case 'login': {
                const { username, password } = payload;
                console.log(`🔐 Login attempt for user: ${username}`);
                result = await callApiWithoutCache('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                console.log('📊 Getting initial data...');
                
                // Sequential calls to avoid any rate limiting
                const profileRes = await callApiWithoutCache('/user/getSummaryProfile', 'GET', token);
                console.log('⏳ Waiting before next request...');
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.sequentialDelay));
                
                const dotsRes = await callApiWithoutCache(`/getDot`, 'GET', token);
                
                const latestDot = (dotsRes.success && dotsRes.body?.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                    
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot
                };
                console.log('📊 Initial data result:', { hasProfile: !!result.profile, hasDot: !!result.dot });
                break;
            }

            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                console.log(`📅 Getting full schedule for dot ${dotId}, prerequisites: ${fetchPrerequisites}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                // Process each source sequentially with delays
                for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
                    const source = sources[sourceIndex];
                    console.log(`\n📚 === Processing source ${sourceIndex + 1}/${sources.length}: ${source} ===`);
                    
                    // Get subjects from this source
                    console.log(`[${source}] 📖 Fetching subjects...`);
                    const subjectsRes = await callApiWithoutCache(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (!subjectsRes.success) {
                        console.error(`[${source}] ❌ Failed to get subjects:`, subjectsRes.message);
                        continue;
                    }
                    
                    if (!Array.isArray(subjectsRes.body)) {
                        console.error(`[${source}] ❌ Invalid subjects response:`, typeof subjectsRes.body);
                        continue;
                    }

                    console.log(`[${source}] ✅ Found ${subjectsRes.body.length} subjects`);

                    // Store subject types for dkhp
                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => {
                            if (s.maHocPhan) {
                                subjectTypeMap[s.maHocPhan] = s.isBatBuoc;
                            }
                        });
                        console.log(`[${source}] 📝 Stored ${Object.keys(subjectTypeMap).length} subject types`);
                    }

                    // Process subjects sequentially
                    await processSequentiallyWithDelays(
                        subjectsRes.body, 
                        async (subject, index) => {
                            console.log(`[${source}] 📚 Processing subject: ${subject.maHocPhan} (${index + 1}/${subjectsRes.body.length})`);
                            
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApiWithoutCache(classEndpoint, 'GET', token, null, source);

                            if (!classRes.success) {
                                console.warn(`[${source}] ⚠️ No classes for subject ${subject.maHocPhan}: ${classRes.message}`);
                                return;
                            }

                            if (!Array.isArray(classRes.body)) {
                                console.warn(`[${source}] ⚠️ Invalid classes response for ${subject.maHocPhan}`);
                                return;
                            }

                            console.log(`[${source}] 📚 Found ${classRes.body.length} classes for ${subject.maHocPhan}`);

                            // Process each class sequentially
                            await processSequentiallyWithDelays(
                                classRes.body,
                                async (cls, classIndex) => {
                                    console.log(`[${source}] 🏫 Processing class ${cls.id} (${classIndex + 1}/${classRes.body.length})`);
                                    
                                    const scheduleDetails = await getScheduleDetailsNow(cls.id, token, source);
                                    const classData = { ...subject, ...cls, source, scheduleDetails };
                                    allClassData.push(classData);
                                    
                                    console.log(`[${source}] ✅ Added class ${cls.id}, total classes: ${allClassData.length}`);
                                },
                                source,
                                'class'
                            );
                        },
                        source,
                        'subject'
                    );
                    
                    console.log(`[${source}] 🎉 Completed source ${source}. Total classes so far: ${allClassData.length}`);
                    
                    // Add delay between sources
                    if (sourceIndex < sources.length - 1) {
                        console.log(`⏳ Waiting ${RATE_LIMIT_CONFIG.batchDelay}ms before next source...`);
                        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.batchDelay));
                    }
                }
                
                console.log(`\n📅 🎉 FINAL RESULT: ${allClassData.length} total classes retrieved`);
                console.log(`📝 Subject types: ${Object.keys(subjectTypeMap).length} subjects`);
                
                result = { 
                    success: true, 
                    schedule: allClassData, 
                    subjectTypes: subjectTypeMap,
                    totalClasses: allClassData.length,
                    totalSubjectTypes: Object.keys(subjectTypeMap).length
                };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                console.log(`📋 Getting registered classes for dot ${dotId}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    console.log(`[${source}] 📋 Getting registered classes...`);
                    const regRes = await callApiWithoutCache(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (!regRes.success) {
                        console.warn(`[${source}] ⚠️ Failed to get registered classes: ${regRes.message}`);
                        continue;
                    }
                    
                    if (!Array.isArray(regRes.body)) {
                        console.warn(`[${source}] ⚠️ Invalid registered classes response`);
                        continue;
                    }

                    console.log(`[${source}] ✅ Found ${regRes.body.length} registered classes`);
                    
                    // Process registered classes sequentially
                    await processSequentiallyWithDelays(
                        regRes.body,
                        async (reg, index) => {
                            console.log(`[${source}] 📋 Processing registration ${reg.id} (${index + 1}/${regRes.body.length})`);
                            
                            const detailRes = await callApiWithoutCache(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes?.success) 
                                ? detailRes.body 
                                : { error: true, message: detailRes?.message || 'Failed to get schedule details' };
                            
                            registeredData.push({ ...reg, source, scheduleDetails });
                        },
                        source,
                        'registration'
                    );
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
                
                result = await callApiWithoutCache(classEndpoint, 'GET', token, null, source);
                break;
            }

            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                console.log(`✅ Registering class ${classId} from ${source}`);
                result = await callApiWithoutCache(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                console.log(`❌ Canceling registration ${registrationId} from ${source}`);
                result = await callApiWithoutCache(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ [${new Date().toISOString()}] Action ${action} completed successfully in ${duration}ms`);
        console.log(`📊 Final result success: ${result?.success}, data length: ${JSON.stringify(result).length}`);
        
        res.status(200).json(result);

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ [${new Date().toISOString()}] Handler error for ${action} after ${duration}ms:`);
        console.error(error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};