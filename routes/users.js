const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('./auth');

// ROUTE: Get User by ID
router.get('/:id', async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT user_id, username, full_name, profile_image_url, bio, 
                    bgmi_id, bgmi_username, total_matches_played, total_wins, 
                    total_kills, win_rate, player_level, total_xp, 
                    created_at
             FROM users WHERE user_id = ?`,
            [req.params.id]
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
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user',
            error: error.message
        });
    }
});

// ROUTE: Search Users
router.get('/search/users', async (req, res) => {
    try {
        const query = req.query.query;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Search query required'
            });
        }
        
        const [users] = await db.query(
            `SELECT user_id, username, full_name, profile_image_url, 
                    player_level, total_wins
             FROM users 
             WHERE (username LIKE ? OR full_name LIKE ?)
             AND account_status = 'active'
             LIMIT 20`,
            [`%${query}%`, `%${query}%`]
        );
        
        res.json({
            success: true,
            data: users
        });
        
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching users',
            error: error.message
        });
    }
});

// ROUTE: Get User Stats
router.get('/:id/stats', async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT total_matches_played, total_wins, total_kills, 
                    win_rate, total_earnings, player_level, total_xp
             FROM users WHERE user_id = ?`,
            [req.params.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const [tournamentStats] = await db.query(
            `SELECT 
                COUNT(*) as tournaments_played,
                COUNT(CASE WHEN rank_position = 1 THEN 1 END) as first_places,
                COUNT(CASE WHEN rank_position = 2 THEN 1 END) as second_places,
                COUNT(CASE WHEN rank_position = 3 THEN 1 END) as third_places,
                SUM(total_kills) as total_tournament_kills
             FROM tournament_results
             WHERE user_id = ?`,
            [req.params.id]
        );
        
        res.json({
            success: true,
            data: {
                ...users[0],
                tournament_stats: tournamentStats[0]
            }
        });
        
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching stats',
            error: error.message
        });
    }
});

// ROUTE: Get Global Leaderboard
router.get('/leaderboard/global', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const [leaderboard] = await db.query(
            `SELECT user_id, username, full_name, profile_image_url,
                    total_wins, total_kills, win_rate, total_earnings,
                    player_level, total_xp,
                    ROW_NUMBER() OVER (ORDER BY total_wins DESC, total_kills DESC) as rank_position
             FROM users
             WHERE account_status = 'active'
             ORDER BY total_wins DESC, total_kills DESC
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );
        
        res.json({
            success: true,
            data: leaderboard
        });
        
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leaderboard',
            error: error.message
        });
    }
});

// ROUTE: Get User's Recent Matches
router.get('/:id/matches', async (req, res) => {
    try {
        const [matches] = await db.query(
            `SELECT 
                tr.result_id,
                tr.rank_position,
                tr.total_kills,
                tr.points,
                tr.prize_amount,
                tr.submitted_at,
                t.tournament_id,
                t.tournament_name,
                t.game_mode,
                t.tournament_start_time
             FROM tournament_results tr
             JOIN tournaments t ON tr.tournament_id = t.tournament_id
             WHERE tr.user_id = ?
             ORDER BY tr.submitted_at DESC
             LIMIT 20`,
            [req.params.id]
        );
        
        res.json({
            success: true,
            data: matches
        });
        
    } catch (error) {
        console.error('Get matches error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching matches',
            error: error.message
        });
    }
});

module.exports = router;