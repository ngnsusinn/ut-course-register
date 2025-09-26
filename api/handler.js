const fetch = require('node-fetch');

// Balanced rate limiting - avoid both rate limits and timeouts
const RATE_LIMIT_CONFIG = {
    maxRetries: 6,
    baseDelay: 1000, // Reduced base delay
    maxDelay: 30000, // Reduced max delay  
    backoffMultiplier: 1.6,
    jitterMax: 500,
    
    // Optimized concurrent limits
    concurrentLimits: {
        'user': 2,      // User APIs are usually more stable
        'dkhp': 2,      // Allow 2 concurrent for main API
        'dkhpdk': 2,    // Allow 2 concurrent for prerequisite API
    },
    
    // Reduced delays to prevent timeouts
    requestDelay: 400,         // 400ms between requests
    sequentialDelay: 300,      // 300ms between sequential items
    batchDelay: 1500,          // 1.5s between batches
    classDelay: 200,           // 200ms between classes
    scheduleDelay: 150,        // 150ms between schedule requests
    
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

// Enhanced delay calculation with 524 timeout handling
function calculateDelay(attempt, isRateLimit = false, isTimeout = false, hasRetryAfter = false, retryAfterSeconds = 0) {
    if (hasRetryAfter && retryAfterSeconds > 0) {
        return Math.min(retryAfterSeconds * 1000, RATE_LIMIT_CONFIG.maxDelay);
    }
    
    let delay = RATE_LIMIT_CONFIG.baseDelay * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt - 1);
    
    if (isRateLimit) {
        delay *= 3; // Less aggressive than before
    } else if (isTimeout) {
        // For timeouts, use shorter delays to retry faster
        delay *= 1.5;
    }
    
    delay = Math.min(delay, RATE_LIMIT_CONFIG.maxDelay);
    
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
                timeout: 45000 // Reduced timeout to 45 seconds
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
            const isTimeout = response.status === 524 || response.status === 504;
            const shouldRetry = RATE_LIMIT_CONFIG.retryOn.includes(response.status) && attempt < RATE_LIMIT_CONFIG.maxRetries;
            
            if (response.status === 429) {
                // Rate limit detected
                const retryAfterHeader = response.headers.get('retry-after');
                const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader) : 0;
                const delay = calculateDelay(attempt, true, false, !!retryAfterHeader, retryAfterSeconds);
                
                console.error(`[${actualSource}] 🚫 RATE LIMITED! Status: ${response.status}`);
                console.warn(`[${actualSource}] ⏰ Waiting ${Math.round(delay/1000)}s before retry...`);
                
                if (shouldRetry) {
                    semaphore.release();
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            } else if (isTimeout) {
                // Handle timeout errors (524, 504)
                const delay = calculateDelay(attempt, false, true);
                console.error(`[${actualSource}] ⏱️ TIMEOUT ERROR ${response.status}! Server took too long to respond.`);
                console.warn(`[${actualSource}] ⏰ Retrying in ${Math.round(delay/1000)}s... (attempt ${attempt}/${RATE_LIMIT_CONFIG.maxRetries})`);
                
                if (shouldRetry) {
                    semaphore.release();
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            } else if (shouldRetry) {
                const delay = calculateDelay(attempt, false, false);
                console.warn(`[${actualSource}] ⚠️ Server error ${response.status}. Retrying in ${Math.round(delay/1000)}s...`);
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

// Smart batch processing with hybrid approach
async function processBatches(items, asyncFn, source = 'dkhp', itemName = 'item', batchSize = 3) {
    const results = [];
    
    console.log(`[${source}] 🔄 Processing ${items.length} ${itemName}s in batches of ${batchSize}...`);
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(items.length / batchSize);
        
        console.log(`[${source}] 📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} ${itemName}s)`);
        
        try {
            // Process batch items in parallel for better performance
            const batchPromises = batch.map(async (item, batchIndex) => {
                const globalIndex = i + batchIndex;
                console.log(`[${source}] 📋 Processing ${itemName} ${globalIndex + 1}/${items.length}`);
                return await asyncFn(item, globalIndex);
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            console.log(`[${source}] ✅ Completed batch ${batchNumber}/${totalBatches}`);
            
        } catch (error) {
            console.error(`[${source}] ❌ Error in batch ${batchNumber}:`, error.message);
            // Add error placeholders for failed batch
            const errorResults = batch.map(() => ({ error: true, message: error.message }));
            results.push(...errorResults);
        }
        
        // Add delay between batches (except for the last one)
        if (i + batchSize < items.length) {
            console.log(`[${source}] ⏳ Waiting ${RATE_LIMIT_CONFIG.batchDelay}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.batchDelay));
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

                    // Process subjects in small batches
                    await processBatches(
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

                            // Process classes with smaller delays
                            for (let classIndex = 0; classIndex < classRes.body.length; classIndex++) {
                                const cls = classRes.body[classIndex];
                                console.log(`[${source}] 🏫 Processing class ${cls.id} (${classIndex + 1}/${classRes.body.length})`);
                                
                                const scheduleDetails = await getScheduleDetailsNow(cls.id, token, source);
                                const classData = { ...subject, ...cls, source, scheduleDetails };
                                allClassData.push(classData);
                                
                                console.log(`[${source}] ✅ Added class ${cls.id}, total: ${allClassData.length}`);
                                
                                // Small delay between classes to avoid overwhelming
                                if (classIndex < classRes.body.length - 1) {
                                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.classDelay));
                                }
                            }
                            
                            // Small delay between schedule details requests
                            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.scheduleDelay));
                        },
                        source,
                        'subject',
                        2 // Process 2 subjects per batch
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
                    
                    // Process in small batches
                    await processBatches(
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
                        'registration',
                        3 // Process 3 registrations per batch
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