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

// ROUTE: Register for Tournament
router.post('/:id/register', verifyToken, async (req, res) => {
    try {
        const tournamentId = req.params.id;
        const { team_id } = req.body;
        
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
        
        if (['duo', 'squad'].includes(tournament.game_mode) && !team_id) {
            return res.status(400).json({
                success: false,
                message: 'Team ID required for team tournaments'
            });
        }
        
        if (tournament.game_mode === 'solo' && team_id) {
            return res.status(400).json({
                success: false,
                message: 'Solo tournaments do not require team'
            });
        }
        
        const [existing] = await db.query(
            `SELECT * FROM tournament_registrations 
             WHERE tournament_id = ? AND (user_id = ? OR team_id = ?)`,
            [tournamentId, req.userId, team_id]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Already registered for this tournament'
            });
        }
        
        const [users] = await db.query(
            'SELECT wallet_balance FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        if (users[0].wallet_balance < tournament.registration_fee) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        await db.query('START TRANSACTION');
        
        try {
            await db.query(
                'UPDATE users SET wallet_balance = wallet_balance - ? WHERE user_id = ?',
                [tournament.registration_fee, req.userId]
            );
            
            await db.query(
                `INSERT INTO wallet_transactions 
                 (user_id, transaction_type, amount, balance_before, balance_after, 
                  status, reference_type, reference_id, description)
                 VALUES (?, 'tournament_entry', ?, ?, ?, 'completed', 'tournament', ?, ?)`,
                [
                    req.userId,
                    -tournament.registration_fee,
                    users[0].wallet_balance,
                    users[0].wallet_balance - tournament.registration_fee,
                    tournamentId,
                    `Entry fee for ${tournament.tournament_name}`
                ]
            );
            
            await db.query(
                `INSERT INTO tournament_registrations 
                 (tournament_id, user_id, team_id, registration_fee_paid, payment_status, registration_status)
                 VALUES (?, ?, ?, ?, 'completed', 'confirmed')`,
                [tournamentId, req.userId, team_id || null, tournament.registration_fee]
            );
            
            await db.query(
                'UPDATE tournaments SET current_participants = current_participants + 1 WHERE tournament_id = ?',
                [tournamentId]
            );
            
            await db.query(
                `INSERT INTO notifications 
                 (user_id, notification_type, title, message, reference_type, reference_id)
                 VALUES (?, 'tournament_registration', 'Registration Successful', ?, 'tournament', ?)`,
                [
                    req.userId,
                    `Successfully registered for ${tournament.tournament_name}`,
                    tournamentId
                ]
            );
            
            await db.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Registration successful!',
                data: {
                    tournament_id: tournamentId,
                    entry_fee: tournament.registration_fee,
                    new_balance: users[0].wallet_balance - tournament.registration_fee
                }
            });
            
        } catch (err) {
            await db.query('ROLLBACK');
            throw err;
        }
        
    } catch (error) {
        console.error('Register tournament error:', error);
        res.status(500).json({
            success: false,
            message: 'Error registering for tournament',
            error: error.message
        });
    }
});

// ROUTE: Get My Registrations
router.get('/my/registrations', verifyToken, async (req, res) => {
    try {
        const [registrations] = await db.query(
            `SELECT tr.*, t.tournament_name, t.game_mode, t.tournament_start_time,
                    t.tournament_status, t.room_id, t.room_password
             FROM tournament_registrations tr
             JOIN tournaments t ON tr.tournament_id = t.tournament_id
             WHERE tr.user_id = ?
             ORDER BY t.tournament_start_time DESC`,
            [req.userId]
        );
        
        res.json({
            success: true,
            data: registrations
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