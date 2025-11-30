/**
 * Swap Validation Module
 * Handles validation for class swap operations
 */

window.AppSwap = {
    /**
     * Check if a class swap is allowed
     * @param {Object} registeredClass - The registered class to swap from
     * @param {Object} targetClass - The target class to swap to
     * @returns {Object} { canSwap: boolean, reason: string }
     */
    canSwapClass: (registeredClass, targetClass) => {
        const CONFIG = window.AppConfig.get();
        
        if (!registeredClass) {
            return { canSwap: false, reason: 'Không tìm thấy thông tin lớp' };
        }
        
        const registeredStatus = registeredClass.tenTrangThaiLopHocPhan || '';
        const targetStatus = targetClass?.tenTrangThai || '';
        
        // Check registered class can be cancelled
        if (CONFIG.LOCKED_STATUSES.includes(registeredStatus)) {
            return { canSwap: false, reason: `Trạng thái: ${registeredStatus}` };
        }
        
        if (registeredClass.isAllowCancel === false && registeredStatus !== 'Đang chờ đăng ký') {
            return { canSwap: false, reason: `Trạng thái: ${registeredStatus}` };
        }
        
        // Check target class can be registered
        if (CONFIG.TARGET_BLOCKED_STATUSES.includes(targetStatus)) {
            return { canSwap: false, reason: `Lớp đích - Trạng thái: ${targetStatus}` };
        }
        
        return { canSwap: true, reason: '' };
    },

    /**
     * Execute a class swap (cancel old, register new)
     * @param {Object} registeredData - Registered class data
     * @param {Object} targetData - Target class data
     * @param {number} dotId - Dot ID for checking availability
     * @returns {Promise<boolean>} Whether swap was successful
     */
    executeSwap: async (registeredData, targetData, dotId) => {
        const API = window.AppAPI;
        const Utils = window.AppUtils;
        
        const { id: regId, code: regCode, name: regName, source: regSource } = registeredData;
        const { id: targetId, code: targetCode, name: targetName, source: targetSource, maHocPhan: targetMaHocPhan } = targetData;
        
        Utils.log(`🔄 Bắt đầu đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
        
        // Step 1: Check target class availability
        Utils.log(`🔍 Kiểm tra lớp đích ${targetCode}...`);
        
        const maHocPhan = targetMaHocPhan || targetCode.slice(0, -2);
        const checkResult = await API.checkClassAvailability(targetId, dotId, maHocPhan, targetSource);
        
        if (!checkResult || !checkResult.success) {
            Utils.log(`⚠️ Không thể kiểm tra lớp đích, dừng đổi lớp để an toàn`, true);
            return false;
        }
        
        if (checkResult.isFull) {
            Utils.log(`❌ Lớp ${targetCode} đã đầy (${checkResult.phanTramDangKy}%)`, true);
            return false;
        }
        
        if (!checkResult.canRegister) {
            Utils.log(`❌ Lớp ${targetCode} không thể đăng ký - ${checkResult.message}`, true);
            return false;
        }
        
        Utils.log(`✅ Lớp ${targetCode} còn chỗ (${checkResult.phanTramDangKy}%), tiếp tục đổi lớp...`);
        
        // Step 2: Cancel old registered class
        Utils.log(`🗑️ Đang hủy lớp cũ ${regName} (${regCode})...`);
        const cancelResult = await API.cancel(regId, regSource);
        
        if (!cancelResult || !cancelResult.success) {
            Utils.log(`❌ Hủy lớp ${regCode} thất bại: ${cancelResult?.message || 'Lỗi không xác định'}`, true);
            return false;
        }
        
        Utils.log(`✅ Đã hủy lớp ${regCode} thành công`);
        
        // Step 3: Register target class
        Utils.log(`📝 Đang đăng ký lớp ${targetName} (${targetCode})...`);
        const registerResult = await API.register(targetId, targetSource);
        
        if (!registerResult || !registerResult.success) {
            Utils.log(`❌ Đăng ký lớp ${targetCode} thất bại: ${registerResult?.message || 'Lỗi không xác định'}`, true);
            Utils.log(`⚠️ CẢNH BÁO: Đã hủy lớp ${regCode} nhưng không đăng ký được lớp ${targetCode}. Vui lòng đăng ký lại thủ công!`, true);
            return false;
        }
        
        Utils.log(`✅ Đăng ký lớp ${targetCode} thành công!`);
        Utils.log(`🎉 Đổi lớp hoàn tất: ${regName} → ${targetName}`);
        
        return true;
    }
};
