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

module.exports = router;