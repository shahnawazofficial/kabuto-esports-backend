// ============================================
// PAYU PAYMENT ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const { PAYU_CONFIG, generatePayUHash, verifyPayUHash } = require('../config/payu');
const db = require('../config/database');
const auth = require('../middleware/auth');

// ============================================
// INITIATE PAYU PAYMENT
// ============================================
router.post('/initiate', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.user_id;
        
        console.log('📱 PayU initiate request - User:', userId, 'Amount:', amount);
        
        // Validate amount
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }
        
        // Get user details
        const [users] = await db.query(
            'SELECT username, email, phone FROM users WHERE user_id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = users[0];
        
        // Generate unique transaction ID
        const txnid = `TXN${Date.now()}${userId}`;
        
        // Prepare PayU parameters
        const payuParams = {
            key: PAYU_CONFIG.merchantKey,
            txnid: txnid,
            amount: amount.toString(),
            productinfo: 'Wallet Recharge',
            firstname: user.username || 'User',
            email: user.email || `user${userId}@kabutoesports.com`,
            phone: user.phone || '9999999999',
            surl: `${process.env.BACKEND_URL || 'https://kabuto-esports-api.onrender.com'}/api/payu/success`,
            furl: `${process.env.BACKEND_URL || 'https://kabuto-esports-api.onrender.com'}/api/payu/failure`,
            salt: PAYU_CONFIG.salt
        };
        
        // Generate hash
        const hash = generatePayUHash(payuParams);
        
        console.log('✅ PayU payment initiated:', txnid, 'Amount:', amount);
        console.log('🔑 Hash generated successfully');
        
        res.json({
            success: true,
            data: {
                key: payuParams.key,
                txnid: payuParams.txnid,
                amount: payuParams.amount,
                productinfo: payuParams.productinfo,
                firstname: payuParams.firstname,
                email: payuParams.email,
                phone: payuParams.phone,
                surl: payuParams.surl,
                furl: payuParams.furl,
                hash: hash,
                payu_url: PAYU_CONFIG.baseUrl + '/_payment'
            }
        });
        
    } catch (error) {
        console.error('❌ PayU initiate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate PayU payment',
            error: error.message
        });
    }
});

// ============================================
// PAYU SUCCESS CALLBACK
// ============================================
router.post('/success', async (req, res) => {
    try {
        const {
            key,
            txnid,
            amount,
            productinfo,
            firstname,
            email,
            status,
            hash,
            mihpayid
        } = req.body;
        
        console.log('💳 PayU Success Callback:', {
            txnid,
            status,
            amount,
            mihpayid
        });
        
        // Verify hash
        const calculatedHash = verifyPayUHash({
            key,
            txnid,
            amount,
            productinfo,
            firstname,
            email,
            status,
            salt: PAYU_CONFIG.salt
        });
        
        if (calculatedHash !== hash) {
            console.error('⚠️ Hash mismatch! Possible tampering.');
            console.error('Received hash:', hash);
            console.error('Calculated hash:', calculatedHash);
            return res.status(400).send('Invalid hash');
        }
        
        console.log('✅ Hash verified successfully');
        
        if (status === 'success') {
            // Extract user ID from txnid (format: TXN1234567890123)
            const userIdMatch = txnid.match(/TXN\d+(\d+)$/);
            const userId = userIdMatch ? parseInt(userIdMatch[1]) : null;
            
            if (!userId) {
                console.error('❌ Invalid transaction ID format:', txnid);
                return res.status(400).send('Invalid transaction ID');
            }
            
            console.log('👤 Processing payment for user:', userId);
            
            // Get current balance
            const [wallets] = await db.query(
                'SELECT balance FROM wallet WHERE user_id = ?',
                [userId]
            );
            
            let currentBalance = 0;
            
            if (wallets.length > 0) {
                currentBalance = parseFloat(wallets[0].balance);
                console.log('💰 Current balance:', currentBalance);
            } else {
                // Create wallet if doesn't exist
                await db.query(
                    'INSERT INTO wallet (user_id, balance, created_at, updated_at) VALUES (?, 0, NOW(), NOW())',
                    [userId]
                );
                console.log('✅ New wallet created for user:', userId);
            }
            
            const amountToAdd = parseFloat(amount);
            const newBalance = currentBalance + amountToAdd;
            
            // Update wallet balance
            await db.query(
                'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
                [newBalance, userId]
            );
            
            console.log('💰 Wallet updated - New balance:', newBalance);
            
            // Record transaction in history
            await db.query(
                `INSERT INTO wallet_transactions 
                (user_id, transaction_type, amount, balance_after, description, 
                payment_method, payment_gateway_ref, status, created_at)
                VALUES (?, 'credit', ?, ?, 'Money added via PayU', 'PayU', ?, 'success', NOW())`,
                [userId, amountToAdd, newBalance, mihpayid]
            );
            
            console.log('✅ Transaction recorded in database');
            console.log('🎉 PayU payment successful! User', userId, 'added ₹', amountToAdd);
        } else {
            console.log('❌ Payment status is not success:', status);
        }
        
        // Return HTML response
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Payment ${status === 'success' ? 'Successful' : 'Failed'}</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: ${status === 'success' ? '#4CAF50' : '#f44336'};
                        color: white;
                    }
                    .container {
                        text-align: center;
                        padding: 20px;
                    }
                    h1 { font-size: 2em; margin-bottom: 20px; }
                    p { font-size: 1.2em; margin: 10px 0; }
                    .emoji { font-size: 3em; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="emoji">${status === 'success' ? '✅' : '❌'}</div>
                    <h1>Payment ${status === 'success' ? 'Successful' : 'Failed'}!</h1>
                    <p>Transaction ID: ${txnid}</p>
                    <p>Amount: ₹${amount}</p>
                    <p>Closing in 3 seconds...</p>
                </div>
                <script>
                    setTimeout(() => {
                        window.close();
                        // Fallback if window.close() doesn't work
                        window.location.href = 'about:blank';
                    }, 3000);
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('❌ PayU success callback error:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
            </head>
            <body>
                <h1>Error processing payment</h1>
                <p>Please contact support</p>
            </body>
            </html>
        `);
    }
});

// ============================================
// PAYU FAILURE CALLBACK
// ============================================
router.post('/failure', async (req, res) => {
    const { txnid, status, error_Message } = req.body;
    
    console.log('❌ PayU Payment Failed:', {
        txnid,
        status,
        error: error_Message
    });
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Failed</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background: #f44336;
                    color: white;
                }
                .container {
                    text-align: center;
                    padding: 20px;
                }
                h1 { font-size: 2em; margin-bottom: 20px; }
                p { font-size: 1.2em; margin: 10px 0; }
                .emoji { font-size: 3em; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="emoji">❌</div>
                <h1>Payment Failed!</h1>
                <p>Transaction ID: ${txnid}</p>
                ${error_Message ? `<p>Reason: ${error_Message}</p>` : ''}
                <p>Closing in 3 seconds...</p>
            </div>
            <script>
                setTimeout(() => {
                    window.close();
                    // Fallback if window.close() doesn't work
                    window.location.href = 'about:blank';
                }, 3000);
            </script>
        </body>
        </html>
    `);
});

module.exports = router;