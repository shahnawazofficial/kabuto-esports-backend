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

// ==========================================
// USER MANAGEMENT
// ==========================================

// Get All Users (with search and pagination)
router.get('/users', verifyAdminToken, async (req, res) => {
    try {
        const search = req.query.search || '';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        let query = `
            SELECT 
                u.user_id,
                u.username,
                u.full_name,
                u.email,
                u.phone,
                u.created_at,
                u.is_active,
                w.balance as wallet_balance,
                (SELECT COUNT(*) FROM tournament_registrations WHERE user_id = u.user_id) as total_registrations
            FROM users u
            LEFT JOIN wallet w ON u.user_id = w.user_id
            WHERE 1=1
        `;

        const params = [];

        if (search) {
            query += ` AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        query += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [users] = await db.query(query, params);

        // Get total count
        let countQuery = `SELECT COUNT(*) as total FROM users WHERE 1=1`;
        const countParams = [];

        if (search) {
            countQuery += ` AND (username LIKE ? OR full_name LIKE ? OR email LIKE ? OR phone LIKE ?)`;
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        const [countResult] = await db.query(countQuery, countParams);

        res.json({
            success: true,
            data: users,
            total: countResult[0].total,
            limit,
            offset
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching users',
            error: error.message
        });
    }
});

// Get User Details
router.get('/users/:userId', verifyAdminToken, async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get user info
        const [users] = await db.query(
            `SELECT 
                u.*,
                w.balance as wallet_balance
             FROM users u
             LEFT JOIN wallet w ON u.user_id = w.user_id
             WHERE u.user_id = ?`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get user's tournaments
        const [tournaments] = await db.query(
            `SELECT 
                tr.*,
                t.tournament_name,
                t.tournament_status
             FROM tournament_registrations tr
             JOIN tournaments t ON tr.tournament_id = t.tournament_id
             WHERE tr.user_id = ?
             ORDER BY tr.registered_at DESC`,
            [userId]
        );

        // Get user's transactions
        const [transactions] = await db.query(
            `SELECT * FROM wallet_transactions 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 20`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                user: users[0],
                tournaments,
                transactions
            }
        });

    } catch (error) {
        console.error('Get user details error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user details',
            error: error.message
        });
    }
});

// Block/Unblock User
router.post('/users/:userId/toggle-active', verifyAdminToken, async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get current status
        const [users] = await db.query(
            'SELECT is_active FROM users WHERE user_id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const newStatus = !users[0].is_active;

        // Update status
        await db.query(
            'UPDATE users SET is_active = ? WHERE user_id = ?',
            [newStatus, userId]
        );

        console.log(`✅ User ${userId} ${newStatus ? 'activated' : 'blocked'} by admin ${req.admin.admin_id}`);

        res.json({
            success: true,
            message: `User ${newStatus ? 'activated' : 'blocked'} successfully`,
            data: { is_active: newStatus }
        });

    } catch (error) {
        console.error('Toggle user active error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating user status',
            error: error.message
        });
    }
});

// Add Money to User Wallet (Super Admin Only)
router.post('/users/:userId/add-money', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const userId = req.params.userId;
        const { amount, description } = req.body;

        if (!amount || amount <= 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }

        await connection.beginTransaction();

        // Get current balance
        const [wallets] = await connection.query(
            'SELECT balance FROM wallet WHERE user_id = ?',
            [userId]
        );

        if (wallets.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }

        const balanceBefore = parseFloat(wallets[0].balance);
        const newBalance = balanceBefore + parseFloat(amount);

        // Update wallet
        await connection.query(
            'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
            [newBalance, userId]
        );

        // Record transaction
        await connection.query(
            `INSERT INTO wallet_transactions 
             (user_id, transaction_type, amount, balance_before, balance_after, 
              status, payment_method, description)
             VALUES (?, 'deposit', ?, ?, ?, 'completed', 'admin', ?)`,
            [userId, amount, balanceBefore, newBalance, description || 'Admin credit']
        );

        await connection.commit();
        connection.release();

        console.log(`✅ Admin ${req.admin.admin_id} added ₹${amount} to user ${userId}`);

        res.json({
            success: true,
            message: 'Money added successfully',
            data: {
                old_balance: balanceBefore,
                new_balance: newBalance,
                amount_added: amount
            }
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Add money error:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding money',
            error: error.message
        });
    }
});

// ==========================================
// TOURNAMENT MANAGEMENT
// ==========================================

// Get All Tournaments (with filters)
router.get('/tournaments', verifyAdminToken, async (req, res) => {
    try {
        const status = req.query.status || '';
        const search = req.query.search || '';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        let query = `
            SELECT 
                t.*,
                u.username as host_username,
                u.full_name as host_name,
                (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.tournament_id) as total_registrations
            FROM tournaments t
            LEFT JOIN users u ON t.host_user_id = u.user_id
            WHERE 1=1
        `;

        const params = [];

        if (status) {
            query += ` AND t.tournament_status = ?`;
            params.push(status);
        }

        if (search) {
            query += ` AND (t.tournament_name LIKE ? OR t.tournament_description LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }

        query += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [tournaments] = await db.query(query, params);

        // Get total count
        let countQuery = `SELECT COUNT(*) as total FROM tournaments WHERE 1=1`;
        const countParams = [];

        if (status) {
            countQuery += ` AND tournament_status = ?`;
            countParams.push(status);
        }

        if (search) {
            countQuery += ` AND (tournament_name LIKE ? OR tournament_description LIKE ?)`;
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm);
        }

        const [countResult] = await db.query(countQuery, countParams);

        res.json({
            success: true,
            data: tournaments,
            total: countResult[0].total,
            limit,
            offset
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

// Get Tournament Registrations
router.get('/tournaments/:tournamentId/registrations', verifyAdminToken, async (req, res) => {
    try {
        const tournamentId = req.params.tournamentId;

        const [registrations] = await db.query(
            `SELECT 
                tr.*,
                u.username,
                u.full_name,
                u.email,
                u.phone
             FROM tournament_registrations tr
             JOIN users u ON tr.user_id = u.user_id
             WHERE tr.tournament_id = ?
             ORDER BY tr.registered_at DESC`,
            [tournamentId]
        );

        // Parse player_details JSON
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

// Create New Tournament
router.post('/tournaments', verifyAdminToken, async (req, res) => {
    try {
        const {
            tournament_name,
            tournament_description,
            game_mode,
            max_participants,
            registration_fee,
            registration_start,
            registration_end,
            tournament_start_time,
            map_name,
            perspective
        } = req.body;

        const [result] = await db.query(
            `INSERT INTO tournaments (
                tournament_name, tournament_description, host_user_id, game_mode,
                max_participants, registration_fee, registration_start, registration_end,
                tournament_start_time, tournament_status, map_name, perspective, current_participants
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'registration_open', ?, ?, 0)`,
            [
                tournament_name,
                tournament_description,
                1, // Default host user ID (you can change this)
                game_mode,
                max_participants,
                registration_fee,
                registration_start,
                registration_end,
                tournament_start_time,
                map_name,
                perspective
            ]
        );

        console.log(`✅ Tournament created by admin ${req.admin.admin_id}: ${tournament_name}`);

        res.json({
            success: true,
            message: 'Tournament created successfully',
            data: {
                tournament_id: result.insertId
            }
        });

    } catch (error) {
        console.error('Create tournament error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating tournament',
            error: error.message
        });
    }
});

// Update Tournament
router.put('/tournaments/:tournamentId', verifyAdminToken, async (req, res) => {
    try {
        const tournamentId = req.params.tournamentId;
        const updates = req.body;

        // Build dynamic update query
        const allowedFields = [
            'tournament_name', 'tournament_description', 'game_mode',
            'max_participants', 'registration_fee', 'registration_start',
            'registration_end', 'tournament_start_time', 'map_name',
            'perspective', 'tournament_status'
        ];

        const updateFields = [];
        const params = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                params.push(value);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        params.push(tournamentId);

        await db.query(
            `UPDATE tournaments SET ${updateFields.join(', ')} WHERE tournament_id = ?`,
            params
        );

        console.log(`✅ Tournament ${tournamentId} updated by admin ${req.admin.admin_id}`);

        res.json({
            success: true,
            message: 'Tournament updated successfully'
        });

    } catch (error) {
        console.error('Update tournament error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating tournament',
            error: error.message
        });
    }
});

// Add/Update Room Details
router.post('/tournaments/:tournamentId/room', verifyAdminToken, async (req, res) => {
    try {
        const tournamentId = req.params.tournamentId;
        const { room_id, room_password } = req.body;

        await db.query(
            `UPDATE tournaments 
             SET room_id = ?, room_password = ? 
             WHERE tournament_id = ?`,
            [room_id, room_password, tournamentId]
        );

        console.log(`✅ Room details added to tournament ${tournamentId} by admin ${req.admin.admin_id}`);

        res.json({
            success: true,
            message: 'Room details updated successfully'
        });

    } catch (error) {
        console.error('Update room details error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating room details',
            error: error.message
        });
    }
});

// Update Tournament Status
router.post('/tournaments/:tournamentId/status', verifyAdminToken, async (req, res) => {
    try {
        const tournamentId = req.params.tournamentId;
        const { status } = req.body;

        const validStatuses = ['registration_open', 'registration_closed', 'ongoing', 'completed', 'cancelled'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        await db.query(
            `UPDATE tournaments SET tournament_status = ? WHERE tournament_id = ?`,
            [status, tournamentId]
        );

        console.log(`✅ Tournament ${tournamentId} status changed to ${status} by admin ${req.admin.admin_id}`);

        res.json({
            success: true,
            message: 'Tournament status updated successfully'
        });

    } catch (error) {
        console.error('Update tournament status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating tournament status',
            error: error.message
        });
    }
});

// ==========================================
// WALLET MANAGEMENT (Super Admin Only)
// ==========================================

// Get All Wallet Transactions
router.get('/wallet/transactions', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';
        const transactionType = req.query.transaction_type || '';
        const status = req.query.status || '';
        const startDate = req.query.start_date || '';
        const endDate = req.query.end_date || '';
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        let query = `
            SELECT 
                wt.*,
                u.username,
                u.full_name,
                u.email
            FROM wallet_transactions wt
            JOIN users u ON wt.user_id = u.user_id
            WHERE 1=1
        `;

        const params = [];

        if (search) {
            query += ` AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        if (transactionType) {
            query += ` AND wt.transaction_type = ?`;
            params.push(transactionType);
        }

        if (status) {
            query += ` AND wt.status = ?`;
            params.push(status);
        }

        if (startDate) {
            query += ` AND DATE(wt.created_at) >= ?`;
            params.push(startDate);
        }

        if (endDate) {
            query += ` AND DATE(wt.created_at) <= ?`;
            params.push(endDate);
        }

        query += ` ORDER BY wt.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [transactions] = await db.query(query, params);

        // Get total count
        let countQuery = `
            SELECT COUNT(*) as total 
            FROM wallet_transactions wt
            JOIN users u ON wt.user_id = u.user_id
            WHERE 1=1
        `;
        const countParams = [];

        if (search) {
            countQuery += ` AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)`;
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm);
        }

        if (transactionType) {
            countQuery += ` AND wt.transaction_type = ?`;
            countParams.push(transactionType);
        }

        if (status) {
            countQuery += ` AND wt.status = ?`;
            countParams.push(status);
        }

        if (startDate) {
            countQuery += ` AND DATE(wt.created_at) >= ?`;
            countParams.push(startDate);
        }

        if (endDate) {
            countQuery += ` AND DATE(wt.created_at) <= ?`;
            countParams.push(endDate);
        }

        const [countResult] = await db.query(countQuery, countParams);

        res.json({
            success: true,
            data: transactions,
            total: countResult[0].total,
            limit,
            offset
        });

    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching transactions',
            error: error.message
        });
    }
});

// Get Wallet Statistics
router.get('/wallet/stats', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        // Total wallet balance across all users
        const [totalBalance] = await db.query(
            'SELECT COALESCE(SUM(balance), 0) as total FROM wallet'
        );

        // Total deposits
        const [totalDeposits] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'deposit' AND status = 'completed'`
        );

        // Total withdrawals
        const [totalWithdrawals] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'withdrawal' AND status = 'completed'`
        );

        // Total tournament entries revenue
        const [totalRevenue] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'tournament_entry' AND status = 'completed'`
        );

        // Total refunds
        const [totalRefunds] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'refund' AND status = 'completed'`
        );

        // Pending transactions
        const [pendingTransactions] = await db.query(
            `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
             FROM wallet_transactions 
             WHERE status = 'pending'`
        );

        // Today's revenue
        const [todayRevenue] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'tournament_entry' 
             AND status = 'completed'
             AND DATE(created_at) = CURDATE()`
        );

        // This month's revenue
        const [monthRevenue] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM wallet_transactions 
             WHERE transaction_type = 'tournament_entry' 
             AND status = 'completed'
             AND YEAR(created_at) = YEAR(CURDATE())
             AND MONTH(created_at) = MONTH(CURDATE())`
        );

        res.json({
            success: true,
            data: {
                totalWalletBalance: totalBalance[0].total,
                totalDeposits: totalDeposits[0].total,
                totalWithdrawals: totalWithdrawals[0].total,
                totalRevenue: totalRevenue[0].total,
                totalRefunds: totalRefunds[0].total,
                pendingTransactions: {
                    count: pendingTransactions[0].count,
                    amount: pendingTransactions[0].total
                },
                todayRevenue: todayRevenue[0].total,
                monthRevenue: monthRevenue[0].total
            }
        });

    } catch (error) {
        console.error('Get wallet stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching wallet statistics',
            error: error.message
        });
    }
});

// Manual Refund (Super Admin Only)
router.post('/wallet/refund', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { user_id, amount, description } = req.body;

        if (!amount || amount <= 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }

        await connection.beginTransaction();

        // Get current balance
        const [wallets] = await connection.query(
            'SELECT balance FROM wallet WHERE user_id = ?',
            [user_id]
        );

        if (wallets.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }

        const balanceBefore = parseFloat(wallets[0].balance);
        const newBalance = balanceBefore + parseFloat(amount);

        // Update wallet
        await connection.query(
            'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
            [newBalance, user_id]
        );

        // Record transaction
        await connection.query(
            `INSERT INTO wallet_transactions 
             (user_id, transaction_type, amount, balance_before, balance_after, 
              status, payment_method, description)
             VALUES (?, 'refund', ?, ?, ?, 'completed', 'admin', ?)`,
            [user_id, amount, balanceBefore, newBalance, description || 'Admin refund']
        );

        await connection.commit();
        connection.release();

        console.log(`✅ Admin ${req.admin.admin_id} refunded ₹${amount} to user ${user_id}`);

        res.json({
            success: true,
            message: 'Refund processed successfully',
            data: {
                old_balance: balanceBefore,
                new_balance: newBalance,
                refund_amount: amount
            }
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Refund error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing refund',
            error: error.message
        });
    }
});

// Deduct Money from Wallet (Super Admin Only)
router.post('/wallet/deduct', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { user_id, amount, description } = req.body;

        if (!amount || amount <= 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Invalid amount'
            });
        }

        await connection.beginTransaction();

        // Get current balance
        const [wallets] = await connection.query(
            'SELECT balance FROM wallet WHERE user_id = ?',
            [user_id]
        );

        if (wallets.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }

        const balanceBefore = parseFloat(wallets[0].balance);

        if (balanceBefore < parseFloat(amount)) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance'
            });
        }

        const newBalance = balanceBefore - parseFloat(amount);

        // Update wallet
        await connection.query(
            'UPDATE wallet SET balance = ?, updated_at = NOW() WHERE user_id = ?',
            [newBalance, user_id]
        );

        // Record transaction
        await connection.query(
            `INSERT INTO wallet_transactions 
             (user_id, transaction_type, amount, balance_before, balance_after, 
              status, payment_method, description)
             VALUES (?, 'withdrawal', ?, ?, ?, 'completed', 'admin', ?)`,
            [user_id, amount, balanceBefore, newBalance, description || 'Admin deduction']
        );

        await connection.commit();
        connection.release();

        console.log(`✅ Admin ${req.admin.admin_id} deducted ₹${amount} from user ${user_id}`);

        res.json({
            success: true,
            message: 'Amount deducted successfully',
            data: {
                old_balance: balanceBefore,
                new_balance: newBalance,
                deducted_amount: amount
            }
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Deduct money error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deducting money',
            error: error.message
        });
    }
});

// ==========================================
// ADMIN MANAGEMENT (Super Admin Only)
// ==========================================

// Get All Admins
router.get('/admins', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        const [admins] = await db.query(
            `SELECT 
                a.admin_id,
                a.username,
                a.email,
                a.full_name,
                a.admin_role,
                a.is_active,
                a.created_at,
                a.last_login,
                creator.username as created_by_username
             FROM admins a
             LEFT JOIN admins creator ON a.created_by = creator.admin_id
             ORDER BY a.created_at DESC`
        );

        res.json({
            success: true,
            data: admins
        });

    } catch (error) {
        console.error('Get admins error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching admins',
            error: error.message
        });
    }
});

// Create Secondary Admin
router.post('/admins', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        const { username, email, password, full_name } = req.body;

        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username, email, and password are required'
            });
        }

        // Check if username already exists
        const [existingUsername] = await db.query(
            'SELECT admin_id FROM admins WHERE username = ?',
            [username]
        );

        if (existingUsername.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }

        // Check if email already exists
        const [existingEmail] = await db.query(
            'SELECT admin_id FROM admins WHERE email = ?',
            [email]
        );

        if (existingEmail.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create admin
        const [result] = await db.query(
            `INSERT INTO admins 
             (username, email, password, full_name, admin_role, is_active, created_by)
             VALUES (?, ?, ?, ?, 'secondary', true, ?)`,
            [username, email, hashedPassword, full_name || null, req.admin.admin_id]
        );

        console.log(`✅ Super Admin ${req.admin.admin_id} created secondary admin: ${username}`);

        res.json({
            success: true,
            message: 'Secondary admin created successfully',
            data: {
                admin_id: result.insertId,
                username,
                email,
                admin_role: 'secondary'
            }
        });

    } catch (error) {
        console.error('Create admin error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating admin',
            error: error.message
        });
    }
});

// Toggle Admin Active Status
router.post('/admins/:adminId/toggle-active', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        const adminId = req.params.adminId;

        // Prevent super admin from disabling themselves
        if (adminId == req.admin.admin_id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot disable your own account'
            });
        }

        // Get current status
        const [admins] = await db.query(
            'SELECT is_active, admin_role FROM admins WHERE admin_id = ?',
            [adminId]
        );

        if (admins.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        // Prevent disabling other super admins
        if (admins[0].admin_role === 'super') {
            return res.status(400).json({
                success: false,
                message: 'Cannot disable super admin accounts'
            });
        }

        const newStatus = !admins[0].is_active;

        // Update status
        await db.query(
            'UPDATE admins SET is_active = ? WHERE admin_id = ?',
            [newStatus, adminId]
        );

        console.log(`✅ Super Admin ${req.admin.admin_id} ${newStatus ? 'activated' : 'deactivated'} admin ${adminId}`);

        res.json({
            success: true,
            message: `Admin ${newStatus ? 'activated' : 'deactivated'} successfully`,
            data: { is_active: newStatus }
        });

    } catch (error) {
        console.error('Toggle admin active error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating admin status',
            error: error.message
        });
    }
});

// Delete Admin
router.delete('/admins/:adminId', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        const adminId = req.params.adminId;

        // Prevent super admin from deleting themselves
        if (adminId == req.admin.admin_id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account'
            });
        }

        // Check admin exists and role
        const [admins] = await db.query(
            'SELECT admin_role FROM admins WHERE admin_id = ?',
            [adminId]
        );

        if (admins.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        // Prevent deleting other super admins
        if (admins[0].admin_role === 'super') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete super admin accounts'
            });
        }

        // Delete admin
        await db.query('DELETE FROM admins WHERE admin_id = ?', [adminId]);

        console.log(`✅ Super Admin ${req.admin.admin_id} deleted admin ${adminId}`);

        res.json({
            success: true,
            message: 'Admin deleted successfully'
        });

    } catch (error) {
        console.error('Delete admin error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting admin',
            error: error.message
        });
    }
});

// Reset Admin Password
router.post('/admins/:adminId/reset-password', verifyAdminToken, verifySuperAdmin, async (req, res) => {
    try {
        const adminId = req.params.adminId;
        const { new_password } = req.body;

        if (!new_password || new_password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        // Check admin exists
        const [admins] = await db.query(
            'SELECT admin_role FROM admins WHERE admin_id = ?',
            [adminId]
        );

        if (admins.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update password
        await db.query(
            'UPDATE admins SET password = ? WHERE admin_id = ?',
            [hashedPassword, adminId]
        );

        console.log(`✅ Super Admin ${req.admin.admin_id} reset password for admin ${adminId}`);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Error resetting password',
            error: error.message
        });
    }
});

// ==========================================
// ADMIN INBOX - Send Messages to Users
// ==========================================

// Send message from admin inbox to specific users
router.post('/inbox/send', verifyAdminToken, async (req, res) => {
    try {
        const {
            title,
            message,
            user_id,
            event_id,
            room_id,
            room_password,
            match_time,
            is_broadcast
        } = req.body;

        const adminId = req.admin.admin_id;

        console.log('📤 Sending inbox message - Admin:', req.admin.username);
        console.log('📦 Request body:', { title, message, user_id, event_id, is_broadcast });

        // Validate required fields
        if (!title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Title and message are required'
            });
        }

        // Validate broadcast vs specific user
        if (!is_broadcast && !user_id) {
            return res.status(400).json({
                success: false,
                message: 'Either is_broadcast must be true or user_id must be provided'
            });
        }

        // Get target user IDs
        let targetUserIds = [];
        let targetAudience = '';

        if (is_broadcast) {
            // Broadcast to all active users
            const [users] = await db.query('SELECT user_id FROM users WHERE is_active = 1');
            targetUserIds = users.map(u => u.user_id);
            targetAudience = 'all';
            console.log(`📢 Broadcasting to all users: ${targetUserIds.length}`);
        } else {
            // Send to specific user
            targetUserIds = [parseInt(user_id)];
            targetAudience = 'specific';
            console.log(`👤 Sending to specific user: ${user_id}`);
        }

        if (targetUserIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No users found to send message'
            });
        }

        console.log(`🎯 Target users: ${targetUserIds.length}`);

        // Build message content with event details if provided
        let fullMessage = message;
        if (event_id || room_id || match_time) {
            fullMessage += '\n\n';
            if (event_id) fullMessage += `Event ID: ${event_id}\n`;
            if (room_id) fullMessage += `Room ID: ${room_id}\n`;
            if (room_password) fullMessage += `Room Password: ${room_password}\n`;
            if (match_time) fullMessage += `Match Time: ${match_time}\n`;
        }

        // Save notification to database
        const [notificationResult] = await db.query(
            `INSERT INTO admin_notifications 
             (admin_id, notification_type, title, message, target_audience, 
              specific_user_ids, tournament_id, recipients_count, notification_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent')`,
            [
                adminId,
                'general',
                title,
                fullMessage,
                targetAudience,
                user_id ? user_id.toString() : null,
                event_id || null,
                targetUserIds.length
            ]
        );

        const notificationId = notificationResult.insertId;

        // Log deliveries for inbox
        const logValues = targetUserIds.map(userId =>
            [notificationId, userId]
        );

        await db.query(
            `INSERT INTO admin_notification_logs (notification_id, user_id) VALUES ?`,
            [logValues]
        );

        console.log(`✅ Inbox message saved - ID: ${notificationId}, Recipients: ${targetUserIds.length}`);

        res.json({
            success: true,
            message: 'Message sent successfully',
            data: {
                notification_id: notificationId,
                recipients_count: targetUserIds.length
            }
        });

    } catch (error) {
        console.error('Send inbox message error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message',
            error: error.message
        });
    }
});

module.exports = router;