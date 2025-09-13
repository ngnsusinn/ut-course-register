const fetch = require('node-fetch');
const admin = require('firebase-admin');

// --- Firebase Admin SDK Initialization ---
// This code initializes the Firebase Admin SDK.
// It checks if the SDK has already been initialized to prevent errors.
// It reads your Firebase service account credentials from a Vercel environment variable.
// IMPORTANT: You must set the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable in your Vercel project settings.
try {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.error('Firebase Admin Initialization Error:', e);
}
const db = admin.firestore();

// Utility: Call the university's internal API
async function callApi(endpoint, method, token, body = null, source = 'dkhp') {
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

    const options = { method, headers, body: body ? JSON.stringify(body) : null, timeout: 30000 };

    try {
        const response = await fetch(targetUrl, options);
        if (!response.ok) {
            const errorText = await response.text();
             if(response.status === 401 && errorText.includes("Token đã hết hạn")) {
                return { success: false, message: 'Token đã hết hạn', status: 401 };
            }
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Main handler for all API requests from the frontend
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { action, payload } = req.body;
    let token = req.headers.authorization?.split(' ')[1];
    let result;

    try {
        switch (action) {
            // --- AUTHENTICATION ---
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });
                if(result.token) {
                    // Create user profile in Firestore if it doesn't exist
                    const userRef = db.collection('users').doc(username);
                    const userDoc = await userRef.get();
                    if(!userDoc.exists) {
                        await userRef.set({
                            username: username,
                            tier: 'free',
                            vipExpiry: null,
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
                break;
            }

            // --- READ ACTIONS (from university API) ---
            case 'get-schedule':
            case 'get-registered': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const endpoint = action === 'get-schedule' ? '/getTkbChoDangKy' : '/getTkbDaDangKy';
                result = await callApi(endpoint, 'GET', token, null, payload.source);
                break;
            }

            // --- WRITE ACTIONS (to university API) ---
            case 'register':
            case 'insert': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                // VIP Check
                const userRef = db.collection('users').doc(payload.username); // Assuming username is passed in payload
                const userDoc = await userRef.get();
                if (!userDoc.exists || userDoc.data().tier !== 'vip' || (userDoc.data().vipExpiry && userDoc.data().vipExpiry.toMillis() < Date.now())) {
                    return res.status(403).json({ success: false, message: 'Chức năng này yêu cầu tài khoản VIP. Vui lòng nâng cấp.' });
                }

                const { classId, source } = payload;
                const endpoint = `/dangKyLopHocPhan?idLopHocPhan=${classId}`;
                result = await callApi(endpoint, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            // --- USER & PAYMENT ACTIONS (with Firestore) ---
            case 'get-user-status': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { username } = payload;
                const userRef = db.collection('users').doc(username);
                const doc = await userRef.get();

                if (!doc.exists) {
                    return res.status(404).json({ success: false, message: 'User not found' });
                }

                const userData = doc.data();
                // Check if VIP has expired
                if (userData.tier === 'vip' && userData.vipExpiry && userData.vipExpiry.toMillis() < Date.now()) {
                    await userRef.update({ tier: 'free', vipExpiry: null });
                    result = { success: true, tier: 'free', vipExpiry: null };
                } else {
                    result = { success: true, tier: userData.tier, vipExpiry: userData.vipExpiry };
                }
                break;
            }

            case 'create-payment': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { username, days, amount } = payload;
                const transRef = db.collection('transactions').doc();
                await transRef.set({
                    username,
                    days,
                    amount,
                    status: 'pending',
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                result = {
                    success: true,
                    transactionId: transRef.id,
                    paymentContent: `UTHVIP ${transRef.id}`, // Content for QR code
                    amount: amount
                };
                break;
            }
            
            case 'check-payment-status': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { transactionId } = payload;
                 const transRef = db.collection('transactions').doc(transactionId);
                 const doc = await transRef.get();
                 if (!doc.exists) {
                     return res.status(404).json({ success: false, message: 'Transaction not found' });
                 }
                 result = { success: true, status: doc.data().status };
                 break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }
        
        // Final response
        if (result && typeof result.success === 'boolean' && !result.success) {
            // If the API call returned a structured error, use its status code
            return res.status(result.status || 500).json(result);
        }
        return res.status(200).json(result);

    } catch (error) {
        console.error(`Error in action '${action}':`, error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
