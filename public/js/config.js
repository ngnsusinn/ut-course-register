/**
 * Configuration Module
 * Loads config from backend (.env) with fallback defaults
 */

// Default configuration (fallback if API fails)
const DEFAULT_CONFIG = {
    // Timing (in milliseconds)
    SESSION_DURATION: 24 * 60 * 60 * 1000,      // 24 hours
    CACHE_DURATION: 24 * 60 * 60 * 1000,        // 24 hours
    PAYMENT_TIMEOUT: 15 * 60 * 1000,            // 15 minutes
    VIP_CHECK_INTERVAL: 7000,                    // 7 seconds
    PAYMENT_CHECK_INTERVAL: 2000,                // 2 seconds
    DEFAULT_DELAY: 1000,                         // 1 second
    
    // Evening class periods (never conflict)
    EVENING_PERIODS: [16, 17, 18],
    
    // Class statuses that prevent actions
    LOCKED_STATUSES: ['Đã khóa lớp', 'Đã mở chính thức', 'Đang lên kế hoạch'],
    TARGET_BLOCKED_STATUSES: ['Đã khóa lớp', 'Đang lên kế hoạch']
};

// Active configuration (will be populated from backend)
let CONFIG = { ...DEFAULT_CONFIG };

/**
 * Load configuration from backend
 * @returns {Promise<Object>} Configuration object
 */
async function loadConfig() {
    try {
        const response = await fetch('/api/handler', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getConfig' })
        });
        
        const data = await response.json();
        
        if (data.success && data.config) {
            CONFIG = { ...DEFAULT_CONFIG, ...data.config };
            console.log('✅ Configuration loaded from server');
        } else {
            console.warn('⚠️ Using default configuration');
        }
    } catch (error) {
        console.error('❌ Failed to load config:', error);
        console.warn('⚠️ Using default configuration');
    }
    
    return CONFIG;
}

/**
 * Get current configuration
 * @returns {Object} Configuration object
 */
function getConfig() {
    return CONFIG;
}

// Export for use in other modules
window.AppConfig = {
    load: loadConfig,
    get: getConfig,
    DEFAULT: DEFAULT_CONFIG
};
