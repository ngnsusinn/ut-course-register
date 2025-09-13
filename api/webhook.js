const admin = require('firebase-admin');
const crypto = require('crypto');

// --- Firebase Admin SDK Initialization ---
// Ensures Firebase is initialized for this serverless function.
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

// Main handler for the SePay webhook
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { request_id, trans_id, partner_id, trans_amount, when, noidung, signature } = req.body;

        // --- 1. Security Check: Verify Signature ---
        // This is crucial to ensure the request is genuinely from SePay.
        // IMPORTANT: You must set `SEPAY_SECRET_KEY` in your Vercel environment variables.
        const secretKey = process.env.SEPAY_SECRET_KEY;
        if (!secretKey) {
            console.error("SEPAY_SECRET_KEY is not set.");
            return res.status(500).json({ error: "Server configuration error." });
        }

        const dataString = `${request_id}${trans_id}${partner_id}${trans_amount}${when}${secretKey}`;
        const calculatedSignature = crypto.createHash('md5').update(dataString).digest('hex');

        if (calculatedSignature !== signature) {
            console.warn("Invalid signature received.");
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // --- 2. Process the Payment ---
        // Extract transaction ID from the content
        const contentParts = noidung.split(' ');
        const transactionId = contentParts.length > 1 ? contentParts[1] : null;

        if (!transactionId) {
            console.error("Could not parse transactionId from content:", noidung);
            return res.status(400).json({ error: 'Invalid payment content format' });
        }

        const transactionRef = db.collection('transactions').doc(transactionId);
        
        // Using a Firestore transaction to ensure atomicity
        await db.runTransaction(async (t) => {
            const transDoc = await t.get(transactionRef);

            if (!transDoc.exists) {
                throw new Error(`Transaction ${transactionId} not found.`);
            }

            const transData = transDoc.data();

            // Idempotency check: if already completed, do nothing
            if (transData.status === 'completed') {
                console.log(`Transaction ${transactionId} already completed.`);
                return;
            }

            const username = transData.username;
            const days = transData.days;
            const userRef = db.collection('users').doc(username);
            const userDoc = await t.get(userRef);

            if (!userDoc.exists) {
                 throw new Error(`User ${username} not found for transaction ${transactionId}.`);
            }
            
            const userData = userDoc.data();

            // --- 3. Update User's VIP Status ---
            let newExpiryDate;
            const now = new Date();
            // If user is already VIP and expiry is in the future, extend it
            if (userData.tier === 'vip' && userData.vipExpiry && userData.vipExpiry.toDate() > now) {
                newExpiryDate = new Date(userData.vipExpiry.toDate().getTime());
            } else {
                newExpiryDate = now;
            }
            newExpiryDate.setDate(newExpiryDate.getDate() + days);

            // Update user and transaction documents
            t.update(userRef, {
                tier: 'vip',
                vipExpiry: admin.firestore.Timestamp.fromDate(newExpiryDate)
            });

            t.update(transactionRef, {
                status: 'completed',
                sepayTransId: trans_id, // Store SePay's transaction ID for reference
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });

             console.log(`Successfully processed payment for transaction ${transactionId}, user ${username}.`);
        });

        // --- 4. Respond to SePay ---
        // SePay expects a JSON response indicating success.
        res.status(200).json({ message: 'Success' });

    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
};
