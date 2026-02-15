const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('./auth');

// ROUTE: Get All Tournaments (Browse)
router.get('/', async (req, res) => {
    try {
        const status = req.query.status || 'registration_open';
        const gameMode = req.query.game_mode;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        let query = `
            SELECT t.*, u.username as host_username, u.full_name as host_name,
                   (SELECT AVG(rating) FROM host_ratings WHERE host_user_id = t.host_user_id) as host_rating
            FROM tournaments t
            JOIN users u ON t.host_user_id = u.user_id
            WHERE 1=1
        `;

        const params = [];

        if (status) {
            query += ' AND t.tournament_status = ?';
            params.push(status);

            // Only show tournaments with valid registration deadline
            if (status === 'registration_open') {
                query += ' AND t.registration_end > NOW()';
            }
        }

        if (gameMode) {
            query += ' AND t.game_mode = ?';
            params.push(gameMode);
        }

        query += ' ORDER BY t.tournament_start_time ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [tournaments] = await db.query(query, params);

        res.json({
            success: true,
            data: tournaments
        });

    } catch (error) {
        console.error('Get tournaments error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching tournaments',
            error: error.message
        });
    }
});

// ROUTE: Get Tournament Details (with user registration check)
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const tournamentId = req.params.id;
        const userId = req.userId;

        const [tournaments] = await db.query(
            `SELECT t.*, u.username as host_username, u.full_name as host_name,
                    u.profile_image_url as host_image,
                    (SELECT AVG(rating) FROM host_ratings WHERE host_user_id = t.host_user_id) as host_rating,
                    (SELECT COUNT(*) FROM host_ratings WHERE host_user_id = t.host_user_id) as host_rating_count
             FROM tournaments t
             JOIN users u ON t.host_user_id = u.user_id
             WHERE t.tournament_id = ?`,
            [tournamentId]
        );

        if (tournaments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Tournament not found'
            });
        }

        const [participantCount] = await db.query(
            `SELECT COUNT(*) as count 
             FROM tournament_registrations 
             WHERE tournament_id = ? AND registration_status IN ('confirmed', 'pending')`,
            [tournamentId]
        );

        // Check if current user is already registered
        const [userRegistration] = await db.query(
            `SELECT registration_id, registration_status, payment_status 
             FROM tournament_registrations 
             WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, userId]
        );

        const isRegistered = userRegistration.length > 0;
        const registrationStatus = isRegistered ? userRegistration[0].registration_status : null;

        res.json({
            success: true,
            data: {
                ...tournaments[0],
                registered_count: participantCount[0].count,
                is_registered: isRegistered,
                registration_status: registrationStatus
            }
        });

    } catch (error) {
        console.error('Get tournament error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching tournament',
            error: error.message
        });
    }
});

// ROUTE: Register for Tournament WITH PLAYER DETAILS
router.post('/:tournamentId/register', verifyToken, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const tournamentId = req.params.tournamentId;
        const userId = req.userId;
        const { team_id, registration_type, payment_method, player_details } = req.body;

        console.log('📝 Registration request:', {
            tournamentId,
            userId,
            team_id,
            registration_type,
            payment_method,
            has_player_details: !!player_details
        });

        // Check if already registered (only block if confirmed, allow re-attempt if pending)
        const [existing] = await connection.query(
            `SELECT * FROM tournament_registrations 
             WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, userId]
        );

        if (existing.length > 0) {
            // If registration is confirmed, block it
            if (existing[0].registration_status === 'confirmed') {
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: 'You are already registered for this tournament',
                    already_registered: true
                });
            }

            // If pending, delete it and allow re-registration
            if (existing[0].registration_status === 'pending') {
                console.log('🔄 Deleting previous pending registration');
                await connection.query(
                    'DELETE FROM tournament_registrations WHERE registration_id = ?',
                    [existing[0].registration_id]
                );
            }
        }

        // Get tournament details
        const [tournaments] = await connection.query(
            'SELECT * FROM tournaments WHERE tournament_id = ?',
            [tournamentId]
        );

        if (tournaments.length === 0) {
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Tournament not found'
            });
        }

        const tournament = tournaments[0];

        // Basic checks
        if (tournament.tournament_status !== 'registration_open') {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Registration is not open for this tournament'
            });
        }

        if (new Date() > new Date(tournament.registration_end)) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Registration deadline has passed'
            });
        }

        if (tournament.current_participants >= tournament.max_participants) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Tournament is full'
            });
        }

        const entryFee = parseFloat(tournament.registration_fee);
        const payMethod = payment_method || 'wallet';

        // ✅ WALLET PAYMENT - Complete immediately with TRANSACTION
        if (payMethod === 'wallet') {
            await connection.beginTransaction();

            try {
                const [wallets] = await connection.query(
                    'SELECT balance FROM wallet WHERE user_id = ?',
                    [userId]
                );

                if (wallets.length === 0 || parseFloat(wallets[0].balance) < entryFee) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        success: false,
                        message: 'Insufficient wallet balance'
                    });
                }

                const balanceBefore = parseFloat(wallets[0].balance);
                const newBalance = balanceBefore - entryFee;

                // Update wallet balance
                await connection.query(
                    'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
                    [newBalance, userId]
                );

                // Record wallet transaction
                await connection.query(
                    `INSERT INTO wallet_transactions 
                     (user_id, transaction_type, amount, balance_before, balance_after, 
                      status, payment_method, description)
                     VALUES (?, 'tournament_entry', ?, ?, ?, 'completed', ?, ?)`,
                    [
                        userId,
                        entryFee,
                        balanceBefore,
                        newBalance,
                        'wallet',
                        `Tournament entry fee - ${tournament.tournament_name}`
                    ]
                );

                // Create registration
                await connection.query(
                    `INSERT INTO tournament_registrations 
                     (tournament_id, user_id, team_id, registration_type, registration_fee_paid, 
                      payment_status, registration_status, player_details)
                     VALUES (?, ?, ?, ?, ?, 'completed', 'confirmed', ?)`,
                    [
                        tournamentId,
                        userId,
                        team_id || null,
                        registration_type || 'solo',
                        entryFee,
                        player_details || null
                    ]
                );

                // Update participant count
                await connection.query(
                    `UPDATE tournaments 
                     SET current_participants = current_participants + 1 
                     WHERE tournament_id = ?`,
                    [tournamentId]
                );

                // Send notification
                await connection.query(
                    `INSERT INTO notifications 
                     (user_id, notification_type, title, message, reference_type, reference_id)
                     VALUES (?, 'tournament_registration', 'Registration Successful', ?, 'tournament', ?)`,
                    [
                        userId,
                        `Successfully registered for ${tournament.tournament_name}`,
                        tournamentId
                    ]
                );

                // ✅ COMMIT EVERYTHING AT ONCE
                await connection.commit();
                connection.release();

                console.log('✅ Wallet payment - Registration confirmed');

                return res.json({
                    success: true,
                    message: 'Successfully registered for tournament',
                    data: {
                        tournament_id: tournamentId,
                        entry_fee: entryFee,
                        payment_method: 'wallet',
                        registration_status: 'confirmed'
                    }
                });

            } catch (error) {
                // ✅ ROLLBACK on any error
                await connection.rollback();
                connection.release();
                throw error;
            }
        }

        // ✅ PAYU PAYMENT - Create pending registration and return PayU data (same as wallet add money)
        if (payMethod === 'payu') {
            const [result] = await connection.query(
                `INSERT INTO tournament_registrations 
                 (tournament_id, user_id, team_id, registration_type, registration_fee_paid, 
                  payment_method, payment_status, registration_status, player_details)
                 VALUES (?, ?, ?, ?, ?, 'payu', 'pending', 'pending', ?)`,
                [
                    tournamentId,
                    userId,
                    team_id || null,
                    registration_type || 'solo',
                    entryFee,
                    player_details || null
                ]
            );

            const registrationId = result.insertId;
            connection.release();

            console.log('⏳ Registration pending - Awaiting PayU payment');

            // ✅ GENERATE PAYU PAYMENT DATA (same as wallet add money)
            const txnid = `TXN${Date.now()}${userId}`;
            const productinfo = `Tournament Registration - ${tournament.tournament_name}`;

            const [users] = await db.query('SELECT username, email, phone FROM users WHERE user_id = ?', [userId]);
            const user = users[0];

            // Use the same PayU config as wallet add money
            const payuParams = {
                key: PAYU_CONFIG.merchantKey,
                txnid: txnid,
                amount: entryFee.toString(),
                productinfo: productinfo,
                firstname: user.username || 'User',
                email: user.email || `user${userId}@kabutoesports.com`,
                phone: user.phone || '9999999999',
                surl: `${process.env.BACKEND_URL || 'https://kabuto-esports-api.onrender.com'}/api/payu/success`,
                furl: `${process.env.BACKEND_URL || 'https://kabuto-esports-api.onrender.com'}/api/payu/failure`,
                salt: PAYU_CONFIG.salt
            };

            // Generate hash using the same function as wallet add money
            const hash = generatePayUHash(payuParams);

            const payuData = {
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
            };

            console.log('✅ PayU data generated:', { txnid, amount: entryFee });

            return res.json({
                success: true,
                message: 'Registration pending. Please complete payment.',
                requires_payment: true,
                data: {
                    tournament_id: tournamentId,
                    registration_id: registrationId,
                    entry_fee: entryFee,
                    payment_method: 'payu',
                    registration_status: 'pending'
                },
                payu_data: payuData
            });
        }

        connection.release();

    } catch (error) {
        if (connection) connection.release();
        console.error('❌ Tournament registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to register for tournament: ' + error.message
        });
    }
});

// ROUTE: Get My Registrations WITH PLAYER DETAILS
router.get('/user/registrations', verifyToken, async (req, res) => {
    try {
        const [registrations] = await db.query(
            `SELECT tr.*, 
                    t.tournament_name, t.game_mode, t.tournament_start_time,
                    t.tournament_status, t.room_id, t.room_password,
                    t.banner_image_url, t.map_name, t.total_prize_pool
             FROM tournament_registrations tr
             JOIN tournaments t ON tr.tournament_id = t.tournament_id
             WHERE tr.user_id = ?
             ORDER BY t.tournament_start_time DESC`,
            [req.userId]
        );

        // Parse player_details JSON for each registration
        const registrationsWithDetails = registrations.map(reg => {
            if (reg.player_details) {
                try {
                    reg.player_details = JSON.parse(reg.player_details);
                } catch (e) {
                    console.error('Error parsing player_details:', e);
                }
            }
            return reg;
        });

        res.json({
            success: true,
            data: registrationsWithDetails
        });

    } catch (error) {
        console.error('Get registrations error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching registrations',
            error: error.message
        });
    }
});

// ROUTE: Get Tournament Results/Leaderboard
router.get('/:id/results', async (req, res) => {
    try {
        const [results] = await db.query(
            `SELECT tr.*, 
                    u.username, u.full_name, u.profile_image_url,
                    t.team_name
             FROM tournament_results tr
             LEFT JOIN users u ON tr.user_id = u.user_id
             LEFT JOIN teams t ON tr.team_id = t.team_id
             WHERE tr.tournament_id = ?
             ORDER BY tr.rank_position ASC`,
            [req.params.id]
        );

        res.json({
            success: true,
            data: results
        });

    } catch (error) {
        console.error('Get results error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching results',
            error: error.message
        });
    }
});

module.exports = router;