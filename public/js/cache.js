/**
 * Cache Module
 * Manages data caching with Map lookups for O(1) performance
 */

window.AppCache = {
    // Data stores
    allScheduleData: [],
    registeredClassesData: [],
    selectedClasses: new Map(),
    swapPendingClasses: new Map(),
    subjectTypeMap: new Map(),
    
    // Cache Maps for O(1) lookups
    scheduleByIdMap: new Map(),
    scheduleByCodeMap: new Map(),
    registeredByIdMap: new Map(),
    registeredByCodeMap: new Map(),

    /**
     * Rebuild schedule cache maps
     */
    rebuildScheduleCache: () => {
        const cache = window.AppCache;
        cache.scheduleByIdMap.clear();
        cache.scheduleByCodeMap.clear();
        cache.allScheduleData.forEach(cls => {
            cache.scheduleByIdMap.set(cls.id.toString(), cls);
            cache.scheduleByCodeMap.set(cls.maLopHocPhan, cls);
        });
    },

    /**
     * Rebuild registered cache maps
     */
    rebuildRegisteredCache: () => {
        const cache = window.AppCache;
        cache.registeredByIdMap.clear();
        cache.registeredByCodeMap.clear();
        cache.registeredClassesData.forEach(cls => {
            cache.registeredByIdMap.set(cls.id.toString(), cls);
            cache.registeredByCodeMap.set(cls.maLopHocPhan, cls);
        });
    },

    // O(1) lookup functions
    getScheduleById: (id) => window.AppCache.scheduleByIdMap.get(id?.toString()),
    getScheduleByCode: (code) => window.AppCache.scheduleByCodeMap.get(code),
    getRegisteredById: (id) => window.AppCache.registeredByIdMap.get(id?.toString()),
    getRegisteredByCode: (code) => window.AppCache.registeredByCodeMap.get(code),

    /**
     * Find and remove existing swap entry for a registered class
     * @param {string} regId - Registered class ID
     * @returns {string|null} Key of removed entry or null
     */
    removeSwapByRegisteredId: (regId) => {
        const cache = window.AppCache;
        let oldSwapKey = null;
        cache.swapPendingClasses.forEach((swap, key) => {
            if (swap.registered.id.toString() === regId.toString()) {
                oldSwapKey = key;
            }
        });
        if (oldSwapKey) {
            cache.swapPendingClasses.delete(oldSwapKey);
        }
        return oldSwapKey;
    },

    /**
     * Add swap pending entry
     * @param {string} targetId - Target class ID (used as key)
     * @param {Object} registeredClass - Registered class data
     * @param {Object} targetClass - Target class data
     */
    addSwapPending: (targetId, registeredClass, targetClass) => {
        window.AppCache.swapPendingClasses.set(targetId.toString(), {
            registered: registeredClass,
            target: targetClass
        });
    },

    /**
     * Save data to localStorage
     * @param {string} userId - Current user ID
     */
    saveToStorage: (userId) => {
        try {
            const cache = window.AppCache;
            const CONFIG = window.AppConfig.get();
            
            // Rebuild lookup caches
            cache.rebuildScheduleCache();
            cache.rebuildRegisteredCache();
            
            const cacheData = {
                userId: userId,
                allScheduleData: cache.allScheduleData,
                registeredClassesData: cache.registeredClassesData,
                selectedClasses: Array.from(cache.selectedClasses.entries()),
                swapPendingClasses: Array.from(cache.swapPendingClasses.entries()),
                subjectTypeMap: Array.from(cache.subjectTypeMap.entries()),
                prerequisiteToggleState: document.getElementById('prerequisite-toggle')?.checked || false,
                timestamp: new Date().getTime()
            };
            localStorage.setItem('userDataCache', JSON.stringify(cacheData));
        } catch (error) {
            console.error('Failed to save cache:', error);
        }
    },

    /**
     * Load data from localStorage
     * @param {string} currentUserId - Current user ID
     * @returns {boolean} Whether cache was loaded successfully
     */
    loadFromStorage: (currentUserId) => {
        try {
            const cache = window.AppCache;
            const CONFIG = window.AppConfig.get();
            
            const cached = localStorage.getItem('userDataCache');
            if (!cached) return false;

            const cacheData = JSON.parse(cached);
            
            // Check if cached data belongs to a different user
            if (cacheData.userId && cacheData.userId !== currentUserId) {
                console.log('Cache belongs to different user, clearing...');
                localStorage.removeItem('userDataCache');
                return false;
            }
            
            // Check cache expiry
            if (new Date().getTime() - cacheData.timestamp > CONFIG.CACHE_DURATION) {
                localStorage.removeItem('userDataCache');
                return false;
            }

            // Restore data
            cache.allScheduleData = cacheData.allScheduleData || [];
            cache.registeredClassesData = cacheData.registeredClassesData || [];
            cache.selectedClasses = new Map(cacheData.selectedClasses || []);
            cache.swapPendingClasses = new Map(cacheData.swapPendingClasses || []);
            cache.subjectTypeMap = new Map(cacheData.subjectTypeMap || []);
            
            // Rebuild lookup caches
            cache.rebuildScheduleCache();
            cache.rebuildRegisteredCache();
            
            // Restore prerequisite toggle state
            const toggle = document.getElementById('prerequisite-toggle');
            if (toggle && cacheData.prerequisiteToggleState !== undefined) {
                toggle.checked = cacheData.prerequisiteToggleState;
            }

            return true;
        } catch (error) {
            console.error('Failed to load cache:', error);
            localStorage.removeItem('userDataCache');
            return false;
        }
    },

    /**
     * Clear all cache data
     */
    clear: () => {
        const cache = window.AppCache;
        cache.allScheduleData = [];
        cache.registeredClassesData = [];
        cache.selectedClasses.clear();
        cache.swapPendingClasses.clear();
        cache.subjectTypeMap.clear();
        cache.scheduleByIdMap.clear();
        cache.scheduleByCodeMap.clear();
        cache.registeredByIdMap.clear();
        cache.registeredByCodeMap.clear();
        localStorage.removeItem('userDataCache');
    }
};
