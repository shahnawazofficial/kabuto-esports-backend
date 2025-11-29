const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'kabuto_admin_secret_key_2024';

// Middleware to verify admin token
const verifyAdminToken = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if admin exists and is active
        const [admins] = await db.query(
            'SELECT * FROM admins WHERE admin_id = ? AND is_active = true',
            [decoded.admin_id]
        );

        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token or admin account disabled'
            });
        }

        req.admin = admins[0];
        next();
    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

// Middleware to check if super admin
const verifySuperAdmin = (req, res, next) => {
    if (req.admin.admin_role !== 'super') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Super admin only.'
        });
    }
    next();
};

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

// Admin Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('🔐 Admin login attempt:', username);

        // Find admin by username
        const [admins] = await db.query(
            'SELECT * FROM admins WHERE username = ?',
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        const admin = admins[0];

        // Check if admin is active
        if (!admin.is_active) {
            return res.status(401).json({
                success: false,
                message: 'Account has been disabled'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, admin.password);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        // Update last login
        await db.query(
            'UPDATE admins SET last_login = NOW() WHERE admin_id = ?',
            [admin.admin_id]
        );

        // Generate token
        const token = jwt.sign(
            { 
                admin_id: admin.admin_id,
                admin_role: admin.admin_role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('✅ Admin login successful:', username);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                admin: {
                    admin_id: admin.admin_id,
                    username: admin.username,
                    email: admin.email,
                    full_name: admin.full_name,
                    admin_role: admin.admin_role
                }
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});

// Get Admin Profile
router.get('/profile', verifyAdminToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                admin_id: req.admin.admin_id,
                username: req.admin.username,
                email: req.admin.email,
                full_name: req.admin.full_name,
                admin_role: req.admin.admin_role,
                created_at: req.admin.created_at,
                last_login: req.admin.last_login
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching profile',
            error: error.message
        });
    }
});

// ==========================================
// DASHBOARD STATS
// ==========================================

router.get('/dashboard/stats', verifyAdminToken, async (req, res) => {
    try {
        // Total Users
        const [users] = await db.query('SELECT COUNT(*) as count FROM users');
        const totalUsers = users[0].count;

        // Total Tournaments
        const [tournaments] = await db.query('SELECT COUNT(*) as count FROM tournaments');
        const totalTournaments = tournaments[0].count;

        // Active Tournaments (registration_open)
        const [activeTournaments] = await db.query(
            'SELECT COUNT(*) as count FROM tournaments WHERE tournament_status = ?',
            ['registration_open']
        );
        const activeTournamentsCount = activeTournaments[0].count;

        // Total Registrations
        const [registrations] = await db.query(
            'SELECT COUNT(*) as count FROM tournament_registrations'
        );
        const totalRegistrations = registrations[0].count;

        // Total Revenue (from wallet transactions - tournament entries)
        const [revenue] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'tournament_entry'`
        );
        const totalRevenue = revenue[0].total;

        res.json({
            success: true,
            data: {
                totalUsers,
                totalTournaments,
                activeTournaments: activeTournamentsCount,
                totalRegistrations,
                totalRevenue
            }
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard stats',
            error: error.message
        });
    }
});

// Get Recent Registrations
router.get('/dashboard/recent-registrations', verifyAdminToken, async (req, res) => {
    try {
        const [registrations] = await db.query(
            `SELECT 
                tr.registration_id,
                tr.registration_type,
                tr.registration_fee_paid,
                tr.registration_status,
                tr.registered_at,
                u.username,
                u.full_name,
                t.tournament_name
             FROM tournament_registrations tr
             JOIN users u ON tr.user_id = u.user_id
             JOIN tournaments t ON tr.tournament_id = t.tournament_id
             ORDER BY tr.registered_at DESC
             LIMIT 10`
        );

        res.json({
            success: true,
            data: registrations
        });

    } catch (error) {
        console.error('Recent registrations error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching recent registrations',
            error: error.message
        });
    }
});

module.exports = router;