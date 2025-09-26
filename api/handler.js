const fetch = require('node-fetch');

// Tiện ích: Gọi API nội bộ của trường với retry mechanism
async function callApi(endpoint, method, token, body = null, source = 'dkhp', retries = 3) {
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

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const options = { 
                method, 
                headers, 
                body: body ? JSON.stringify(body) : null, 
                timeout: 60000 // Tăng timeout lên 60s
            };

            console.log(`[Attempt ${attempt + 1}] Calling: ${targetUrl}`);
            
            const response = await fetch(targetUrl, options);
            
            // Log response status
            console.log(`Response status: ${response.status} for ${targetUrl}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`API Error: Status ${response.status}, Response: ${errorText}`);
                
                // Retry on server errors (5xx) or rate limiting (429)
                if ((response.status >= 500 || response.status === 429) && attempt < retries - 1) {
                    console.log(`Retrying in ${(attempt + 1) * 2} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
                    continue;
                }
                
                return { 
                    success: false, 
                    message: `API Error: Status ${response.status}`, 
                    status: response.status,
                    details: errorText
                };
            }

            const responseText = await response.text();
            
            // Check if response is empty
            if (!responseText) {
                console.warn(`Empty response from: ${targetUrl}`);
                return { success: false, message: 'Empty response from server' };
            }

            try {
                const jsonData = JSON.parse(responseText);
                console.log(`Success: ${targetUrl}, Data length: ${JSON.stringify(jsonData).length}`);
                return jsonData;
            } catch (parseError) {
                console.error(`JSON Parse error for ${targetUrl}:`, parseError);
                return { success: false, message: 'Invalid JSON response', details: responseText };
            }

        } catch (error) {
            console.error(`Network error for ${targetUrl} (attempt ${attempt + 1}):`, error.message);
            
            if (attempt < retries - 1) {
                console.log(`Retrying in ${(attempt + 1) * 2} seconds...`);
                await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
            } else {
                return { success: false, message: `Network error after ${retries} attempts: ${error.message}` };
            }
        }
    }
}

// Tiện ích: Rate limiting helper
async function rateLimitedMap(array, asyncFn, concurrency = 5) {
    const results = [];
    for (let i = 0; i < array.length; i += concurrency) {
        const batch = array.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(asyncFn));
        results.push(...batchResults);
        
        // Small delay between batches to avoid overwhelming the server
        if (i + concurrency < array.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    return results;
}

// Tiện ích: Lấy chi tiết lịch học cho một lớp
async function getScheduleDetails(classId, token, source) {
    console.log(`Getting schedule details for class ${classId} from source ${source}`);
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    
    if (result && result.success) {
        console.log(`Schedule details retrieved for class ${classId}`);
        return result.body;
    } else {
        console.warn(`Failed to get schedule details for class ${classId}:`, result?.message);
        return { error: true, message: result?.message || 'Unknown error' };
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

    console.log(`Processing action: ${action}`);

    try {
        let result;
        switch (action) {
            // --- HÀNH ĐỘNG XÁC THỰC ---
            case 'login': {
                const { username, password } = payload;
                console.log(`Login attempt for user: ${username}`);
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                console.log('Getting initial data...');
                const [profileRes, dotsRes] = await Promise.all([
                    callApi('/user/getSummaryProfile', 'GET', token),
                    callApi(`/getDot`, 'GET', token)
                ]);
                
                const latestDot = (dotsRes.success && dotsRes.body && dotsRes.body.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                    
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot
                };
                console.log('Initial data retrieved:', { hasProfile: !!result.profile, hasDot: !!result.dot });
                break;
            }

            // --- HÀNH ĐỘNG LẤY DỮ LIỆU ---
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                console.log(`Getting full schedule for dot ${dotId}, fetchPrerequisites: ${fetchPrerequisites}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                for (const source of sources) {
                    console.log(`Processing source: ${source}`);
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (!subjectsRes.success) {
                        console.warn(`Failed to get subjects from ${source}:`, subjectsRes.message);
                        continue;
                    }
                    
                    if (!Array.isArray(subjectsRes.body)) {
                        console.warn(`Invalid subjects response from ${source}:`, typeof subjectsRes.body);
                        continue;
                    }

                    console.log(`Found ${subjectsRes.body.length} subjects from ${source}`);

                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    // Process subjects with rate limiting
                    await rateLimitedMap(subjectsRes.body, async (subject) => {
                        try {
                            const classEndpoint = source === 'dkhpdk'
                                ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                            
                            const classRes = await callApi(classEndpoint, 'GET', token, null, source);

                            if (classRes.success && Array.isArray(classRes.body)) {
                                console.log(`Found ${classRes.body.length} classes for subject ${subject.maHocPhan}`);
                                
                                // Process classes with rate limiting
                                await rateLimitedMap(classRes.body, async (cls) => {
                                    const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                    allClassData.push({ ...subject, ...cls, source, scheduleDetails });
                                }, 3); // Lower concurrency for schedule details
                            } else {
                                console.warn(`No classes found for subject ${subject.maHocPhan} from ${source}`);
                            }
                        } catch (error) {
                            console.error(`Error processing subject ${subject.maHocPhan}:`, error.message);
                        }
                    }, 3); // Process 3 subjects concurrently
                }
                
                console.log(`Total classes retrieved: ${allClassData.length}`);
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites } = payload;
                console.log(`Getting registered classes for dot ${dotId}`);
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    console.log(`Getting registered classes from ${source}`);
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    
                    if (regRes.success && Array.isArray(regRes.body)) {
                        console.log(`Found ${regRes.body.length} registered classes from ${source}`);
                        
                        await rateLimitedMap(regRes.body, async (reg) => {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes && detailRes.success) 
                                ? detailRes.body 
                                : { error: true, message: detailRes?.message || 'Failed to get schedule details' };
                            registeredData.push({ ...reg, source, scheduleDetails });
                        }, 5);
                    }
                }
                
                console.log(`Total registered classes: ${registeredData.length}`);
                result = { success: true, body: registeredData };
                break;
            }
            
            case 'checkClassStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, maHocPhan, source } = payload;
                console.log(`Checking class status for ${maHocPhan} from ${source}`);
                
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
                console.log(`Registering class ${classId} from ${source}`);
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                console.log(`Canceling registration ${registrationId} from ${source}`);
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        
        console.log(`Action ${action} completed successfully`);
        res.status(200).json(result);

    } catch (error) {
        console.error(`Handler error for action ${action}:`, error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};