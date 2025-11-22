const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('./auth');

// ROUTE: Get Host Subscription Plans
router.get('/plans', async (req, res) => {
    try {
        const plans = [
            {
                plan_type: 'starter',
                price: parseFloat(process.env.HOST_STARTER_PRICE) || 199,
                duration_days: 30,
                tournaments_limit: 5,
                max_participants: 50,
                features: [
                    'Host up to 5 tournaments per month',
                    'Maximum 50 participants',
                    'Basic tournament customization',
                    'Email support'
                ]
            },
            {
                plan_type: 'pro',
                price: parseFloat(process.env.HOST_PRO_PRICE) || 499,
                duration_days: 30,
                tournaments_limit: 20,
                max_participants: 100,
                features: [
                    'Host up to 20 tournaments per month',
                    'Maximum 100 participants',
                    'Advanced tournament customization',
                    'Priority support',
                    'Custom tournament banners',
                    'Detailed analytics'
                ]
            },
            {
                plan_type: 'elite',
                price: parseFloat(process.env.HOST_ELITE_PRICE) || 999,
                duration_days: 30,
                tournaments_limit: null,
                max_participants: 200,
                features: [
                    'Unlimited tournaments per month',
                    'Maximum 200 participants',
                    'Full tournament customization',
                    '24/7 priority support',
                    'Custom branding options',
                    'Advanced analytics & insights',
                    'Featured tournament slots',
                    'Co-host support'
                ]
            }
        ];
        
        res.json({
            success: true,
            data: plans
        });
        
    } catch (error) {
        console.error('Get plans error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching plans',
            error: error.message
        });
    }
});

// ROUTE: Purchase Host Subscription
router.post('/subscribe', verifyToken, async (req, res) => {
    try {
        const { plan_type } = req.body;
        
        if (!['starter', 'pro', 'elite'].includes(plan_type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid plan type'
            });
        }
        
        const planPrices = {
            starter: parseFloat(process.env.HOST_STARTER_PRICE) || 199,
            pro: parseFloat(process.env.HOST_PRO_PRICE) || 499,
            elite: parseFloat(process.env.HOST_ELITE_PRICE) || 999
        };
        
        const planLimits = {
            starter: { tournaments: 5, participants: 50 },
            pro: { tournaments: 20, participants: 100 },
            elite: { tournaments: null, participants: 200 }
        };
        
        const price = planPrices[plan_type];
        const limits = planLimits[plan_type];
        
        const [users] = await db.query(
            'SELECT wallet_balance, is_host FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = users[0];
        
        if (user.wallet_balance < price) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        await db.query('START TRANSACTION');
        
        try {
            await db.query(
                'UPDATE users SET wallet_balance = wallet_balance - ?, is_host = TRUE WHERE user_id = ?',
                [price, req.userId]
            );
            
            await db.query(
                `INSERT INTO wallet_transactions 
                 (user_id, transaction_type, amount, balance_before, balance_after, 
                  status, description)
                 VALUES (?, 'host_subscription', ?, ?, ?, 'completed', ?)`,
                [
                    req.userId,
                    -price,
                    user.wallet_balance,
                    user.wallet_balance - price,
                    `Host ${plan_type} subscription`
                ]
            );
            
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            
            await db.query(
                `INSERT INTO host_subscriptions 
                 (user_id, plan_type, plan_price, tournaments_limit, max_participants, 
                  status, end_date)
                 VALUES (?, ?, ?, ?, ?, 'active', ?)`,
                [req.userId, plan_type, price, limits.tournaments, limits.participants, endDate]
            );
            
            await db.query(
                `INSERT INTO notifications 
                 (user_id, notification_type, title, message)
                 VALUES (?, 'host_subscription', 'Host Subscription Active', ?)`,
                [req.userId, `Your ${plan_type} host subscription is now active!`]
            );
            
            await db.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Host subscription activated successfully!',
                data: {
                    plan_type: plan_type,
                    expires_at: endDate,
                    tournaments_limit: limits.tournaments,
                    max_participants: limits.participants
                }
            });
            
        } catch (err) {
            await db.query('ROLLBACK');
            throw err;
        }
        
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing subscription',
            error: error.message
        });
    }
});

// ROUTE: Get My Host Subscription
router.get('/my-subscription', verifyToken, async (req, res) => {
    try {
        const [subscriptions] = await db.query(
            `SELECT * FROM host_subscriptions 
             WHERE user_id = ? AND status = 'active'
             ORDER BY created_at DESC LIMIT 1`,
            [req.userId]
        );
        
        if (subscriptions.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No active subscription found'
            });
        }
        
        res.json({
            success: true,
            data: subscriptions[0]
        });
        
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription',
            error: error.message
        });
    }
});

// ROUTE: Create Tournament (Host Only)
router.post('/tournaments', verifyToken, async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT is_host FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        if (users.length === 0 || !users[0].is_host) {
            return res.status(403).json({
                success: false,
                message: 'You need an active host subscription to create tournaments'
            });
        }
        
        const [subscriptions] = await db.query(
            `SELECT * FROM host_subscriptions 
             WHERE user_id = ? AND status = 'active' AND end_date > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [req.userId]
        );
        
        if (subscriptions.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'No active host subscription found'
            });
        }
        
        const subscription = subscriptions[0];
        
        const {
            tournament_name,
            tournament_description,
            game_mode,
            map_name,
            perspective,
            max_participants,
            registration_fee,
            registration_start,
            registration_end,
            tournament_start_time,
            total_prize_pool,
            first_prize,
            second_prize,
            third_prize,
            per_kill_reward,
            custom_rules,
            emulator_allowed
        } = req.body;
        
        if (!tournament_name || !game_mode || !max_participants || !tournament_start_time) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }
        
        if (max_participants > subscription.max_participants) {
            return res.status(400).json({
                success: false,
                message: `Your subscription allows maximum ${subscription.max_participants} participants`
            });
        }
        
        if (subscription.tournaments_limit !== null) {
            const [countResult] = await db.query(
                `SELECT COUNT(*) as count FROM tournaments 
                 WHERE host_user_id = ? 
                 AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                [req.userId]
            );
            
            if (countResult[0].count >= subscription.tournaments_limit) {
                return res.status(400).json({
                    success: false,
                    message: `You have reached your monthly tournament limit (${subscription.tournaments_limit})`
                });
            }
        }
        
        const commissionPercentage = parseFloat(process.env.PLATFORM_COMMISSION_PERCENTAGE) || 10;
        const commissionAmount = (total_prize_pool * commissionPercentage) / 100;
        
        const [result] = await db.query(
            `INSERT INTO tournaments 
             (tournament_name, tournament_description, host_user_id, game_mode, map_name, 
              perspective, max_participants, registration_fee, registration_start, 
              registration_end, tournament_start_time, total_prize_pool, first_prize, 
              second_prize, third_prize, per_kill_reward, custom_rules, emulator_allowed,
              tournament_status, platform_commission_percentage, platform_commission_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                    'registration_open', ?, ?)`,
            [
                tournament_name, tournament_description, req.userId, game_mode, map_name,
                perspective, max_participants, registration_fee || 0, registration_start,
                registration_end, tournament_start_time, total_prize_pool, first_prize,
                second_prize, third_prize, per_kill_reward || 0, custom_rules, 
                emulator_allowed || false, commissionPercentage, commissionAmount
            ]
        );
        
        res.status(201).json({
            success: true,
            message: 'Tournament created successfully!',
            data: {
                tournament_id: result.insertId,
                tournament_name: tournament_name
            }
        });
        
    } catch (error) {
        console.error('Create tournament error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating tournament',
            error: error.message
        });
    }
});

// ROUTE: Get My Hosted Tournaments
router.get('/my-tournaments', verifyToken, async (req, res) => {
    try {
        const [tournaments] = await db.query(
            `SELECT t.*, 
                    (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.tournament_id) as registered_count,
                    (SELECT AVG(rating) FROM host_ratings WHERE tournament_id = t.tournament_id) as tournament_rating
             FROM tournaments t
             WHERE t.host_user_id = ?
             ORDER BY t.created_at DESC`,
            [req.userId]
        );
        
        res.json({
            success: true,
            data: tournaments
        });
        
    } catch (error) {
        console.error('Get my tournaments error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching tournaments',
            error: error.message
        });
    }
});

// ROUTE: Update Tournament Details (Host Only)
router.put('/tournaments/:id', verifyToken, async (req, res) => {
    try {
        const tournamentId = req.params.id;
        
        const [tournaments] = await db.query(
            'SELECT * FROM tournaments WHERE tournament_id = ? AND host_user_id = ?',
            [tournamentId, req.userId]
        );
        
        if (tournaments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Tournament not found or you do not have permission'
            });
        }
        
        const { room_id, room_password, tournament_status } = req.body;
        
        await db.query(
            `UPDATE tournaments 
             SET room_id = COALESCE(?, room_id),
                 room_password = COALESCE(?, room_password),
                 tournament_status = COALESCE(?, tournament_status)
             WHERE tournament_id = ?`,
            [room_id, room_password, tournament_status, tournamentId]
        );
        
        res.json({
            success: true,
            message: 'Tournament updated successfully'
        });
        
    } catch (error) {
        console.error('Update tournament error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating tournament',
            error: error.message
        });
    }
});

module.exports = router;