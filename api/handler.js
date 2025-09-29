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

    const options = { 
        method, 
        headers, 
        body: body ? JSON.stringify(body) : null, 
        timeout: 30000 
    };

    debugLog(`API Call: ${method} ${targetUrl} (source: ${source})`);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            if (attempt > 1) {
                await sleep(1000 * attempt);
            }
            
            const response = await fetch(targetUrl, options);
            
            if (response.status === 429) {
                debugLog(`Rate limited on attempt ${attempt} for ${targetUrl}`);
                if (attempt < retries) {
                    await sleep(2000 * attempt);
                    continue;
                }
            }
            
            if (!response.ok) {
                return { 
                    success: false, 
                    message: `API Error: Status ${response.status}`, 
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
            if (attempt === retries) {
                return { success: false, message: error.message };
            }
        }
    }
}

// === IMPROVED SCHEDULE DETAILS FUNCTION ===
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    const validation = validateApiResponse(result, `schedule details for class ${classId}`);
    
    if (!validation.isValid) {
        return { error: true, message: validation.message };
    }
    
    if (validation.isEmpty) {
        return [];
    }
    
    return result.body;
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

                // Process each source independently and merge results
                const sourceResults = {};
                
                for (const source of sources) {
                    try {
                        debugLog(`--- Processing source: ${source} ---`);
                        
                        const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                        const validation = validateApiResponse(subjectsRes, `subjects for ${source}`);
                        
                        if (!validation.isValid) {
                            debugLog(`Failed validation for ${source}: ${validation.message}`);
                            sourceResults[source] = [];
                            continue;
                        }

                        if (validation.isEmpty) {
                            debugLog(`Empty response for ${source}`);
                            sourceResults[source] = [];
                            continue;
                        }

                        debugLog(`Found ${subjectsRes.body.length} subjects for ${source}`);

                        // Store subject types only from dkhp
                        if (source === 'dkhp') {
                            subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                            debugLog(`Stored ${Object.keys(subjectTypeMap).length} subject types`);
                        }

                        const sourceClassData = [];

                        // Process subjects in batches
                        const subjectPromises = subjectsRes.body.map(async (subject) => {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApi(classEndpoint, 'GET', token, null, source);
                            const classValidation = validateApiResponse(classRes, `classes for ${subject.maHocPhan} from ${source}`);
                            
                            if (!classValidation.isValid || classValidation.isEmpty) {
                                return [];
                            }
                            
                            const classPromises = classRes.body.map(async (cls) => {
                                const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                return { ...subject, ...cls, source, scheduleDetails };
                            });
                            
                            return await throttledPromiseAll(classPromises, 2, 300);
                        });

                        const batchResults = await throttledPromiseAll(subjectPromises, 3, 500);
                        const flatResults = batchResults.flat();
                        
                        sourceResults[source] = flatResults;
                        debugLog(`Completed ${source}: ${flatResults.length} classes processed`);
                        
                    } catch (error) {
                        debugLog(`Error processing source ${source}: ${error.message}`);
                        sourceResults[source] = [];
                    }
                }

                // Merge all source results
                sources.forEach(source => {
                    if (sourceResults[source]) {
                        allClassData.push(...sourceResults[source]);
                    }
                });

                // Final counts
                const dkhpCount = allClassData.filter(c => c.source === 'dkhp').length;
                const dkhpdkCount = allClassData.filter(c => c.source === 'dkhpdk').length;
                
                debugLog(`Final result: ${allClassData.length} total classes`);
                debugLog(`DKHP: ${dkhpCount}, DKHPDK: ${dkhpdkCount}`);

                result = { 
                    success: true, 
                    schedule: allClassData, 
                    subjectTypes: subjectTypeMap,
                    debug: {
                        sources: sources,
                        counts: { dkhp: dkhpCount, dkhpdk: dkhpdkCount },
                        cacheKey: cacheKey
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
