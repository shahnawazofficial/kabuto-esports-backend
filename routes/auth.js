const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendOtpEmail } = require('../utils/emailService');

console.log('✅ auth routes loaded');

// MULTER CONFIGURATION FOR IMAGE UPLOADS
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadType = req.path.includes('profile-picture') ? 'profiles' : 'banners';
        const uploadPath = path.join(__dirname, `../uploads/${uploadType}`);

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
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
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

// ===============================
// REGISTER ROUTE - WITH SPECIFIC ERROR MESSAGES
// ===============================
router.post('/register', async (req, res) => {
    try {
        const { username, email, phone, password, full_name, bgmi_id } = req.body;

        console.log('📝 Registration request:', { username, email, phone });

        // Validate required fields
        if (!username || !email || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        // ✅ CHECK USERNAME
        const [usernameCheck] = await db.query(
            'SELECT username FROM users WHERE username = ?',
            [username]
        );

        if (usernameCheck.length > 0) {
            console.log('❌ Username already exists:', username);
            return res.status(400).json({
                success: false,
                message: 'This username is already taken. Please choose another one.'
            });
        }

        // ✅ CHECK EMAIL
        const [emailCheck] = await db.query(
            'SELECT email FROM users WHERE email = ?',
            [email]
        );

        if (emailCheck.length > 0) {
            console.log('❌ Email already exists:', email);
            return res.status(400).json({
                success: false,
                message: 'This email is already registered. Please use another email or login.'
            });
        }

        // ✅ CHECK PHONE
        const [phoneCheck] = await db.query(
            'SELECT phone FROM users WHERE phone = ?',
            [phone]
        );

        if (phoneCheck.length > 0) {
            console.log('❌ Phone already exists:', phone);
            return res.status(400).json({
                success: false,
                message: 'This phone number is already registered. Please use another number or login.'
            });
        }

        // ✅ ALL CHECKS PASSED - CREATE USER
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
            message: 'Registration successful! Welcome to Kabuto Esports.',
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
            message: 'Server error during registration. Please try again later.',
            error: error.message
        });
    }
});

// ===============================
// LOGIN ROUTE - WITH SPECIFIC ERROR MESSAGES
// ===============================
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

        // ❌ USER NOT FOUND
        if (users.length === 0) {
            console.log('❌ User not found:', username);
            return res.status(401).json({
                success: false,
                message: 'Username, email or phone not registered. Please sign up first.'
            });
        }

        const user = users[0];

        // Check account status
        if (user.account_status !== 'active') {
            console.log('❌ Account not active:', user.account_status);
            return res.status(403).json({
                success: false,
                message: `Your account is ${user.account_status}. Please contact support.`
            });
        }

        // ❌ WRONG PASSWORD
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            console.log('❌ Invalid password for user:', username);
            return res.status(401).json({
                success: false,
                message: 'Incorrect password. Please try again.'
            });
        }

        // ✅ LOGIN SUCCESSFUL
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
            message: 'Server error. Please try again later.',
            error: error.message
        });
    }
});

// ===============================
// FORGOT PASSWORD - WITH SPECIFIC ERROR MESSAGES
// ===============================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const identifier = (email || '').trim();

        console.log('🔁 Forgot-password request:', identifier);

        if (!identifier) {
            return res.status(400).json({
                success: false,
                message: 'Email, username or phone is required'
            });
        }

        // Search user by email OR username OR phone
        const [users] = await db.query(
            `SELECT user_id, email, username, phone 
             FROM users 
             WHERE LOWER(email) = LOWER(?) 
                OR LOWER(username) = LOWER(?) 
                OR phone = ?`,
            [identifier, identifier, identifier]
        );

        // ❌ USER NOT FOUND - SPECIFIC ERROR
        if (users.length === 0) {
            console.log('❌ User not found for forgot password:', identifier);
            return res.status(404).json({
                success: false,
                message: 'No account found with this email, username or phone number. Please sign up first.'
            });
        }

        const user = users[0];

        // Generate 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Save OTP to database
        await db.query(
            'UPDATE users SET reset_password_otp = ?, reset_password_expires = ? WHERE user_id = ?',
            [otp, expiresAt, user.user_id]
        );

        console.log(`✅ OTP saved to database for user ${user.email}: ${otp}`);

        // Try to send email
        try {
            console.log(`📧 Attempting to send OTP email to ${user.email}...`);
            
            const emailPromise = sendOtpEmail(user.email, otp);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Email sending timeout')), 15000)
            );

            await Promise.race([emailPromise, timeoutPromise]);
            
            console.log(`✅ OTP email sent successfully to ${user.email}`);
        } catch (emailErr) {
            console.error('❌ Error sending OTP email:', emailErr);
            console.log('⚠️ Email failed but OTP is saved in database');
        }

        return res.json({
            success: true,
            message: 'OTP sent successfully to your email',
            data: null
        });

    } catch (error) {
        console.error('❌ Forgot password error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error. Please try again later.',
            error: error.message
        });
    }
});

// ===============================
// VERIFY OTP
// ===============================
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const identifier = (email || '').trim();

        console.log('🔁 Verify-OTP request:', identifier, 'otp:', otp);

        if (!identifier || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email / username / phone and OTP are required'
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

        console.log('✅ OTP verified successfully for:', user.email);

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

// ===============================
// RESET PASSWORD
// ===============================
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, new_password } = req.body;
        const identifier = (email || '').trim();

        console.log('🔁 Reset-password request:', identifier);

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

        console.log('✅ Password reset successfully for user ID:', user.user_id);

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

// ===============================
// PROFILE ROUTES
// ===============================
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

// ===============================
// IMAGE UPLOAD ROUTES
// ===============================
router.post('/upload-profile-picture', verifyToken, upload.single('image'), async (req, res) => {
    try {
        console.log('📸 Profile picture upload for user ID:', req.userId);

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/profiles/${req.file.filename}`;

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

router.post('/upload-banner', verifyToken, upload.single('image'), async (req, res) => {
    try {
        console.log('🖼️ Banner upload for user ID:', req.userId);

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file provided'
            });
        }

        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/banners/${req.file.filename}`;

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

// ===============================
// DELETE ACCOUNT (required by Google Play Data Deletion Policy)
// ===============================
router.delete('/account', verifyToken, async (req, res) => {
    try {
        const userId = req.userId;
        console.log('🗑️ Account deletion request for user ID:', userId);

        // Fetch user profile and image paths before deletion
        const [users] = await db.query(
            'SELECT profile_image_url, banner_image_url FROM users WHERE user_id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Delete related data in dependency order
        await db.query('DELETE FROM tournament_registrations WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM team_members WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM inbox_messages WHERE sender_id = ? OR receiver_id = ?', [userId, userId]);

        // Delete user record
        await db.query('DELETE FROM users WHERE user_id = ?', [userId]);

        console.log('✅ User account and all associated data deleted for ID:', userId);

        // Best-effort: delete uploaded image files from filesystem
        const deleteLocalFile = (fileUrl) => {
            try {
                if (!fileUrl) return;
                const relativePath = fileUrl.replace(/^https?:\/\/[^/]+\//, '');
                const fullPath = path.join(__dirname, '..', relativePath);
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                    console.log('🗑️ Deleted file:', fullPath);
                }
            } catch (fileErr) {
                console.warn('⚠️ Could not delete file:', fileErr.message);
            }
        };

        deleteLocalFile(user.profile_image_url);
        deleteLocalFile(user.banner_image_url);

        return res.json({
            success: true,
            message: 'Your account and all associated data have been permanently deleted.',
            data: null
        });

    } catch (error) {
        console.error('❌ Delete account error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during account deletion. Please try again later.',
            error: error.message
        });
    }
});

module.exports = router;
module.exports.verifyToken = verifyToken;