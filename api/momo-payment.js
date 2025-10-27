import crypto from 'crypto';
import https from 'https';

/**
 * MoMo Payment Integration for VIP Subscriptions
 * Based on MoMo API v2
 */

class MoMoPayment {
    constructor(config) {
        this.partnerCode = config.partnerCode;
        this.accessKey = config.accessKey;
        this.secretKey = config.secretKey;
        this.redirectUrl = config.redirectUrl;
        this.ipnUrl = config.ipnUrl;
        this.hostname = config.isProduction ? 'payment.momo.vn' : 'test-payment.momo.vn';
    }

    /**
     * Generate HMAC SHA256 signature
     */
    generateSignature(rawSignature) {
        return crypto.createHmac('sha256', this.secretKey)
            .update(rawSignature)
            .digest('hex');
    }

    /**
     * Create payment request
     */
    async createPayment(orderData) {
        const {
            orderId,
            amount,
            orderInfo,
            extraData = '',
            requestType = 'captureWallet',
            lang = 'vi'
        } = orderData;

        const requestId = orderId;

        // Create raw signature string
        const rawSignature = `accessKey=${this.accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${this.ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${this.partnerCode}&redirectUrl=${this.redirectUrl}&requestId=${requestId}&requestType=${requestType}`;

        // Generate signature
        const signature = this.generateSignature(rawSignature);

        // Request body
        const requestBody = JSON.stringify({
            partnerCode: this.partnerCode,
            accessKey: this.accessKey,
            requestId: requestId,
            amount: amount.toString(),
            orderId: orderId,
            orderInfo: orderInfo,
            redirectUrl: this.redirectUrl,
            ipnUrl: this.ipnUrl,
            extraData: extraData,
            requestType: requestType,
            signature: signature,
            lang: lang
        });

        // HTTPS options
        const options = {
            hostname: this.hostname,
            port: 443,
            path: '/v2/gateway/api/create',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        // Send request
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.resultCode === 0) {
                            resolve({
                                success: true,
                                payUrl: response.payUrl,
                                deeplink: response.deeplink,
                                qrCodeUrl: response.qrCodeUrl,
                                orderId: response.orderId,
                                requestId: response.requestId
                            });
                        } else {
                            resolve({
                                success: false,
                                message: response.message || 'Payment creation failed',
                                resultCode: response.resultCode
                            });
                        }
                    } catch (error) {
                        reject(new Error('Failed to parse MoMo response: ' + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error('MoMo request failed: ' + error.message));
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Verify IPN (Instant Payment Notification) callback
     */
    verifyIPN(ipnData) {
        const {
            partnerCode,
            orderId,
            requestId,
            amount,
            orderInfo,
            orderType,
            transId,
            resultCode,
            message,
            payType,
            responseTime,
            extraData,
            signature
        } = ipnData;

        // Create raw signature string for verification
        const rawSignature = `accessKey=${this.accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderId}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;

        // Generate signature
        const expectedSignature = this.generateSignature(rawSignature);

        // Verify signature
        if (signature === expectedSignature) {
            return {
                valid: true,
                resultCode: parseInt(resultCode),
                transId: transId,
                orderId: orderId,
                amount: parseFloat(amount)
            };
        } else {
            return {
                valid: false,
                message: 'Invalid signature'
            };
        }
    }

    /**
     * Check transaction status
     */
    async checkTransactionStatus(orderId, requestId) {
        const rawSignature = `accessKey=${this.accessKey}&orderId=${orderId}&partnerCode=${this.partnerCode}&requestId=${requestId}`;
        const signature = this.generateSignature(rawSignature);

        const requestBody = JSON.stringify({
            partnerCode: this.partnerCode,
            accessKey: this.accessKey,
            requestId: requestId,
            orderId: orderId,
            signature: signature,
            lang: 'vi'
        });

        const options = {
            hostname: this.hostname,
            port: 443,
            path: '/v2/gateway/api/query',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        resolve(response);
                    } catch (error) {
                        reject(new Error('Failed to parse status response: ' + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error('Status check failed: ' + error.message));
            });

            req.write(requestBody);
            req.end();
        });
    }
}

export default MoMoPayment;
