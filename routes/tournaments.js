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

// ROUTE: Get Tournament Details
router.get('/:id', async (req, res) => {
    try {
        const [tournaments] = await db.query(
            `SELECT t.*, u.username as host_username, u.full_name as host_name,
                    u.profile_image_url as host_image,
                    (SELECT AVG(rating) FROM host_ratings WHERE host_user_id = t.host_user_id) as host_rating,
                    (SELECT COUNT(*) FROM host_ratings WHERE host_user_id = t.host_user_id) as host_rating_count
             FROM tournaments t
             JOIN users u ON t.host_user_id = u.user_id
             WHERE t.tournament_id = ?`,
            [req.params.id]
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
             WHERE tournament_id = ? AND registration_status IN ('registered', 'confirmed')`,
            [req.params.id]
        );

        res.json({
            success: true,
            data: {
                ...tournaments[0],
                registered_count: participantCount[0].count
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

        // Check if already registered
        const [existing] = await db.query(
            `SELECT * FROM tournament_registrations 
             WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, userId]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'You are already registered for this tournament'
            });
        }

        // Get tournament details
        const [tournaments] = await db.query(
            'SELECT * FROM tournaments WHERE tournament_id = ?',
            [tournamentId]
        );

        if (tournaments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Tournament not found'
            });
        }

        const tournament = tournaments[0];

        // Basic checks
        if (tournament.tournament_status !== 'registration_open') {
            return res.status(400).json({
                success: false,
                message: 'Registration is not open for this tournament'
            });
        }

        if (new Date() > new Date(tournament.registration_end)) {
            return res.status(400).json({
                success: false,
                message: 'Registration deadline has passed'
            });
        }

        if (tournament.current_participants >= tournament.max_participants) {
            return res.status(400).json({
                success: false,
                message: 'Tournament is full'
            });
        }

        const entryFee = parseFloat(tournament.registration_fee);
        const payMethod = payment_method || 'wallet';

        // Handle wallet payment
        if (payMethod === 'wallet') {
            const [wallets] = await db.query(
                'SELECT balance FROM wallet WHERE user_id = ?',
                [userId]
            );

            if (wallets.length === 0 || parseFloat(wallets[0].balance) < entryFee) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient wallet balance'
                });
            }

            const balanceBefore = parseFloat(wallets[0].balance);
            const newBalance = balanceBefore - entryFee;

            await db.query(
                'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
                [newBalance, userId]
            );

            // Record wallet transaction
            await db.query(
                `INSERT INTO wallet_transactions 
                 (user_id, transaction_type, amount, balance_before, balance_after, 
                  status, payment_method, description)
                 VALUES (?, 'debit', ?, ?, ?, 'success', ?, ?)`,
                [
                    userId,
                    entryFee,
                    balanceBefore,
                    newBalance,
                    payMethod,
                    `Tournament entry fee - ${tournament.tournament_name}`
                ]
            );
        }

        // ✅ Register with player details stored as JSON
        await db.query(
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
        await db.query(
            `UPDATE tournaments 
             SET current_participants = current_participants + 1 
             WHERE tournament_id = ?`,
            [tournamentId]
        );

        // Send notification
        await db.query(
            `INSERT INTO notifications 
             (user_id, notification_type, title, message, reference_type, reference_id)
             VALUES (?, 'tournament_registration', 'Registration Successful', ?, 'tournament', ?)`,
            [
                userId,
                `Successfully registered for ${tournament.tournament_name}`,
                tournamentId
            ]
        );

        console.log('✅ Registration successful for user', userId, 'in tournament', tournamentId);

        res.json({
            success: true,
            message: 'Successfully registered for tournament',
            data: {
                tournament_id: tournamentId,
                entry_fee: entryFee,
                payment_method: payMethod
            }
        });

    } catch (error) {
        console.error('❌ Tournament registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to register for tournament: ' + error.message
        });
    }
});

// ROUTE: Get My Registrations WITH PLAYER DETAILS
router.get('/my/registrations', verifyToken, async (req, res) => {
    try {
        const [registrations] = await db.query(
            `SELECT tr.*, 
                    t.tournament_name, t.game_mode, t.tournament_start_time,
                    t.tournament_status, t.room_id, t.room_password
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