const fetch = require('node-fetch');

// === CACHING SYSTEM ===
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 phút

function getCacheKey(endpoint, params) {
    return `${endpoint}_${JSON.stringify(params)}`;
}

function getCachedData(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    cache.delete(key);
    return null;
}

function setCachedData(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
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
        
        // Delay giữa các batch
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

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Add delay for retry attempts
            if (attempt > 1) {
                await sleep(1000 * attempt);
            }
            
            const response = await fetch(targetUrl, options);
            
            if (response.status === 429) { // Rate limited
                console.log(`Rate limited on attempt ${attempt}, retrying...`);
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
            
            return result;
        } catch (error) {
            console.error(`API call failed on attempt ${attempt}:`, error.message);
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

            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                const cacheKey = `fullSchedule_${dotId}_${fetchPrerequisites}`;
                
                // Check cache first
                const cached = getCachedData(cacheKey);
                if (cached) {
                    return res.status(200).json(cached);
                }
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                for (const source of sources) {
                    try {
                        const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                        const validation = validateApiResponse(subjectsRes, `subjects for ${source}`);
                        
                        if (!validation.isValid) {
                            console.log(`Failed to get subjects for ${source}:`, validation.message);
                            continue;
                        }

                        if (validation.isEmpty) {
                            console.log(`No subjects found for ${source}`);
                            continue;
                        }

                        if (source === 'dkhp') {
                            subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                        }

                        // Process subjects in batches to avoid rate limiting
                        const subjectPromises = subjectsRes.body.map(async (subject) => {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApi(classEndpoint, 'GET', token, null, source);
                            const classValidation = validateApiResponse(classRes, `classes for ${subject.maHocPhan}`);
                            
                            if (!classValidation.isValid || classValidation.isEmpty) {
                                return [];
                            }
                            
                            const classPromises = classRes.body.map(async (cls) => {
                                const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                return { ...subject, ...cls, source, scheduleDetails };
                            });
                            
                            // Throttle schedule detail requests
                            return await throttledPromiseAll(classPromises, 2, 300);
                        });

                        // Process subject batches with throttling
                        const batchResults = await throttledPromiseAll(subjectPromises, 3, 500);
                        allClassData.push(...batchResults.flat());
                        
                    } catch (error) {
                        console.error(`Error processing source ${source}:`, error);
                    }
                }

                result = { 
                    success: true, 
                    schedule: allClassData, 
                    subjectTypes: subjectTypeMap 
                };
                
                // Cache the result
                setCachedData(cacheKey, result);
                
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                const cacheKey = `registeredClasses_${dotId}_${fetchPrerequisites}`;
                
                // Check cache first
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
                        
                        // Throttle registration detail requests
                        const batchResults = await throttledPromiseAll(registrationPromises, 3, 400);
                        registeredData.push(...batchResults);
                        
                    } catch (error) {
                        console.error(`Error processing registered classes for ${source}:`, error);
                    }
                }
                
                result = { success: true, body: registeredData };
                
                // Cache the result
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
			// Thêm vào switch case trong handler.js
case 'clearCache': {
    const { cacheType } = payload;
    
    if (cacheType === 'schedule') {
        // Clear all schedule-related cache
        cache.forEach((_, key) => {
            if (key.includes('fullSchedule') || key.includes('registeredClasses')) {
                cache.delete(key);
            }
        });
        result = { success: true, message: 'Schedule cache cleared' };
    } else {
        cache.clear();
        result = { success: true, message: 'All cache cleared' };
    }
    break;
}


            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('Handler Error:', error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};
