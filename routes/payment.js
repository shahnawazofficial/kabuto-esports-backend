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
        
        console.log('Order created:', order.id, 'Amount:', order.amount);
        
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
        
        console.log('Verifying payment:', {
            order_id: razorpay_order_id,
            payment_id: razorpay_payment_id,
            amount: amount
        });
        
        // For TEST MODE - Fetch payment details from Razorpay to verify
        let paymentDetails;
        try {
            paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
            
            console.log('Payment status:', paymentDetails.status);
            console.log('Payment order_id:', paymentDetails.order_id);
            
            // Check if payment was successful
            if (paymentDetails.status !== 'captured' && paymentDetails.status !== 'authorized') {
                return res.status(400).json({
                    success: false,
                    message: 'Payment not successful. Status: ' + paymentDetails.status
                });
            }
            
            // Verify order ID matches
            if (paymentDetails.order_id !== razorpay_order_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment verification failed - Order ID mismatch'
                });
            }
            
        } catch (error) {
            console.error('Error fetching payment:', error);
            return res.status(400).json({
                success: false,
                message: 'Could not verify payment with Razorpay: ' + error.message
            });
        }
        
        // Payment verified - Add to wallet
        const userId = req.user.user_id;
        
        console.log('Adding money to wallet for user:', userId);
        
        // Get current balance
        const [wallets] = await db.query(
            'SELECT balance FROM wallet WHERE user_id = ?',
            [userId]
        );
        
        let currentBalance = 0;
        if (wallets.length > 0) {
            currentBalance = parseFloat(wallets[0].balance);
            console.log('Current balance:', currentBalance);
        } else {
            // Create wallet if doesn't exist
            console.log('Creating new wallet for user:', userId);
            await db.query(
                'INSERT INTO wallet (user_id, balance, created_at, updated_at) VALUES (?, 0, NOW(), NOW())',
                [userId]
            );
        }
        
        const amountToAdd = amount / 100; // Convert from paisa to rupees
        const newBalance = currentBalance + amountToAdd;
        
        console.log('Adding amount:', amountToAdd, 'New balance:', newBalance);
        
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
            [userId, amountToAdd, newBalance, razorpay_payment_id]
        );
        
        console.log('✅ Payment verified! User', userId, 'added ₹' + amountToAdd, 'New balance: ₹' + newBalance);
        
        res.json({
            success: true,
            message: 'Payment successful',
            data: {
                new_balance: newBalance,
                amount_added: amountToAdd
            }
        });
        
    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Payment verification failed: ' + error.message
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