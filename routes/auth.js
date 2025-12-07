const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendOtpEmail } = require('../utils/emailService'); // 👈 email sender

// Debug: make sure this file is actually loaded
console.log('✅ auth routes loaded');

// MULTER CONFIGURATION FOR IMAGE UPLOADS
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadType = req.path.includes('profile-picture') ? 'profiles' : 'banners';
        const uploadPath = path.join(__dirname, `../uploads/${uploadType}`);

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, req.userId + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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
        req.userId = decoded.user_id;
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
            { user_id: result.insertId, username: username },
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
            { user_id: user.user_id, username: user.username },
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

// ===============================
// FORGOT PASSWORD / OTP ROUTES
// ===============================

// 1️⃣ Send OTP (4-digit, 10 min expiry)
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        // We treat "email" field as a general identifier (email OR username OR phone)
        const identifier = (email || '').trim();

        console.log('🔁 Forgot-password request body:', req.body);
        console.log('🔁 Using identifier:', identifier);

        if (!identifier) {
            return res.status(400).json({
                success: false,
                message: 'Email / username / phone is required'
            });
        }

        // Search user by email OR username OR phone (case-insensitive for email/username)
        const [users] = await db.query(
            `SELECT user_id, email, username, phone 
             FROM users 
             WHERE LOWER(email) = LOWER(?) 
                OR LOWER(username) = LOWER(?) 
                OR phone = ?`,
            [identifier, identifier, identifier]
        );

        console.log('🔍 Forgot-password DB users result:', users);

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User with this identifier not found'
            });
        }

        const user = users[0];

        // Generate 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await db.query(
            'UPDATE users SET reset_password_otp = ?, reset_password_expires = ? WHERE user_id = ?',
            [otp, expiresAt, user.user_id]
        );

        // 🔥 send OTP email via Hostinger
        try {
            await sendOtpEmail(user.email, otp);
            console.log(`📧 Password reset OTP email sent to ${user.email}: ${otp}`);
        } catch (emailErr) {
            console.error('❌ Error sending OTP email:', emailErr);
            // (OTP is still stored in DB, so technically user can reset if they somehow get the code)
        }

        return res.json({
            success: true,
            message: 'OTP sent successfully',
            data: null
        });

    } catch (error) {
        console.error('❌ Forgot password error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error sending OTP',
            error: error.message
        });
    }
});

// 2️⃣ Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        const identifier = (email || '').trim();

        console.log('🔁 Verify-OTP request body:', req.body);
        console.log('🔁 Verify-OTP identifier:', identifier, 'otp:', otp);

        if (!identifier || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email / username / phone and OTP are required'
            });
        }

        // Same identifier logic as forgot-password
        const [users] = await db.query(
            `SELECT user_id, email, username, phone, reset_password_otp, reset_password_expires 
             FROM users 
             WHERE LOWER(email) = LOWER(?) 
                OR LOWER(username) = LOWER(?) 
                OR phone = ?`,
            [identifier, identifier, identifier]
        );

        console.log('🔍 Verify-OTP DB users result:', users);

        if (users.length === 0) {
            return res.json({
                success: true,
                message: 'OTP verification failed',
                data: {
                    verified: false,
                    message: 'User not found'
                }
            });
        }

        const user = users[0];

        const storedOtp = user.reset_password_otp;
        const expires = user.reset_password_expires;

        if (!storedOtp || !expires) {
            return res.json({
                success: true,
                message: 'OTP verification failed',
                data: {
                    verified: false,
                    message: 'No OTP requested'
                }
            });
        }

        const now = new Date();

        if (storedOtp !== otp || new Date(expires) < now) {
            return res.json({
                success: true,
                message: 'OTP verification failed',
                data: {
                    verified: false,
                    message: 'Invalid or expired OTP'
                }
            });
        }

        return res.json({
            success: true,
            message: 'OTP verified',
            data: {
                verified: true,
                message: 'OTP verified successfully'
            }
        });

    } catch (error) {
        console.error('❌ Verify OTP error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verifying OTP',
            error: error.message
        });
    }
});

// 3️⃣ Reset Password
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, new_password } = req.body;

        const identifier = (email || '').trim();

        console.log('🔁 Reset-password request body:', req.body);
        console.log('🔁 Reset-password identifier:', identifier);

        if (!identifier || !otp || !new_password) {
            return res.status(400).json({
                success: false,
                message: 'Email / username / phone, OTP and new password are required'
            });
        }

        const [users] = await db.query(
            `SELECT user_id, email, username, phone, reset_password_otp, reset_password_expires 
             FROM users 
             WHERE LOWER(email) = LOWER(?) 
                OR LOWER(username) = LOWER(?) 
                OR phone = ?`,
            [identifier, identifier, identifier]
        );

        console.log('🔍 Reset-password DB users result:', users);

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];
        const storedOtp = user.reset_password_otp;
        const expires = user.reset_password_expires;
        const now = new Date();

        if (!storedOtp || !expires || storedOtp !== otp || new Date(expires) < now) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP'
            });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);

        await db.query(
            `UPDATE users 
             SET password_hash = ?, reset_password_otp = NULL, reset_password_expires = NULL 
             WHERE user_id = ?`,
            [hashedPassword, user.user_id]
        );

        console.log('✅ Password reset for user ID:', user.user_id);

        return res.json({
            success: true,
            message: 'Password reset successfully',
            data: null
        });

    } catch (error) {
        console.error('❌ Reset password error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error resetting password',
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

// ==========================================
// IMAGE UPLOAD ROUTES
// ==========================================

// ROUTE: Upload Profile Picture
router.post('/upload-profile-picture', verifyToken, upload.single('image'), async (req, res) => {
    try {
        console.log('📸 Profile picture upload for user ID:', req.userId);

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        // Construct the URL for the uploaded image
        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/profiles/${req.file.filename}`;

        // Update user's profile_image_url in database
        await db.query(
            'UPDATE users SET profile_image_url = ? WHERE user_id = ?',
            [imageUrl, req.userId]
        );

        console.log('✅ Profile picture uploaded:', imageUrl);

        res.json({
            success: true,
            message: 'Profile picture uploaded successfully',
            data: imageUrl
        });

    } catch (error) {
        console.error('❌ Upload profile picture error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading profile picture',
            error: error.message
        });
    }
});

// ROUTE: Upload Banner Image
router.post('/upload-banner', verifyToken, upload.single('image'), async (req, res) => {
    try {
        console.log('🖼️ Banner upload for user ID:', req.userId);

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        // Construct the URL for the uploaded image
        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/banners/${req.file.filename}`;

        // Update user's banner_image_url in database
        await db.query(
            'UPDATE users SET banner_image_url = ? WHERE user_id = ?',
            [imageUrl, req.userId]
        );

        console.log('✅ Banner uploaded:', imageUrl);

        res.json({
            success: true,
            message: 'Banner uploaded successfully',
            data: imageUrl
        });

    } catch (error) {
        console.error('❌ Upload banner error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading banner',
            error: error.message
        });
    }
});

module.exports = router;
module.exports.verifyToken = verifyToken;
