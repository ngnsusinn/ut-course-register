/**
 * Modal Module
 * Handles all modal dialogs in the application
 */

window.AppModal = {
    /**
     * Show a confirmation modal
     * @param {string} message - Message to display (HTML supported)
     * @param {Function} onConfirm - Callback when confirmed
     * @param {Function} onCancel - Callback when cancelled
     */
    showConfirm: (message, onConfirm, onCancel) => {
        // Remove existing modal if any
        document.getElementById('confirm-modal')?.remove();
        
        const modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.className = 'payment-modal';
        modal.style.display = 'block';
        
        modal.innerHTML = `
            <div class="payment-modal-content" style="max-width: 450px; margin: 15% auto;">
                <div class="text-center">
                    <div class="mb-4">
                        <svg class="mx-auto h-12 w-12 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                    </div>
                    <h3 class="text-xl font-bold text-gray-900 mb-3">Xác nhận</h3>
                    <p class="text-gray-700 mb-6">${message}</p>
                    <div class="flex space-x-3 justify-center">
                        <button id="confirm-yes-btn" class="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-2 rounded-lg transition duration-300">
                            Xác nhận
                        </button>
                        <button id="confirm-no-btn" class="bg-gray-500 hover:bg-gray-600 text-white font-semibold px-6 py-2 rounded-lg transition duration-300">
                            Hủy
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
        document.getElementById('confirm-yes-btn').addEventListener('click', () => {
            modal.remove();
            if (onConfirm) onConfirm();
        });
        
        document.getElementById('confirm-no-btn').addEventListener('click', () => {
            modal.remove();
            if (onCancel) onCancel();
        });
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                if (onCancel) onCancel();
            }
        });
    },

    /**
     * Show the guide modal
     */
    showGuide: async () => {
        try {
            const response = await fetch('guide.html');
            const guideContent = await response.text();
            
            const modal = document.createElement('div');
            modal.className = 'payment-modal';
            modal.id = 'guide-modal';
            modal.style.display = 'block';
            
            modal.innerHTML = `
                <div class="payment-modal-content bg-white rounded-xl shadow-md p-6" style="max-width: 900px;">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-2xl font-bold text-gray-800">📖 Hướng dẫn sử dụng</h2>
                        <span class="close-modal" onclick="document.getElementById('guide-modal').remove()">&times;</span>
                    </div>
                    <div class="overflow-y-auto" style="max-height: 70vh;">
                        ${guideContent}
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        } catch (error) {
            window.AppUtils.log('❌ Không thể tải hướng dẫn sử dụng', true);
            console.error('Guide load error:', error);
        }
    },

    /**
     * Remove a modal by ID
     * @param {string} modalId - Modal element ID
     */
    remove: (modalId) => {
        document.getElementById(modalId)?.remove();
    }
};
