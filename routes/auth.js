const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// MIDDLEWARE: Verify JWT Token
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'No token provided'
        });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        req.userId = decoded.user_id;  // ✅ CHANGED: Now reads user_id
        next();
    });
};

// ROUTE: Register New User
router.post('/register', async (req, res) => {
    try {
        const { username, email, phone, password, full_name, bgmi_id } = req.body;
        
        console.log('📝 Registration request:', { username, email, phone });
        
        if (!username || !email || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }
        
        const [existingUsers] = await db.query(
            'SELECT * FROM users WHERE username = ? OR email = ? OR phone = ?',
            [username, email, phone]
        );
        
        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Username, email, or phone already exists'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await db.query(
            `INSERT INTO users (username, email, phone, password_hash, full_name, bgmi_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, email, phone, hashedPassword, full_name || null, bgmi_id || null]
        );
        
        console.log('✅ User registered with ID:', result.insertId);
        
        const token = jwt.sign(
            { user_id: result.insertId, username: username },  // ✅ CHANGED: userId → user_id
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user_id: result.insertId,
                username: username,
                email: email,
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Error registering user',
            error: error.message
        });
    }
});

// ROUTE: Login User
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('🔐 Login request for:', username);
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide username and password'
            });
        }
        
        const [users] = await db.query(
            `SELECT * FROM users 
             WHERE username = ? OR email = ? OR phone = ?`,
            [username, username, username]
        );
        
        if (users.length === 0) {
            console.log('❌ User not found:', username);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        const user = users[0];
        
        if (user.account_status !== 'active') {
            console.log('❌ Account not active:', user.account_status);
            return res.status(403).json({
                success: false,
                message: `Account is ${user.account_status}`
            });
        }
        
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
            console.log('❌ Invalid password for user:', username);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        
        await db.query(
            'UPDATE users SET last_login = NOW() WHERE user_id = ?',
            [user.user_id]
        );
        
        console.log('✅ Login successful - User ID:', user.user_id);
        
        const token = jwt.sign(
            { user_id: user.user_id, username: user.username },  // ✅ CHANGED: userId → user_id
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );
        
        delete user.password_hash;
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: user,
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Error logging in',
            error: error.message
        });
    }
});

// ROUTE: Get Current User Profile
router.get('/profile', verifyToken, async (req, res) => {
    try {
        console.log('👤 Profile request for user ID:', req.userId);
        
        const [users] = await db.query(
            'SELECT * FROM users WHERE user_id = ?',
            [req.userId]
        );
        
        if (users.length === 0) {
            console.log('❌ User not found in profile:', req.userId);
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = users[0];
        delete user.password_hash;
        
        console.log('✅ Profile retrieved for:', user.username);
        
        res.json({
            success: true,
            data: user
        });
        
    } catch (error) {
        console.error('❌ Profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching profile',
            error: error.message
        });
    }
});

// ROUTE: Update User Profile
router.put('/profile', verifyToken, async (req, res) => {
    try {
        const { full_name, bio, bgmi_id, bgmi_username, date_of_birth, gender, city, state } = req.body;
        
        console.log('📝 Profile update for user ID:', req.userId);
        
        await db.query(
            `UPDATE users SET 
                full_name = COALESCE(?, full_name),
                bio = COALESCE(?, bio),
                bgmi_id = COALESCE(?, bgmi_id),
                bgmi_username = COALESCE(?, bgmi_username),
                date_of_birth = COALESCE(?, date_of_birth),
                gender = COALESCE(?, gender),
                city = COALESCE(?, city),
                state = COALESCE(?, state)
             WHERE user_id = ?`,
            [full_name, bio, bgmi_id, bgmi_username, date_of_birth, gender, city, state, req.userId]
        );
        
        console.log('✅ Profile updated for user ID:', req.userId);
        
        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
        
    } catch (error) {
        console.error('❌ Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: error.message
        });
    }
});

module.exports = router;
module.exports.verifyToken = verifyToken;