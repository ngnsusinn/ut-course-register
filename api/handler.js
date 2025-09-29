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
const CACHE_TTL = 3 * 60 * 1000; // 3 phút

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

// === UTILS ===
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

// === RATE-LIMIT SAFE HELPERS ===
const MAX_CONCURRENT_DETAIL = 2; // giới hạn đồng thời request chi tiết lịch
let inflightDetail = 0;

function isHtml(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t.startsWith('<') || t.includes('<html') || t.includes('<!doctype html');
}

function needRetry(status, contentType, text) {
  const ct = (contentType || '').toLowerCase();
  if (status === 429 || status === 503) return true;
  if (status === 403) return true;
  if (ct && !ct.includes('application/json')) return true;
  if (text && isHtml(text)) return true;
  return false;
}

async function fetchWithHandling(url, options, { retries = 4, baseDelay = 700, maxDelay = 4500 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      const status = res.status;
      const contentType = res.headers.get('content-type') || '';

      let data = null;
      let text = null;

      if (contentType.toLowerCase().includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          text = await res.text().catch(() => '');
        }
      } else {
        text = await res.text().catch(() => '');
      }

      if (res.ok && data && (data.success !== false)) {
        return { ok: true, status, data, contentType };
      }

      const shouldRetry = needRetry(status, contentType, text);
      if (shouldRetry && attempt < retries) {
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1)) + jitter;
        await sleep(delay);
        continue;
      }

      const message = data?.message || `HTTP ${status}` + (text ? ` | non-JSON: ${text.slice(0, 120)}...` : '');
      return { ok: false, status, data, text, message, contentType };
    } catch (err) {
      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * 200);
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1)) + jitter;
        await sleep(delay);
        continue;
      }
      return { ok: false, status: 0, message: err.message };
    }
  }
  return { ok: false, status: 0, message: 'Unknown error after retries' };
}

// === CORE API CALLS (thay thế callApiWithCustomTimeout/callApi cũ) ===
function buildBaseUrl(endpoint, source) {
  if (endpoint.startsWith('/user/')) return 'https://portal.ut.edu.vn/api/v1';
  if (source === 'dkhpdk') return 'https://portal.ut.edu.vn/api/v1/dkhpdk';
  return 'https://portal.ut.edu.vn/api/v1/dkhp';
}

async function callApiCore(endpoint, method, token, body = null, source = 'dkhp', {
  retries = 4,
  timeoutMs = 30000,
  cacheable = (method === 'GET')
} = {}) {
  const baseApiUrl = buildBaseUrl(endpoint, source);
  const targetUrl = baseApiUrl + endpoint;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'UTH-Helper/1.0'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    timeout: timeoutMs
  };

  const cacheKey = getCacheKey(endpoint, { method, body, source });
  if (cacheable) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  debugLog(`API CORE -> ${method} ${targetUrl} | timeout=${timeoutMs}, retries=${retries}`);

  const resp = await fetchWithHandling(targetUrl, options, {
    retries,
    baseDelay: source === 'dkhpdk' ? 900 : 700,
    maxDelay: source === 'dkhpdk' ? 5500 : 4500
  });

  if (!resp.ok) {
    const msg = resp.message || `API Error: Status ${resp.status}`;
    debugLog(`API CORE ERROR <- ${targetUrl} | ${msg}`);
    return { success: false, message: msg, status: resp.status, nonJson: !!resp.text, snippet: resp.text?.slice(0, 160) };
  }

  const result = resp.data;
  if (cacheable && result?.success) {
    setCachedData(cacheKey, result);
  }
  return result;
}

async function callApi(endpoint, method, token, body = null, source = 'dkhp', retries = 3) {
  const timeoutMs = source === 'dkhpdk' ? 45000 : 30000;
  return callApiCore(endpoint, method, token, body, source, { retries: Math.max(3, retries), timeoutMs });
}

// === DETAIL SLOTS ===
async function acquireDetailSlot() {
  while (inflightDetail >= MAX_CONCURRENT_DETAIL) {
    await sleep(150);
  }
  inflightDetail++;
}
function releaseDetailSlot() {
  inflightDetail = Math.max(0, inflightDetail - 1);
}

// === SCHEDULE DETAILS (rate-limit safe) ===
async function getScheduleDetailsWithFallback(classId, token, source, retries = 5) {
  await acquireDetailSlot();
  try {
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (attempt > 1) {
        const delay = Math.min(5000, 800 * Math.pow(2, attempt - 2)) + Math.floor(Math.random() * 250);
        await sleep(delay);
      }

      const r = await callApiCore(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source, {
        retries: 1,
        timeoutMs: attempt === 1 ? 30000 : 45000
      });

      if (!r?.success && r?.nonJson) {
        debugLog(`Detail non-JSON (likely rate-limit) class=${classId} attempt=${attempt} snippet=${r.snippet || ''}`);
        if (attempt < retries) continue;
        return { error: true, message: 'Non-JSON (rate-limited/WAF)', status: 200, classId };
      }

      if (!r?.success && (r?.status === 403 || r?.status === 429 || r?.status === 503)) {
        debugLog(`Detail rate-limited status=${r.status} class=${classId} attempt=${attempt}`);
        if (attempt < retries) continue;
        return { error: true, message: `Access limited (${r.status})`, status: r.status, classId };
      }

      if (!r?.success) {
        if (attempt < retries && r?.status !== 404) continue;
        return { error: true, message: r?.message || 'API failed', status: r?.status || 0, classId };
      }

      if (!Array.isArray(r.body)) return [];
      return r.body;
    }
    return { error: true, message: 'Max retries exceeded', classId };
  } finally {
    releaseDetailSlot();
  }
}

// (giữ lại nếu nơi nào cũ có gọi)
async function getScheduleDetails(classId, token, source, retries = 3) {
  return getScheduleDetailsWithFallback(classId, token, source, Math.max(3, retries));
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

            case 'getClassSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId } = payload;
                debugLog(`Manual retry for class schedule: ${classId}`);
                if (!classId) {
                    return res.status(400).json({ success: false, message: 'Missing classId parameter' });
                }
                const sources = ['dkhp', 'dkhpdk'];
                let lastError = null;
                for (const source of sources) {
                    try {
                        const scheduleDetails = await getScheduleDetailsWithFallback(classId, token, source);
                        if (scheduleDetails && !scheduleDetails.error) {
                            result = { success: true, scheduleDetails, source };
                            break;
                        } else if (scheduleDetails && scheduleDetails.error) {
                            lastError = scheduleDetails;
                            if (scheduleDetails.status && scheduleDetails.status !== 403) break;
                        }
                    } catch (error) {
                        lastError = { error: true, message: error.message };
                    }
                }
                if (!result) {
                    result = { 
                        success: false, 
                        message: lastError?.message || 'Could not retrieve schedule from any source',
                        error: lastError || { error: true, message: 'Unknown error' }
                    };
                }
                break;
            }

            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites, _forceRefresh } = payload;
                const cacheKey = `fullSchedule_${dotId}_${fetchPrerequisites ? 'with_prereq' : 'no_prereq'}`;
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

                for (const source of sources) {
                    let sourceRetries = 0;
                    const maxSourceRetries = 2;
                    let sourceSuccess = false;

                    while (!sourceSuccess && sourceRetries < maxSourceRetries) {
                        try {
                            debugLog(`--- Processing source: ${source} (attempt ${sourceRetries + 1}) ---`);
                            if (source === 'dkhpdk' && sourceRetries === 0) {
                                await sleep(1000);
                            }
                            const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source, 3);
                            const validation = validateApiResponse(subjectsRes, `subjects for ${source}`);
                            if (!validation.isValid) {
                                debugLog(`Failed validation for ${source}: ${validation.message}`);
                                sourceRetries++;
                                if (sourceRetries < maxSourceRetries) {
                                    await sleep(2000 * sourceRetries);
                                    continue;
                                } else break;
                            }
                            if (validation.isEmpty) {
                                debugLog(`Empty response for ${source}`);
                                sourceSuccess = true;
                                break;
                            }

                            debugLog(`Found ${subjectsRes.body.length} subjects for ${source}`);
                            if (source === 'dkhp') {
                                subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                                debugLog(`Stored ${Object.keys(subjectTypeMap).length} subject types`);
                            }

                            const subjectPromises = subjectsRes.body.map(async (subject) => {
                                const classEndpoint = source === 'dkhpdk'
                                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;

                                const classRes = await callApi(classEndpoint, 'GET', token, null, source, 3);
                                const classValidation = validateApiResponse(classRes, `classes for ${subject.maHocPhan} from ${source}`);
                                if (!classValidation.isValid || classValidation.isEmpty) return [];

                                const classPromises = classRes.body.map(async (cls, index) => {
                                    if (index > 0 && index % 10 === 0) {
                                        await sleep(2000);
                                    }
                                    const scheduleDetails = await getScheduleDetailsWithFallback(cls.id, token, source);
                                    return { ...subject, ...cls, source, scheduleDetails };
                                });

                                return await throttledPromiseAll(classPromises, 2, source === 'dkhpdk' ? 500 : 300);
                            });

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
                                await sleep(3000 * sourceRetries);
                            } else {
                                debugLog(`Max retries reached for ${source}, skipping...`);
                            }
                        }
                    }

                    if (!sourceSuccess) {
                        debugLog(`WARNING: Failed to process source ${source} after ${maxSourceRetries} attempts`);
                    }
                }

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
                        cacheKey: cacheKey,
                        fetchPrerequisites: fetchPrerequisites
                    }
                };
                setCachedData(cacheKey, result);
                break;
            }

            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites } = payload;
                const cacheKey = `registeredClasses_${dotId}_${fetchPrerequisites}`;
                const cached = getCachedData(cacheKey);
                if (cached) return res.status(200).json(cached);

                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];
                for (const source of sources) {
                    try {
                        const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                        const validation = validateApiResponse(regRes, `registered classes for ${source}`);
                        if (!validation.isValid || validation.isEmpty) continue;

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
