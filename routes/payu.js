// ============================================
// PAYU PAYMENT ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const { PAYU_CONFIG, generatePayUHash, verifyPayUHash } = require('../config/payu');
const db = require('../config/database');
const auth = require('../middleware/auth');

// CREATE PAYU PAYMENT
router.post('/initiate', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.user_id;
        
        // Get user details
        const [users] = await db.query(
            'SELECT username, email FROM users WHERE user_id = ?',
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
            firstname: user.username,
            email: user.email || 'user@kabutoesports.com',
            phone: '9999999999',
            surl: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payu/success`,
            furl: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payu/failure`,
            salt: PAYU_CONFIG.salt
        };
        
        // Generate hash
        const hash = generatePayUHash(payuParams);
        
        console.log('PayU payment initiated:', txnid, 'Amount:', amount);
        
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
        console.error('PayU initiate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate PayU payment'
        });
    }
});

// PAYU SUCCESS CALLBACK
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
        
        console.log('PayU Success Callback:', txnid, status);
        
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
            console.error('Hash mismatch! Possible tampering.');
            return res.status(400).send('Invalid hash');
        }
        
        if (status === 'success') {
            // Extract user ID from txnid
            const userIdMatch = txnid.match(/TXN\d+(\d+)$/);
            const userId = userIdMatch ? parseInt(userIdMatch[1]) : null;
            
            if (!userId) {
                return res.status(400).send('Invalid transaction ID');
            }
            
            // Get current balance
            const [wallets] = await db.query(
                'SELECT balance FROM wallet WHERE user_id = ?',
                [userId]
            );
            
            let currentBalance = 0;
            if (wallets.length > 0) {
                currentBalance = parseFloat(wallets[0].balance);
            } else {
                await db.query(
                    'INSERT INTO wallet (user_id, balance, created_at, updated_at) VALUES (?, 0, NOW(), NOW())',
                    [userId]
                );
            }
            
            const amountToAdd = parseFloat(amount);
            const newBalance = currentBalance + amountToAdd;
            
            // Update wallet
            await db.query(
                'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
                [newBalance, userId]
            );
            
            // Record transaction
            await db.query(
                `INSERT INTO wallet_transactions 
                (user_id, transaction_type, amount, balance_after, description, 
                payment_method, payment_gateway_ref, status, created_at)
                VALUES (?, 'credit', ?, ?, 'Money added via PayU', 'PayU', ?, 'success', NOW())`,
                [userId, amountToAdd, newBalance, mihpayid]
            );
            
            console.log('✅ PayU payment successful! User', userId, 'added ₹', amountToAdd);
        }
        
        // Redirect to success page
        res.send(`
            <html>
                <body>
                    <h1>Payment ${status === 'success' ? 'Successful' : 'Failed'}!</h1>
                    <p>Transaction ID: ${txnid}</p>
                    <p>Amount: ₹${amount}</p>
                    <script>
                        setTimeout(() => {
                            window.close();
                        }, 3000);
                    </script>
                </body>
            </html>
        `);
        
    } catch (error) {
        console.error('PayU success callback error:', error);
        res.status(500).send('Error processing payment');
    }
});

// PAYU FAILURE CALLBACK
router.post('/failure', async (req, res) => {
    const { txnid, status } = req.body;
    
    console.log('PayU Payment Failed:', txnid, status);
    
    res.send(`
        <html>
            <body>
                <h1>Payment Failed!</h1>
                <p>Transaction ID: ${txnid}</p>
                <script>
                    setTimeout(() => {
                        window.close();
                    }, 3000);
                </script>
            </body>
        </html>
    `);
});

module.exports = router;