/**
 * VIP Module
 * Handles VIP modal, orders, payment checking, and VIP status management
 */

window.AppVIP = {
    // Internal state
    _currentOrder: null,
    _paymentCheckInterval: null,
    _vipExpiryCheckInterval: null,
    _callbacks: {},
    
    /**
     * Initialize VIP module with callbacks
     * @param {Object} callbacks - { backendRequest, log, onVIPStatusChange, onVIPExpired, getVIPStatus, getUserId, getConfig }
     */
    init(callbacks) {
        this._callbacks = callbacks;
    },
    
    /**
     * Get current order
     */
    get currentOrder() {
        return this._currentOrder;
    },
    
    /**
     * Set current order
     */
    set currentOrder(order) {
        this._currentOrder = order;
    },
    
    /**
     * Show VIP modal
     */
    async showModal() {
        const { backendRequest, log, getVIPStatus } = this._callbacks;
        const Templates = window.AppTemplates;
        
        const plansRes = await backendRequest('getVIPPlans');
        if (!plansRes || !plansRes.success) {
            return log('Không thể tải thông tin gói VIP', true);
        }

        const modal = document.createElement('div');
        modal.className = 'payment-modal';
        modal.id = 'vip-modal';

        const plans = plansRes.plans;
        const sepayConfig = plansRes.sepayConfig;
        const vipStatus = getVIPStatus();
        const isRenewal = vipStatus.hasVIP;

        modal.innerHTML = Templates.vipModal(plans, sepayConfig, isRenewal);
        document.body.appendChild(modal);
        modal.style.display = 'block';

        // Handle plan selection
        modal.querySelectorAll('.buy-plan-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const plan = e.target.dataset.plan;
                await this.createOrder(plan, plans[plan], sepayConfig);
            });
        });

        // Handle cancel payment
        this._setupCancelPaymentHandler(modal);
    },
    
    /**
     * Setup cancel payment button handler
     */
    _setupCancelPaymentHandler(modal) {
        const { backendRequest, log } = this._callbacks;
        const Modal = window.AppModal;
        
        modal.querySelector('#cancel-payment-btn')?.addEventListener('click', async () => {
            if (!this._currentOrder) return;
            
            Modal.showConfirm(
                'Bạn có chắc chắn muốn hủy đơn hàng thanh toán này không? Thao tác này không thể hoàn tác.',
                async () => {
                    const cancelRes = await backendRequest('cancelOrder', { orderId: this._currentOrder.id });
                    
                    if (cancelRes && cancelRes.success) {
                        log('✅ Đã hủy đơn hàng thành công');
                        this._clearPaymentCheck();
                        this._currentOrder = null;
                        modal.remove();
                    } else {
                        log('❌ Không thể hủy đơn hàng: ' + (cancelRes?.message || 'Lỗi'), true);
                    }
                },
                () => {
                    log('Tiếp tục chờ thanh toán');
                }
            );
        });
    },
    
    /**
     * Create VIP order
     */
    async createOrder(planKey, planData, sepayConfig) {
        const { backendRequest, log, getUserId } = this._callbacks;
        const userId = getUserId();
        
        const orderRes = await backendRequest('createVIPOrder', { userId, plan: planKey });

        if (!orderRes || !orderRes.success) {
            return log('Không thể tạo đơn hàng', true);
        }

        this._currentOrder = orderRes.order;
        log(`✅ Tạo đơn hàng #${this._currentOrder.orderCode} thành công`);

        // Show payment section
        document.getElementById('payment-section').classList.remove('hidden');
        document.querySelectorAll('.plan-card').forEach(card => card.classList.add('opacity-50'));
        document.querySelectorAll('.buy-plan-btn').forEach(btn => btn.disabled = true);

        // Update payment info
        const qrUrl = `https://qr.sepay.vn/img?bank=${sepayConfig.bankName}&acc=${sepayConfig.accountNumber}&template=compact&amount=${this._currentOrder.amount}&des=${this._currentOrder.orderCode}`;
        document.getElementById('qr-code').src = qrUrl;
        document.getElementById('amount-display').textContent = `${this._currentOrder.amount.toLocaleString('vi-VN')}đ`;
        document.getElementById('content-display').textContent = this._currentOrder.orderCode;

        // Start checking payment status
        this.startPaymentCheck();
    },
    
    /**
     * Start payment status checking interval
     */
    startPaymentCheck() {
        const { backendRequest, log, getConfig, onVIPStatusChange } = this._callbacks;
        const Templates = window.AppTemplates;
        
        this._clearPaymentCheck();
        
        const orderCreatedTime = new Date(this._currentOrder.createdAt).getTime();
        const CONFIG = getConfig();
        
        this._paymentCheckInterval = setInterval(async () => {
            if (!this._currentOrder) {
                this._clearPaymentCheck();
                return;
            }
            
            // Check if order has timed out
            const now = new Date().getTime();
            if (now - orderCreatedTime > CONFIG.PAYMENT_TIMEOUT) {
                this._clearPaymentCheck();
                document.getElementById('payment-status').innerHTML = Templates.paymentStatus.expired;
                log('Đơn hàng đã bị hủy do quá thời gian thanh toán', true);
                
                setTimeout(() => {
                    document.getElementById('vip-modal')?.remove();
                    this._currentOrder = null;
                }, 3000);
                return;
            }
            
            // Check payment status
            const statusRes = await backendRequest('checkOrderStatus', { orderId: this._currentOrder.id });
            
            if (statusRes && statusRes.success) {
                if (statusRes.order.status === 'Paid') {
                    this._clearPaymentCheck();
                    document.getElementById('payment-status').innerHTML = Templates.paymentStatus.success;
                    log('Thanh toán VIP thành công!');
                    
                    setTimeout(async () => {
                        document.getElementById('vip-modal')?.remove();
                        await onVIPStatusChange();
                    }, 2000);
                } else if (statusRes.order.status === 'Cancelled') {
                    this._clearPaymentCheck();
                    document.getElementById('payment-status').innerHTML = Templates.paymentStatus.cancelled;
                    log('Đơn hàng đã bị hủy', true);
                    
                    setTimeout(() => {
                        document.getElementById('vip-modal')?.remove();
                        this._currentOrder = null;
                    }, 2000);
                }
            }
        }, CONFIG.PAYMENT_CHECK_INTERVAL);
    },
    
    /**
     * Clear payment check interval
     */
    _clearPaymentCheck() {
        if (this._paymentCheckInterval) {
            clearInterval(this._paymentCheckInterval);
            this._paymentCheckInterval = null;
        }
    },
    
    /**
     * Check and update VIP status
     */
    async checkAndUpdateStatus() {
        const { backendRequest, log, getUserId, getVIPStatus, onVIPStatusChange, onVIPExpired } = this._callbacks;
        const userId = getUserId();
        
        const vipRes = await backendRequest('checkVIPStatus', { userId });
        if (vipRes && vipRes.success) {
            const previousVIPStatus = getVIPStatus().hasVIP;
            
            // Call callback to update VIP status in main app
            if (onVIPStatusChange) {
                await onVIPStatusChange(vipRes.vip);
            }
            
            // If VIP status changed from active to expired
            if (previousVIPStatus && !vipRes.vip.hasVIP) {
                log('⚠️ VIP của bạn đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.', true);
                
                if (onVIPExpired) {
                    onVIPExpired();
                }
                
                // Show VIP modal after delay
                setTimeout(() => {
                    this.showModal();
                }, 1000);
            }
        }
    },
    
    /**
     * Start auto-check VIP expiry interval
     */
    startExpiryCheck() {
        const { getConfig, getUserId } = this._callbacks;
        
        this.stopExpiryCheck();
        
        const CONFIG = getConfig();
        this._vipExpiryCheckInterval = setInterval(async () => {
            const userId = getUserId();
            if (!userId) {
                this.stopExpiryCheck();
                return;
            }
            
            await this.checkAndUpdateStatus();
        }, CONFIG.VIP_CHECK_INTERVAL);
    },
    
    /**
     * Stop VIP expiry check interval
     */
    stopExpiryCheck() {
        if (this._vipExpiryCheckInterval) {
            clearInterval(this._vipExpiryCheckInterval);
            this._vipExpiryCheckInterval = null;
        }
    },
    
    /**
     * Cleanup all intervals
     */
    cleanup() {
        this._clearPaymentCheck();
        this.stopExpiryCheck();
        this._currentOrder = null;
    }
};
