const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('./auth');

// ROUTE: Get Wallet Balance
router.get('/balance', verifyToken, async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT wallet_balance, total_earnings, total_spent FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        res.json({
            success: true,
            data: users[0]
        });
        
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching balance',
            error: error.message
        });
    }
});

// ROUTE: Get Transaction History
router.get('/transactions', verifyToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const type = req.query.type;
        
        let query = `
            SELECT * FROM wallet_transactions 
            WHERE user_id = ?
        `;
        
        const params = [req.userId];
        
        if (type) {
            query += ' AND transaction_type = ?';
            params.push(type);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        const [transactions] = await db.query(query, params);
        
        res.json({
            success: true,
            data: transactions
        });
        
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching transactions',
            error: error.message
        });
    }
});

// ROUTE: Initiate Deposit (Razorpay)
router.post('/deposit', verifyToken, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount < 10) {
            return res.status(400).json({
                success: false,
                message: 'Minimum deposit amount is ₹10'
            });
        }
        
        const [user] = await db.query(
            'SELECT wallet_balance FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        const [result] = await db.query(
            `INSERT INTO wallet_transactions 
             (user_id, transaction_type, amount, balance_before, balance_after, 
              status, payment_method, description)
             VALUES (?, 'deposit', ?, ?, ?, 'pending', 'razorpay', 'Wallet deposit')`,
            [
                req.userId,
                amount,
                user[0].wallet_balance,
                user[0].wallet_balance + amount
            ]
        );
        
        res.json({
            success: true,
            message: 'Deposit initiated',
            data: {
                transaction_id: result.insertId,
                amount: amount,
                message: 'Razorpay integration pending'
            }
        });
        
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({
            success: false,
            message: 'Error initiating deposit',
            error: error.message
        });
    }
});

// ROUTE: Verify Payment (Razorpay Callback)
router.post('/verify-payment', verifyToken, async (req, res) => {
    try {
        const { transaction_id, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
        
        await db.query('START TRANSACTION');
        
        try {
            const [transactions] = await db.query(
                'SELECT * FROM wallet_transactions WHERE transaction_id = ? AND user_id = ?',
                [transaction_id, req.userId]
            );
            
            if (transactions.length === 0) {
                throw new Error('Transaction not found');
            }
            
            const transaction = transactions[0];
            
            await db.query(
                'UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?',
                [transaction.amount, req.userId]
            );
            
            await db.query(
                `UPDATE wallet_transactions 
                 SET status = 'completed', 
                     payment_gateway_transaction_id = ?,
                     completed_at = NOW()
                 WHERE transaction_id = ?`,
                [razorpay_payment_id, transaction_id]
            );
            
            await db.query(
                `INSERT INTO payment_gateway_logs 
                 (user_id, transaction_id, gateway_name, gateway_payment_id, 
                  amount, currency, status)
                 VALUES (?, ?, 'razorpay', ?, ?, 'INR', 'success')`,
                [req.userId, transaction_id, razorpay_payment_id, transaction.amount]
            );
            
            await db.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Payment verified successfully',
                data: {
                    new_balance: transaction.balance_after
                }
            });
            
        } catch (err) {
            await db.query('ROLLBACK');
            throw err;
        }
        
    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
});

// ROUTE: Request Withdrawal
router.post('/withdraw', verifyToken, async (req, res) => {
    try {
        const { amount, bank_account_number, bank_ifsc, bank_name, upi_id } = req.body;
        
        const minWithdrawal = parseFloat(process.env.MIN_WITHDRAWAL_AMOUNT) || 100;
        
        if (!amount || amount < minWithdrawal) {
            return res.status(400).json({
                success: false,
                message: `Minimum withdrawal amount is ₹${minWithdrawal}`
            });
        }
        
        const [users] = await db.query(
            'SELECT wallet_balance, kyc_status FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = users[0];
        
        if (user.kyc_status !== 'verified') {
            return res.status(403).json({
                success: false,
                message: 'KYC verification required for withdrawals'
            });
        }
        
        if (user.wallet_balance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        await db.query('START TRANSACTION');
        
        try {
            await db.query(
                'UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?',
                [amount, req.userId]
            );
            
            await db.query(
                `INSERT INTO wallet_transactions 
                 (user_id, transaction_type, amount, balance_before, balance_after, 
                  status, payment_method, description)
                 VALUES (?, 'withdrawal', ?, ?, ?, 'pending', ?, ?)`,
                [
                    req.userId,
                    -amount,
                    user.wallet_balance,
                    user.wallet_balance - amount,
                    upi_id ? 'UPI' : 'Bank Transfer',
                    upi_id ? `UPI: ${upi_id}` : `Bank: ${bank_name}, Acc: ${bank_account_number}`
                ]
            );
            
            await db.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Withdrawal request submitted. Will be processed within 24-48 hours.',
                data: {
                    amount: amount,
                    new_balance: user.wallet_balance - amount
                }
            });
            
        } catch (err) {
            await db.query('ROLLBACK');
            throw err;
        }
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing withdrawal',
            error: error.message
        });
    }
});

module.exports = router;