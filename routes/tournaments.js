const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('./auth');

// Base URL for constructing absolute banner image URLs
const BASE_URL = process.env.BASE_URL || 'http://139.59.1.29';

// Helper: attach full URL to banner_image_url field
const withBanner = (obj) => ({
    ...obj,
    banner_image_url: obj.banner_image_url
        ? (obj.banner_image_url.startsWith('http') ? obj.banner_image_url : `${BASE_URL}${obj.banner_image_url}`)
        : null
});

// ROUTE: Get All Tournaments (Browse)
router.get('/', async (req, res) => {
    try {
        // Accept comma-separated statuses, e.g. ?status=registration_open,ongoing
        // Default: show both registration_open and ongoing tournaments
        const statusParam = req.query.status;
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

        if (statusParam) {
            // Support single status filter from Android app (e.g. ?status=registration_open)
            query += ' AND t.tournament_status = ?';
            params.push(statusParam);
        } else {
            // Default: show active tournaments (registration open OR ongoing)
            query += " AND t.tournament_status IN ('registration_open', 'ongoing')";
        }

        if (gameMode) {
            query += ' AND t.game_mode = ?';
            params.push(gameMode);
        }

        // Newest tournaments first
        query += ' ORDER BY t.tournament_id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [tournaments] = await db.query(query, params);

        console.log(`📋 GET /tournaments — status=${statusParam || 'default'} — found ${tournaments.length}`);

        res.json({
            success: true,
            data: tournaments.map(withBanner)
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

// ROUTE: Get My Tournaments (alias — must come BEFORE /:id to avoid 'my' being parsed as an ID)
router.get('/my', verifyToken, async (req, res) => {
    try {
        const [registrations] = await db.query(
            `SELECT tr.*,
                    t.tournament_name, t.game_mode, t.tournament_start_time,
                    t.tournament_status, t.room_id, t.room_password,
                    t.banner_image_url, t.map_name
             FROM tournament_registrations tr
             JOIN tournaments t ON tr.tournament_id = t.tournament_id
             WHERE tr.user_id = ?
             ORDER BY t.tournament_start_time DESC`,
            [req.userId]
        );

        const registrationsWithDetails = registrations.map(reg => {
            if (reg.player_details && typeof reg.player_details === 'string') {
                try { reg.player_details = JSON.parse(reg.player_details); }
                catch (e) { /* leave as-is */ }
            }
            return withBanner(reg);
        });

        res.json({ success: true, data: registrationsWithDetails });
    } catch (error) {
        console.error('Get my tournaments error:', error);
        res.status(500).json({ success: false, message: 'Error fetching your tournaments', error: error.message });
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
            data: withBanner({
                ...tournaments[0],
                registered_count: participantCount[0].count,
                is_registered: isRegistered,
                registration_status: registrationStatus
            })
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

// ROUTE: Get User Registration for a Specific Tournament (for pre-filling form)
router.get('/:id/user-registration', verifyToken, async (req, res) => {
    try {
        const tournamentId = req.params.id;
        const userId = req.userId;

        const [rows] = await db.query(
            `SELECT registration_type, player_details FROM tournament_registrations
             WHERE tournament_id = ? AND user_id = ?
             LIMIT 1`,
            [tournamentId, userId]
        );

        if (rows.length === 0) {
            return res.json({ success: true, data: null });
        }

        let details = rows[0].player_details;
        if (details && typeof details === 'string') {
            try { details = JSON.parse(details); } catch (e) { details = null; }
        }

        res.json({
            success: true,
            data: {
                registration_type: rows[0].registration_type,
                team_name: details?.team_name || null,
                ign: details?.ign || null,
                in_game_id: details?.in_game_id || null,
                whatsapp: details?.whatsapp || null,
                email: details?.email || null,
                players: details?.players || null
            }
        });
    } catch (error) {
        console.error('Get user registration error:', error);
        res.status(500).json({ success: false, message: 'Error fetching registration data', error: error.message });
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

        // ✅ ALL TOURNAMENTS ARE FREE — register directly, no payment required
        await connection.beginTransaction();
        try {
            await connection.query(
                `INSERT INTO tournament_registrations
                 (tournament_id, user_id, team_id, registration_type, registration_fee_paid,
                  payment_status, registration_status, player_details)
                 VALUES (?, ?, ?, ?, 0, 'completed', 'confirmed', ?)`,
                [
                    tournamentId,
                    userId,
                    team_id || null,
                    registration_type || 'solo',
                    player_details || null
                ]
            );

            await connection.query(
                `UPDATE tournaments
                 SET current_participants = current_participants + 1
                 WHERE tournament_id = ?`,
                [tournamentId]
            );

            await connection.query(
                `INSERT INTO notifications
                 (user_id, notification_type, title, message, reference_type, reference_id)
                 VALUES (?, 'tournament_registration', 'Registration Successful', ?, 'tournament', ?)`,
                [userId, `Successfully registered for ${tournament.tournament_name}`, tournamentId]
            );

            await connection.commit();
            connection.release();

            console.log('✅ Registration confirmed (free tournament):', { tournamentId, userId });

            return res.json({
                success: true,
                message: 'Registration successful',
                data: {
                    tournament_id: tournamentId,
                    registration_status: 'confirmed'
                }
            });

        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }

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
                    t.banner_image_url, t.map_name
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