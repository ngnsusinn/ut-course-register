/**
 * Swap Modal Module
 * Handles swap class modal UI and logic
 */
(function() {
    'use strict';

    const SwapModal = {
        /**
         * Show swap from conflict modal - allows swapping directly from conflict warning
         * @param {Object} params - Parameters object
         * @param {Object} params.registeredClassData - Registered class data { id, code, name, source }
         * @param {Object} params.targetClassData - Target class data { id, code, name }
         * @param {Function} params.getRegisteredById - Cache lookup function
         * @param {Function} params.getScheduleById - Cache lookup function
         * @param {Function} params.log - Logging function
         * @param {Function} params.updateSelectedList - Update UI function
         * @param {Function} params.renderScheduleTable - Render function
         */
        showFromConflict: async function(params) {
            const { 
                registeredClassData, 
                targetClassData,
                getRegisteredById,
                getScheduleById,
                log,
                updateSelectedList,
                renderScheduleTable
            } = params;

            const { id: regId, code: regCode, name: regName } = registeredClassData;
            const { id: targetId, code: targetCode, name: targetName } = targetClassData;
            
            const Cache = window.AppCache;
            const Modal = window.AppModal;
            
            // Find registered class details using cache
            const registeredClass = getRegisteredById(regId);
            if (!registeredClass) {
                log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
                return;
            }
            
            // Find target class using cache
            const targetClass = getScheduleById(targetId);
            if (!targetClass) {
                log('❌ Không tìm thấy thông tin lớp đích', true);
                return;
            }
            
            // Show modal to confirm swap to the target class directly
            Modal.showConfirm(
                `Xác nhận đổi lớp trùng lịch?<br><br>` +
                `<div class="bg-gray-50 p-3 rounded mb-2">` +
                `<p class="text-sm"><span class="font-semibold text-red-600">Hủy:</span> ${regName} <span class="text-gray-500">(${regCode})</span></p>` +
                `<p class="text-sm"><span class="font-semibold text-green-600">Đăng ký:</span> ${targetName} <span class="text-gray-500">(${targetCode})</span></p>` +
                `</div>` +
                `<p class="text-sm text-gray-600">Lớp mới sẽ được thêm vào danh sách đổi lớp.</p>`,
                () => {
                    // Remove old swap entry if exists and add new one
                    Cache.removeSwapByRegisteredId(regId);
                    Cache.addSwapPending(targetId, registeredClass, targetClass);
                    
                    log(`✅ Đã thêm vào danh sách đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
                    updateSelectedList();
                    
                    // Re-render schedule table to update conflict status
                    renderScheduleTable();
                },
                () => {
                    // On cancel - do nothing
                }
            );
        },

        /**
         * Show swap class modal from registered classes table
         * @param {Object} params - Parameters object
         */
        showFromRegistered: async function(params) {
            const {
                registeredClassData,
                dotId,
                getRegisteredById,
                getScheduleById,
                getScheduleByCode,
                backendRequest,
                log,
                updateSelectedList,
                formatScheduleDetail,
                checkScheduleConflictBetweenTwo
            } = params;

            const { id: regId, code: regCode, name: regName, source: regSource, subjectCode, status: regStatus } = registeredClassData;
            
            const Cache = window.AppCache;
            const Modal = window.AppModal;
            
            // Find registered class details using cache
            const registeredClass = getRegisteredById(regId);
            if (!registeredClass) {
                log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
                return;
            }
            
            // Get subject code - try multiple sources (prioritize registeredClass data)
            let actualSubjectCode = subjectCode || registeredClass.maHocPhan;
            
            // If still not found, extract from maLopHocPhan by removing last 2 characters
            if (!actualSubjectCode && regCode) {
                actualSubjectCode = regCode.slice(0, -2);
                console.log('✅ Extracted maHocPhan from maLopHocPhan:', regCode, '->', actualSubjectCode);
            }
            
            // Last resort: search using cache
            if (!actualSubjectCode) {
                let matchingClass = getScheduleById(regId) || getScheduleByCode(regCode);
                if (matchingClass) {
                    actualSubjectCode = matchingClass.maHocPhan;
                    console.log('✅ Found maHocPhan from cache:', actualSubjectCode);
                }
            }
            
            if (!actualSubjectCode) {
                log('❌ Không tìm thấy mã học phần của lớp này', true);
                console.log('❌ Debug info:');
                console.log('  - Registered class data:', registeredClass);
                console.log('  - Tried to find with:', { regId, regCode });
                console.log('  - subjectCode from button:', subjectCode);
                return;
            }
            
            console.log('🔍 Looking for classes with maHocPhan:', actualSubjectCode);
            console.log('📊 Total classes in Cache.allScheduleData:', Cache.allScheduleData.length);
            console.log('🔍 Current class code (regCode):', regCode);
            
            // Try to find classes in Cache.allScheduleData first
            let availableClasses = Cache.allScheduleData.filter(cls => {
                const matches = cls.maHocPhan === actualSubjectCode && 
                    cls.maLopHocPhan !== regCode &&
                    cls.tenTrangThai !== 'Đã khóa lớp' &&
                    cls.tenTrangThai !== 'Đang lên kế hoạch';
                
                if (cls.maHocPhan === actualSubjectCode) {
                    console.log('  ➜ Same subject:', cls.maLopHocPhan, '| isCurrent:', cls.maLopHocPhan === regCode, '| Status:', cls.tenTrangThai, '| Match:', matches);
                }
                
                return matches;
            });
            
            console.log('Classes found in Cache.allScheduleData:', availableClasses.length);
            
            // If no classes found in cache, fetch from API
            if (availableClasses.length === 0) {
                log(`🔍 Không tìm thấy lớp trong cache, đang lấy từ API cho môn ${regName}...`);
                
                let detectedMaHocPhan = actualSubjectCode;
                
                if (!detectedMaHocPhan || detectedMaHocPhan.length < 2) {
                    detectedMaHocPhan = regCode.slice(0, -2);
                    console.log('✅ Extracted maHocPhan from maLopHocPhan:', regCode, '->', detectedMaHocPhan);
                }
                
                console.log('🔍 Using maHocPhan for API call:', detectedMaHocPhan);
                
                const checkStatusRes = await backendRequest('checkClassStatus', { 
                    dotId, 
                    maHocPhan: detectedMaHocPhan, 
                    source: regSource 
                });
                
                if (checkStatusRes && checkStatusRes.success && Array.isArray(checkStatusRes.body)) {
                    const classesWithDetails = await Promise.all(
                        checkStatusRes.body.map(async (cls) => {
                            const scheduleDetails = await backendRequest('getScheduleDetails', {
                                classId: cls.id,
                                source: regSource
                            });
                            
                            return {
                                ...cls,
                                maHocPhan: detectedMaHocPhan,
                                tenMonHoc: regName,
                                source: regSource,
                                scheduleDetails: scheduleDetails?.success ? scheduleDetails.body : { error: true }
                            };
                        })
                    );
                    
                    availableClasses = classesWithDetails.filter(cls => 
                        cls.maLopHocPhan !== regCode &&
                        cls.tenTrangThai !== 'Đã khóa lớp' &&
                        cls.tenTrangThai !== 'Đang lên kế hoạch'
                    );
                    
                    console.log('Classes fetched from API:', availableClasses.length);
                    log(`✅ Đã lấy ${availableClasses.length} lớp từ API`);
                } else {
                    log(`❌ Không thể lấy danh sách lớp từ API`, true);
                }
            }
            
            if (availableClasses.length === 0) {
                log(`❌ Không có lớp nào khác để đổi cho môn ${regName} (Mã HP: ${actualSubjectCode})`, true);
                return;
            }
            
            // Create modal
            const modal = document.createElement('div');
            modal.id = 'swap-class-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
            
            modal.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                    <div class="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex justify-between items-center">
                        <div>
                            <h2 class="text-2xl font-bold">🔄 Đổi lớp học phần</h2>
                            <p class="text-sm text-blue-100 mt-1">Lớp hiện tại: ${regName} (${regCode})</p>
                        </div>
                        <button id="close-swap-modal" class="text-white hover:text-gray-200 transition">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                    
                    <div class="p-6 overflow-y-auto flex-1">
                        <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
                            <p class="text-sm text-gray-700">
                                <span class="font-bold">📋 Lịch học hiện tại:</span><br>
                                <div class="mt-2 text-gray-600">${formatScheduleDetail(registeredClass.scheduleDetails)}</div>
                            </p>
                        </div>
                        
                        <h3 class="text-lg font-bold text-gray-800 mb-3">Chọn lớp muốn đổi đến:</h3>
                        
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm text-left text-gray-500">
                                <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                                    <tr>
                                        <th scope="col" class="px-4 py-3">Mã LHP</th>
                                        <th scope="col" class="px-4 py-3">Lịch học</th>
                                        <th scope="col" class="px-4 py-3">Trạng thái</th>
                                        <th scope="col" class="px-4 py-3">Đã ĐK</th>
                                        <th scope="col" class="px-4 py-3">Hành động</th>
                                    </tr>
                                </thead>
                                <tbody id="swap-classes-tbody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Render available classes
            const tbody = modal.querySelector('#swap-classes-tbody');
            availableClasses.forEach(cls => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b hover:bg-gray-50';
                
                // Check if schedules conflict
                const hasConflict = checkScheduleConflictBetweenTwo(registeredClass.scheduleDetails, cls.scheduleDetails);
                const conflictBadge = hasConflict 
                    ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">⚠️ Trùng lịch</span>' 
                    : '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Không trùng</span>';
                
                const isFull = cls.phanTramDangKy >= 100;
                const statusColor = isFull ? 'text-red-600 font-bold' : 'text-green-600';
                
                row.innerHTML = `
                    <td class="px-4 py-3 font-medium">${cls.maLopHocPhan}</td>
                    <td class="px-4 py-3">
                        <div class="text-xs">${formatScheduleDetail(cls.scheduleDetails)}</div>
                    </td>
                    <td class="px-4 py-3">${cls.tenTrangThai || 'N/A'}</td>
                    <td class="px-4 py-3 ${statusColor}">${cls.phanTramDangKy}%</td>
                    <td class="px-4 py-3">
                        <div class="flex flex-col gap-2">
                            ${conflictBadge}
                            <button class="execute-swap-btn px-3 py-1 text-xs font-semibold rounded transition bg-blue-600 text-white hover:bg-blue-700"
                                    data-target-id="${cls.id}"
                                    data-target-code="${cls.maLopHocPhan}"
                                    data-target-name="${cls.tenMonHoc}"
                                    data-target-source="${cls.source}"
                                    data-has-conflict="${hasConflict}">
                                🔄 Đổi lớp
                            </button>
                        </div>
                    </td>
                `;
                
                tbody.appendChild(row);
            });
            
            // Close modal handler
            modal.querySelector('#close-swap-modal').addEventListener('click', () => {
                modal.remove();
            });
            
            // Click outside to close
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
            
            // Execute swap handler
            modal.querySelectorAll('.execute-swap-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const targetId = btn.dataset.targetId;
                    const targetCode = btn.dataset.targetCode;
                    const targetName = btn.dataset.targetName;
                    const hasConflict = btn.dataset.hasConflict === 'true';
                    
                    // Find target class full info from availableClasses
                    const targetClass = availableClasses.find(c => c.id.toString() === targetId);
                    if (!targetClass) {
                        alert('❌ Không tìm thấy thông tin lớp đích');
                        console.log('❌ Debug: targetId =', targetId);
                        console.log('❌ Available classes:', availableClasses.map(c => ({ id: c.id, code: c.maLopHocPhan })));
                        return;
                    }
                    
                    // Find registered class full info using cache
                    const registeredClassFull = getRegisteredById(regId);
                    if (!registeredClassFull) {
                        log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
                        return;
                    }
                    
                    const conflictWarning = hasConflict 
                        ? '<div class="mb-3 p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded"><p class="text-sm text-yellow-800 font-semibold">⚠️ CẢNH BÁO: Lớp này trùng lịch với lớp hiện tại!</p></div>'
                        : '';
                    
                    const slotInfo = targetClass.phanTramDangKy >= 100 
                        ? '<p class="text-sm text-orange-600 mt-2">⏳ Lớp đích đang đầy, hệ thống sẽ tự động chờ và đổi khi có chỗ trống.</p>'
                        : '<p class="text-sm text-green-600 mt-2">✅ Lớp đích còn chỗ, sẽ đổi ngay khi bắt đầu chèn/đăng ký.</p>';
                    
                    const confirmMsg = `
                        ${conflictWarning}
                        <p class="text-gray-700 mb-2">Xác nhận thêm vào danh sách đổi lớp?</p>
                        <div class="bg-gray-50 p-3 rounded mb-2">
                            <p class="text-sm"><span class="font-semibold text-red-600">Hủy:</span> ${regName} <span class="text-gray-500">(${regCode})</span></p>
                            <p class="text-sm"><span class="font-semibold text-green-600">Đăng ký:</span> ${targetName} <span class="text-gray-500">(${targetCode})</span></p>
                        </div>
                        ${slotInfo}
                    `;
                    
                    Modal.showConfirm(
                        confirmMsg,
                        () => {
                            // Remove old swap entry if exists
                            Cache.removeSwapByRegisteredId(regId);
                            
                            // Add new swap entry with target class ID as key
                            Cache.addSwapPending(targetId, registeredClassFull, targetClass);
                            
                            log(`✅ Đã thêm vào danh sách đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
                            
                            if (targetClass.phanTramDangKy >= 100) {
                                log(`⏳ Lớp đích đang đầy (${targetClass.phanTramDangKy}%), hệ thống sẽ tự động chờ cho đến khi có chỗ trống`);
                            }
                            
                            updateSelectedList();
                            modal.remove();
                        },
                        () => {
                            // On cancel - do nothing
                        }
                    );
                });
            });
        }
    };

    // Export to global scope
    window.AppSwapModal = SwapModal;
})();
