// ============================================
// PAYMENT ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const razorpay = require('../config/razorpay');
const db = require('../config/database');
const auth = require('../middleware/auth');
const crypto = require('crypto');

// CREATE RAZORPAY ORDER
router.post('/create-order', auth, async (req, res) => {
    try {
        const { amount, currency = 'INR' } = req.body;
        
        // Create Razorpay order
        const options = {
            amount: amount * 100, // Razorpay uses paisa
            currency: currency,
            receipt: `receipt_${Date.now()}`,
            payment_capture: 1
        };
        
        const order = await razorpay.orders.create(options);
        
        res.json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                key_id: process.env.RAZORPAY_KEY_ID
            }
        });
        
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment order'
        });
    }
});

// VERIFY PAYMENT
router.post('/verify-payment', auth, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            amount
        } = req.body;
        
        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');
        
        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Payment verification failed'
            });
        }
        
        // Payment verified - Add to wallet
        const userId = req.user.user_id;
        
        // Get current balance
        const [wallets] = await db.query(
            'SELECT balance FROM wallet WHERE user_id = ?',
            [userId]
        );
        
        let currentBalance = 0;
        if (wallets.length > 0) {
            currentBalance = parseFloat(wallets[0].balance);
        } else {
            // Create wallet if doesn't exist
            await db.query(
                'INSERT INTO wallet (user_id, balance) VALUES (?, 0)',
                [userId]
            );
        }
        
        const newBalance = currentBalance + (amount / 100);
        
        // Update wallet balance
        await db.query(
            'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
            [newBalance, userId]
        );
        
        // Record transaction
        await db.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, amount, balance_after, description, 
            payment_method, payment_gateway_ref, status, created_at)
            VALUES (?, 'credit', ?, ?, 'Money added via Razorpay', 'Razorpay', ?, 'success', NOW())`,
            [userId, amount / 100, newBalance, razorpay_payment_id]
        );
        
        res.json({
            success: true,
            message: 'Payment successful',
            data: {
                new_balance: newBalance,
                amount_added: amount / 100
            }
        });
        
    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Payment verification failed'
        });
    }
});

// GET PAYMENT DETAILS
router.get('/payment/:payment_id', auth, async (req, res) => {
    try {
        const payment = await razorpay.payments.fetch(req.params.payment_id);
        
        res.json({
            success: true,
            data: payment
        });
        
    } catch (error) {
        console.error('Fetch payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment details'
        });
    }
});

module.exports = router;