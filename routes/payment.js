const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// TODO: Enable googleapis when implementing server-side verification
// const { google } = require('googleapis');
// Note: Install googleapis with: npm install googleapis

/**
 * Verify Google Play purchase and complete tournament registration
 * POST /api/payment/verify
 */
router.post('/verify', verifyToken, async (req, res) => {
    try {
        const { user_id, tournament_id, purchase_token, product_id } = req.body;

        // Validate request
        if (!user_id || !tournament_id || !purchase_token || !product_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        console.log(`🔍 Verifying purchase for user ${user_id}, tournament ${tournament_id}`);
        console.log(`📦 Product ID: ${product_id}`);
        console.log(`🎟️ Purchase token: ${purchase_token.substring(0, 20)}...`);

        // Check if user is already registered
        const [existing] = await db.query(
            `SELECT registration_id FROM registrations 
             WHERE user_id = ? AND tournament_id = ?`,
            [user_id, tournament_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'You are already registered for this tournament'
            });
        }

        // TODO: Verify purchase with Google Play API
        // For now, we'll trust the client (TEMPORARY - MUST implement server-side verification for production)
        console.log('⚠️  WARNING: Server-side Google Play verification not yet implemented');
        console.log('⚠️  In production, MUST verify purchase with Google Play API');

        // Uncomment when Google Play service account is configured:
        /*
        const isValid = await verifyGooglePlayPurchase(purchase_token, product_id);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid purchase - verification failed'
            });
        }
        */

        // Store purchase token to prevent replay attacks
        await db.query(
            `INSERT INTO purchase_tokens 
             (user_id, tournament_id, purchase_token, product_id, verified_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [user_id, tournament_id, purchase_token, product_id]
        );

        console.log('✅ Purchase token stored successfully');

        res.json({
            success: true,
            message: 'Purchase verified successfully',
            data: {
                verified: true
            }
        });

    } catch (error) {
        console.error('❌ Purchase verification error:', error);

        // Check for duplicate purchase token (replay attack)
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                message: 'This purchase has already been used'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Purchase verification failed',
            error: error.message
        });
    }
});

/**
 * Verify purchase with Google Play API
 * This function should be called before accepting a purchase
 * 
 * Setup required:
 * 1. Create service account in Google Cloud Console
 * 2. Download JSON key file
 * 3. Grant access to Google Play Developer API
 * 4. Place key file in project root as 'google-play-service-account.json'
 * 
 * TODO: Uncomment when ready to implement server-side verification
 */
/*
async function verifyGooglePlayPurchase(purchaseToken, productId) {
    try {
        // Initialize Google Auth
        const auth = new google.auth.GoogleAuth({
            keyFile: './google-play-service-account.json',
            scopes: ['https://www.googleapis.com/auth/androidpublisher']
        });

        const androidPublisher = google.androidpublisher({
            version: 'v3',
            auth
        });

        // Verify the purchase
        const response = await androidPublisher.purchases.products.get({
            packageName: 'com.kabuto.esports',
            productId: productId,
            token: purchaseToken
        });

        console.log('📋 Google Play API response:', response.data);

        // Check purchase state
        // 0 = purchased, 1 = cancelled, 2 = pending
        if (response.data.purchaseState === 0) {
            console.log('✅ Purchase verified by Google Play');
            return true;
        } else {
            console.log(`❌ Invalid purchase state: ${response.data.purchaseState}`);
            return false;
        }

    } catch (error) {
        console.error('❌ Google Play verification error:', error.message);
        return false;
    }
}
*/

module.exports = router;
