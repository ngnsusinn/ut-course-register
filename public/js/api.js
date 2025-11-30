/**
 * API Module
 * Handles all backend communication
 */

window.AppAPI = {
    authToken: null,

    /**
     * Set authentication token
     * @param {string} token - JWT token
     */
    setToken: (token) => {
        window.AppAPI.authToken = token;
    },

    /**
     * Get current authentication token
     * @returns {string|null} JWT token
     */
    getToken: () => {
        return window.AppAPI.authToken;
    },

    /**
     * Make a request to the backend
     * @param {string} action - Action name
     * @param {Object} payload - Request payload
     * @returns {Promise<Object|null>} Response data or null on error
     */
    request: async (action, payload = {}) => {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (window.AppAPI.authToken) {
                headers['Authorization'] = `Bearer ${window.AppAPI.authToken}`;
            }
            
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action, payload })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP Error: ${response.status}` }));
                window.AppUtils.log(`Lỗi '${action}': ${errorData.message}`, true);
                return null;
            }
            
            return await response.json();
        } catch (error) {
            window.AppUtils.log(`Lỗi mạng khi gọi backend: ${error.message}`, true);
            return null;
        }
    },

    // === Authentication ===
    
    /**
     * Login with username and password
     * @param {string} username - Username
     * @param {string} password - Password
     * @returns {Promise<Object|null>} Login response
     */
    login: async (username, password) => {
        return await window.AppAPI.request('login', { username, password });
    },

    /**
     * Get initial data after login
     * @returns {Promise<Object|null>} Initial data
     */
    getInitialData: async () => {
        return await window.AppAPI.request('getInitialData');
    },

    /**
     * Validate token with portal
     * @returns {Promise<boolean>} Whether token is valid
     */
    validateToken: async () => {
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.AppAPI.authToken}`
                },
                body: JSON.stringify({ action: 'validateToken' })
            });
            
            const data = await response.json();
            return data.success && data.valid;
        } catch (error) {
            console.error('Token validation failed:', error);
            return false;
        }
    },

    // === VIP ===
    
    /**
     * Check VIP status for user
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} VIP status
     */
    checkVIPStatus: async (userId) => {
        return await window.AppAPI.request('checkVIPStatus', { userId });
    },

    /**
     * Get VIP plans
     * @returns {Promise<Object|null>} VIP plans data
     */
    getVIPPlans: async () => {
        return await window.AppAPI.request('getVIPPlans');
    },

    /**
     * Create VIP order
     * @param {string} userId - User ID
     * @param {string} plan - Plan key
     * @returns {Promise<Object|null>} Order data
     */
    createVIPOrder: async (userId, plan) => {
        return await window.AppAPI.request('createVIPOrder', { userId, plan });
    },

    /**
     * Check order status
     * @param {number} orderId - Order ID
     * @returns {Promise<Object|null>} Order status
     */
    checkOrderStatus: async (orderId) => {
        return await window.AppAPI.request('checkOrderStatus', { orderId });
    },

    /**
     * Cancel order
     * @param {number} orderId - Order ID
     * @returns {Promise<Object|null>} Cancel result
     */
    cancelOrder: async (orderId) => {
        return await window.AppAPI.request('cancelOrder', { orderId });
    },

    // === Schedule ===
    
    /**
     * Get full schedule
     * @param {number} dotId - Dot ID
     * @param {boolean} fetchPrerequisites - Whether to fetch prerequisites
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} Schedule data
     */
    getFullSchedule: async (dotId, fetchPrerequisites, userId) => {
        return await window.AppAPI.request('getFullSchedule', { dotId, fetchPrerequisites, userId });
    },

    /**
     * Get registered classes
     * @param {number} dotId - Dot ID
     * @param {boolean} fetchPrerequisites - Whether to fetch prerequisites
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} Registered classes
     */
    getRegisteredClasses: async (dotId, fetchPrerequisites, userId) => {
        return await window.AppAPI.request('getRegisteredClasses', { dotId, fetchPrerequisites, userId });
    },

    /**
     * Check class status
     * @param {number} dotId - Dot ID
     * @param {string} maHocPhan - Subject code
     * @param {string} source - Source (dkhp/dkhpdk)
     * @returns {Promise<Object|null>} Class status
     */
    checkClassStatus: async (dotId, maHocPhan, source) => {
        return await window.AppAPI.request('checkClassStatus', { dotId, maHocPhan, source });
    },

    /**
     * Get schedule details for a class
     * @param {number} classId - Class ID
     * @param {string} source - Source (dkhp/dkhpdk)
     * @returns {Promise<Object|null>} Schedule details
     */
    getScheduleDetails: async (classId, source) => {
        return await window.AppAPI.request('getScheduleDetails', { classId, source });
    },

    /**
     * Check class availability
     * @param {number} classId - Class ID
     * @param {number} dotId - Dot ID
     * @param {string} maHocPhan - Subject code
     * @param {string} source - Source
     * @returns {Promise<Object|null>} Availability info
     */
    checkClassAvailability: async (classId, dotId, maHocPhan, source) => {
        return await window.AppAPI.request('checkClassAvailability', { classId, dotId, maHocPhan, source });
    },

    // === Registration ===
    
    /**
     * Register for a class
     * @param {number} classId - Class ID
     * @param {string} source - Source
     * @returns {Promise<Object|null>} Registration result
     */
    register: async (classId, source) => {
        return await window.AppAPI.request('register', { classId, source });
    },

    /**
     * Cancel registration
     * @param {number} registrationId - Registration ID
     * @param {string} source - Source
     * @returns {Promise<Object|null>} Cancel result
     */
    cancel: async (registrationId, source) => {
        return await window.AppAPI.request('cancel', { registrationId, source });
    }
};
