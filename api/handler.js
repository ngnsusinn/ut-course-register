const fetch = require('node-fetch');

// === DEBUG MODE ===
const DEBUG = process.env.DEBUG_MODE === 'true' || false;
const debugLog = (message, data = null) => {
    if (DEBUG) {
        console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
};

// === CACHING SYSTEM ===
const cache = new Map();
const CACHE_TTL = 3 * 60 * 1000; // Giảm xuống 3 phút để debug

function getCacheKey(endpoint, params) {
    return `${endpoint}_${JSON.stringify(params)}`;
}

function getCachedData(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        debugLog(`Cache HIT for key: ${key}`);
        return cached.data;
    }
    cache.delete(key);
    debugLog(`Cache MISS for key: ${key}`);
    return null;
}

function setCachedData(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
    debugLog(`Cache SET for key: ${key}, data size: ${JSON.stringify(data).length}`);
}

// === UTILITY FUNCTIONS ===
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttledPromiseAll(promises, limit = 3, delay = 500) {
    const results = [];
    for (let i = 0; i < promises.length; i += limit) {
        const batch = promises.slice(i, i + limit);
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
        
        if (i + limit < promises.length) {
            await sleep(delay);
        }
    }
    return results;
}

const validateApiResponse = (response, context) => {
    if (!response) {
        return { isValid: false, message: `No response from ${context}` };
    }
    
    if (!response.success) {
        return { isValid: false, message: response.message || `Failed ${context}` };
    }
    
    if (Array.isArray(response.body) && response.body.length === 0) {
        return { isValid: true, isEmpty: true, message: `No data available for ${context}` };
    }
    
    return { isValid: true, isEmpty: false };
};

// === IMPROVED API CALL FUNCTION ===
async function callApi(endpoint, method, token, body = null, source = 'dkhp', retries = 3) {
    const cacheKey = getCacheKey(endpoint, { method, body, source });
    
    // Check cache first for GET requests
    if (method === 'GET') {
        const cached = getCachedData(cacheKey);
        if (cached) return cached;
    }
    
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

    // Increase timeout especially for dkhpdk
    const timeoutMs = source === 'dkhpdk' ? 45000 : 30000; // 45s for dkhpdk, 30s for others
    
    const options = { 
        method, 
        headers, 
        body: body ? JSON.stringify(body) : null, 
        timeout: timeoutMs
    };

    debugLog(`API Call: ${method} ${targetUrl} (source: ${source}, timeout: ${timeoutMs}ms)`);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            if (attempt > 1) {
                const delay = source === 'dkhpdk' ? 2000 * attempt : 1000 * attempt;
                debugLog(`Retrying ${targetUrl} after ${delay}ms delay...`);
                await sleep(delay);
            }
            
            const response = await fetch(targetUrl, options);
            
            if (response.status === 429) {
                debugLog(`Rate limited on attempt ${attempt} for ${targetUrl}`);
                if (attempt < retries) {
                    const rateLimitDelay = source === 'dkhpdk' ? 3000 * attempt : 2000 * attempt;
                    await sleep(rateLimitDelay);
                    continue;
                }
            }
            
            if (!response.ok) {
                const errorMessage = `API Error: Status ${response.status}`;
                debugLog(`${errorMessage} for ${targetUrl}`);
                return { 
                    success: false, 
                    message: errorMessage, 
                    status: response.status 
                };
            }
            
            const result = await response.json();
            
            // Cache successful GET requests
            if (method === 'GET' && result.success) {
                setCachedData(cacheKey, result);
            }
            
            debugLog(`API Success: ${targetUrl} returned ${Array.isArray(result.body) ? result.body.length : 'non-array'} items`);
            return result;
            
        } catch (error) {
            debugLog(`API Error on attempt ${attempt}: ${error.message}`);
            if (error.name === 'AbortError' || error.message.includes('timeout')) {
                debugLog(`Timeout detected for ${targetUrl} on attempt ${attempt}`);
            }
            
            if (attempt === retries) {
                return { success: false, message: `${error.message} (after ${retries} attempts)` };
            }
        }
    }
}


// === IMPROVED SCHEDULE DETAILS FUNCTION ===
async function getScheduleDetails(classId, token, source, retries = 3) {
    debugLog(`Getting schedule details for classId: ${classId}, source: ${source}`);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Add progressive delay for retries
            if (attempt > 1) {
                const delay = 1000 * attempt; // 1s, 2s, 3s
                debugLog(`Retrying schedule details for ${classId}, attempt ${attempt} after ${delay}ms`);
                await sleep(delay);
            }
            
            const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source, 2);
            
            if (!result) {
                debugLog(`No result for schedule details classId: ${classId}, attempt: ${attempt}`);
                if (attempt < retries) continue;
                return { error: true, message: 'No response from API', classId };
            }
            
            if (!result.success) {
                debugLog(`Failed schedule details for ${classId}: ${result.message}, attempt: ${attempt}`);
                if (attempt < retries) continue;
                return { error: true, message: result.message || 'API call failed', classId };
            }
            
            if (!result.body || !Array.isArray(result.body) || result.body.length === 0) {
                debugLog(`Empty schedule details for ${classId}, attempt: ${attempt}`);
                if (attempt < retries) continue;
                // Return empty array instead of error for empty schedules (this might be normal)
                return [];
            }
            
            debugLog(`Successfully got ${result.body.length} schedule details for classId: ${classId}`);
            return result.body;
            
        } catch (error) {
            debugLog(`Exception getting schedule details for ${classId}, attempt ${attempt}: ${error.message}`);
            if (attempt === retries) {
                return { error: true, message: error.message, classId };
            }
        }
    }
    
    // Fallback - should not reach here
    return { error: true, message: 'Max retries exceeded', classId };
}


// === MAIN HANDLER ===
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    debugLog(`Handler called with action: ${action}`, payload);

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
                
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                
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

            case 'clearCache': {
                const { cacheType } = payload;
                
                if (cacheType === 'schedule') {
                    let cleared = 0;
                    cache.forEach((_, key) => {
                        if (key.includes('fullSchedule') || key.includes('registeredClasses')) {
                            cache.delete(key);
                            cleared++;
                        }
                    });
                    debugLog(`Cleared ${cleared} schedule cache entries`);
                    result = { success: true, message: `Cleared ${cleared} schedule cache entries` };
                } else {
                    const cacheSize = cache.size;
                    cache.clear();
                    debugLog(`Cleared all cache (${cacheSize} entries)`);
                    result = { success: true, message: `Cleared all cache (${cacheSize} entries)` };
                }
                break;
            }

            case 'getFullSchedule': {
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
    
    const { dotId, fetchPrerequisites, _forceRefresh } = payload;
    
    // Create unique cache key
    const cacheKey = `fullSchedule_${dotId}_${fetchPrerequisites ? 'with_prereq' : 'no_prereq'}`;
    
    // Check cache only if not forcing refresh
    if (!_forceRefresh) {
        const cached = getCachedData(cacheKey);
        if (cached) {
            debugLog(`Returning cached fullSchedule: ${cached.schedule?.length || 0} classes`);
            return res.status(200).json(cached);
        }
    }
    
    debugLog(`Fetching fresh fullSchedule data. dotId: ${dotId}, fetchPrerequisites: ${fetchPrerequisites}`);
    
    const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
    let allClassData = [];
    let subjectTypeMap = {};
    
    debugLog(`Processing sources: ${sources.join(', ')}`);

    // ===== IMPROVED: SEQUENTIAL PROCESSING WITH RETRIES =====
    for (const source of sources) {
        let sourceRetries = 0;
        const maxSourceRetries = 2;
        let sourceSuccess = false;
        
        while (!sourceSuccess && sourceRetries < maxSourceRetries) {
            try {
                debugLog(`--- Processing source: ${source} (attempt ${sourceRetries + 1}) ---`);
                
                // Add delay for dkhpdk to avoid timing issues
                if (source === 'dkhpdk' && sourceRetries === 0) {
                    await sleep(1000); // 1 second delay for stability
                }
                
                const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source, 3); // 3 retries
                const validation = validateApiResponse(subjectsRes, `subjects for ${source}`);
                
                if (!validation.isValid) {
                    debugLog(`Failed validation for ${source}: ${validation.message}`);
                    sourceRetries++;
                    if (sourceRetries < maxSourceRetries) {
                        await sleep(2000 * sourceRetries); // Progressive delay
                        continue;
                    } else {
                        break; // Skip this source after max retries
                    }
                }

                if (validation.isEmpty) {
                    debugLog(`Empty response for ${source} - this is normal if no data exists`);
                    sourceSuccess = true; // Empty is still "success"
                    break;
                }

                debugLog(`Found ${subjectsRes.body.length} subjects for ${source}`);

                // Store subject types only from dkhp
                if (source === 'dkhp') {
                    subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    debugLog(`Stored ${Object.keys(subjectTypeMap).length} subject types`);
                }

                const sourceClassData = [];

                // Process subjects in smaller batches with longer delays
                const subjectPromises = subjectsRes.body.map(async (subject) => {
                    const classEndpoint = source === 'dkhpdk'
                        ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                        : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                    
                    const classRes = await callApi(classEndpoint, 'GET', token, null, source, 3); // 3 retries per call
                    const classValidation = validateApiResponse(classRes, `classes for ${subject.maHocPhan} from ${source}`);
                    
                    if (!classValidation.isValid || classValidation.isEmpty) {
                        return [];
                    }
                    
                    const classPromises = classRes.body.map(async (cls) => {
                        const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                        return { ...subject, ...cls, source, scheduleDetails };
                    });
                    
                    // Smaller batches, longer delays for stability
                    return await throttledPromiseAll(classPromises, 2, source === 'dkhpdk' ? 500 : 300);
                });

                // Process with smaller batches and longer delays for dkhpdk
                const batchSize = source === 'dkhpdk' ? 2 : 3;
                const batchDelay = source === 'dkhpdk' ? 800 : 500;
                
                const batchResults = await throttledPromiseAll(subjectPromises, batchSize, batchDelay);
                const flatResults = batchResults.flat();
                
                allClassData.push(...flatResults);
                debugLog(`Completed ${source}: ${flatResults.length} classes processed`);
                sourceSuccess = true;
                
            } catch (error) {
                debugLog(`Error processing source ${source} (attempt ${sourceRetries + 1}): ${error.message}`);
                sourceRetries++;
                if (sourceRetries < maxSourceRetries) {
                    await sleep(3000 * sourceRetries); // Progressive delay on error
                } else {
                    debugLog(`Max retries reached for ${source}, skipping...`);
                }
            }
        }
        
        if (!sourceSuccess) {
            debugLog(`WARNING: Failed to process source ${source} after ${maxSourceRetries} attempts`);
        }
    }

    // Final counts
    const dkhpCount = allClassData.filter(c => c.source === 'dkhp').length;
    const dkhpdkCount = allClassData.filter(c => c.source === 'dkhpdk').length;
    
    debugLog(`Final result: ${allClassData.length} total classes`);
    debugLog(`DKHP: ${dkhpCount}, DKHPDK: ${dkhpdkCount}`);

    // Validation check for fetchPrerequisites
    if (fetchPrerequisites && dkhpdkCount === 0) {
        debugLog(`WARNING: fetchPrerequisites=true but got 0 dkhpdk classes - may indicate API issues`);
    }

    result = { 
        success: true, 
        schedule: allClassData, 
        subjectTypes: subjectTypeMap,
        debug: {
            sources: sources,
            counts: { dkhp: dkhpCount, dkhpdk: dkhpdkCount },
            cacheKey: cacheKey,
            fetchPrerequisites: fetchPrerequisites
        }
    };
    
    // Cache the result
    setCachedData(cacheKey, result);
    
    break;
}

            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                const cacheKey = `registeredClasses_${dotId}_${fetchPrerequisites}`;
                
                const cached = getCachedData(cacheKey);
                if (cached) {
                    return res.status(200).json(cached);
                }
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    try {
                        const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                        const validation = validateApiResponse(regRes, `registered classes for ${source}`);
                        
                        if (!validation.isValid || validation.isEmpty) {
                            continue;
                        }

                        const registrationPromises = regRes.body.map(async (reg) => {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const detailValidation = validateApiResponse(detailRes, `schedule for registration ${reg.id}`);
                            
                            const scheduleDetails = detailValidation.isValid && !detailValidation.isEmpty
                                ? detailRes.body 
                                : { error: true, message: detailValidation.message };
                                
                            return { ...reg, source, scheduleDetails };
                        });
                        
                        const batchResults = await throttledPromiseAll(registrationPromises, 3, 400);
                        registeredData.push(...batchResults);
                        
                    } catch (error) {
                        debugLog(`Error processing registered classes for ${source}: ${error.message}`);
                    }
                }
                
                result = { success: true, body: registeredData };
                setCachedData(cacheKey, result);
                
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
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                
                // Clear cache when registration happens
                cache.forEach((_, key) => {
                    if (key.includes('registeredClasses') || key.includes('fullSchedule')) {
                        cache.delete(key);
                    }
                });
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                
                // Clear cache when cancellation happens
                cache.forEach((_, key) => {
                    if (key.includes('registeredClasses') || key.includes('fullSchedule')) {
                        cache.delete(key);
                    }
                });
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        
        res.status(200).json(result);

    } catch (error) {
        debugLog('Handler Error: ' + error.message);
        console.error('Handler Error:', error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};
