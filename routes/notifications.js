// ============================================
// NOTIFICATION ROUTES
// ============================================
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const auth = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const {
    sendNotificationToUser,
    sendNotificationToMultipleUsers,
    sendNotificationToTopic
} = require('../config/firebase');

const JWT_SECRET = process.env.JWT_SECRET || 'kabuto_admin_secret_key_2024';

// ============================================
// ADMIN AUTH MIDDLEWARE (For Admins Table)
// ============================================
const adminAuth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token, authorization denied'
            });
        }
        
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        
        console.log('🔐 Admin Auth - Decoded token:', decoded);
        
        // Check if this is an admin token (has admin_id)
        if (!decoded.admin_id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin token required.'
            });
        }
        
        // Check if admin exists in admins table
        const [admins] = await pool.query(
            'SELECT * FROM admins WHERE admin_id = ? AND is_active = true',
            [decoded.admin_id]
        );
        
        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Admin not found or account disabled'
            });
        }
        
        const admin = admins[0];
        
        // Check if super admin (only super admins can send notifications)
        if (admin.admin_role !== 'super') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Super admin privileges required.'
            });
        }
        
        console.log('✅ Super admin verified:', admin.username);
        
        req.admin = admin;
        
        next();
        
    } catch (error) {
        console.error('❌ Admin auth error:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token has expired'
            });
        }
        
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

// ============================================
// USER ROUTES - Save/Update FCM Token
// ============================================

// Save or update user's FCM token
router.post('/token', auth, async (req, res) => {
    try {
        const { fcm_token, device_type = 'android' } = req.body;
        const userId = req.user.user_id;

        if (!fcm_token) {
            return res.status(400).json({
                success: false,
                message: 'FCM token is required'
            });
        }

        // Insert or update FCM token
        const query = `
            INSERT INTO user_fcm_tokens (user_id, fcm_token, device_type)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                fcm_token = VALUES(fcm_token),
                device_type = VALUES(device_type),
                updated_at = CURRENT_TIMESTAMP
        `;

        await pool.query(query, [userId, fcm_token, device_type]);

        res.json({
            success: true,
            message: 'FCM token saved successfully'
        });
    } catch (error) {
        console.error('Save FCM token error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save FCM token'
        });
    }
});

// Get user's notifications
router.get('/user', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const query = `
            SELECT 
                n.notification_id,
                n.notification_type,
                n.title,
                n.message,
                n.deep_link,
                n.tournament_id,
                n.sent_at,
                nl.read_at,
                nl.delivered_at
            FROM admin_notification_logs nl
            JOIN admin_notifications n ON nl.notification_id = n.notification_id
            WHERE nl.user_id = ?
            ORDER BY nl.delivered_at DESC
            LIMIT ? OFFSET ?
        `;

        const [notifications] = await pool.query(query, [userId, limit, offset]);

        // Get unread count
        const [unreadCount] = await pool.query(
            `SELECT COUNT(*) as count FROM admin_notification_logs 
             WHERE user_id = ? AND read_at IS NULL`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                notifications,
                unread_count: unreadCount[0].count,
                total: notifications.length
            }
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications'
        });
    }
});

// Mark notification as read
router.post('/read/:notificationId', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const notificationId = req.params.notificationId;

        await pool.query(
            `UPDATE admin_notification_logs 
             SET read_at = CURRENT_TIMESTAMP 
             WHERE notification_id = ? AND user_id = ? AND read_at IS NULL`,
            [notificationId, userId]
        );

        res.json({
            success: true,
            message: 'Notification marked as read'
        });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read'
        });
    }
});

// Mark all notifications as read
router.post('/read-all', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;

        await pool.query(
            `UPDATE admin_notification_logs 
             SET read_at = CURRENT_TIMESTAMP 
             WHERE user_id = ? AND read_at IS NULL`,
            [userId]
        );

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark all notifications as read'
        });
    }
});

// ============================================
// ADMIN ROUTES - Send Notifications (SUPER ADMIN ONLY)
// ============================================

// Send notification from admin panel
router.post('/admin/send', adminAuth, async (req, res) => {
    try {
        const {
            type,
            title,
            message,
            target_audience,
            specific_users,
            user_identifier_type,
            deep_link,
            tournament_id,
            send_option,
            schedule_time
        } = req.body;

        const adminId = req.admin.admin_id;

        console.log('📤 Sending notification - Admin:', req.admin.username);

        // Validate required fields
        if (!type || !title || !message || !target_audience) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Get target user IDs based on audience
        let targetUserIds = [];
        let query = '';

        switch (target_audience) {
            case 'all':
                query = 'SELECT user_id FROM users WHERE is_active = 1';
                break;

            case 'active':
                query = `SELECT DISTINCT user_id FROM users 
                         WHERE is_active = 1 AND last_login >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
                break;

            case 'inactive':
                query = `SELECT user_id FROM users 
                         WHERE is_active = 1 AND (last_login < DATE_SUB(NOW(), INTERVAL 7 DAY) OR last_login IS NULL)`;
                break;

            case 'low_wallet':
                query = `SELECT user_id FROM wallet WHERE balance < 100`;
                break;

            case 'specific':
                if (!specific_users) {
                    return res.status(400).json({
                        success: false,
                        message: 'Specific user IDs or usernames required'
                    });
                }
                
                // Check if using usernames or user IDs
                if (user_identifier_type === 'username') {
                    // Look up user IDs from usernames
                    const usernames = specific_users.split(',').map(name => name.trim());
                    const [users] = await pool.query(
                        'SELECT user_id FROM users WHERE username IN (?) AND is_active = 1',
                        [usernames]
                    );
                    targetUserIds = users.map(u => u.user_id);
                    
                    if (targetUserIds.length === 0) {
                        return res.status(400).json({
                            success: false,
                            message: 'No active users found with the provided usernames'
                        });
                    }
                    
                    console.log(`🔍 Found ${targetUserIds.length} users from usernames:`, usernames);
                } else {
                    // Parse user IDs and filter out invalid ones
                    targetUserIds = specific_users.split(',')
                        .map(id => parseInt(id.trim()))
                        .filter(id => !isNaN(id) && id > 0);
                    
                    if (targetUserIds.length === 0) {
                        return res.status(400).json({
                            success: false,
                            message: 'Invalid user IDs provided. Please enter numeric user IDs (e.g., 1,2,3)'
                        });
                    }
                }
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid target audience'
                });
        }

        // Execute query if not specific users
        if (target_audience !== 'specific') {
            const [users] = await pool.query(query);
            targetUserIds = users.map(u => u.user_id);
        }

        if (targetUserIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No users found for the selected audience'
            });
        }

        console.log(`🎯 Target users: ${targetUserIds.length}`);

        // Save notification to database
        const [notificationResult] = await pool.query(
            `INSERT INTO admin_notifications 
             (admin_id, notification_type, title, message, target_audience, 
              specific_user_ids, deep_link, tournament_id, send_option, 
              schedule_time, recipients_count, notification_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                type,
                title,
                message,
                target_audience,
                specific_users || null,
                deep_link || null,
                tournament_id || null,
                send_option || 'now',
                schedule_time || null,
                targetUserIds.length,
                send_option === 'schedule' ? 'scheduled' : 'sent'
            ]
        );

        const notificationId = notificationResult.insertId;

        console.log(`✅ Notification saved - ID: ${notificationId}`);

        // If schedule for later, don't send now
        if (send_option === 'schedule') {
            return res.json({
                success: true,
                message: 'Notification scheduled successfully',
                data: {
                    notification_id: notificationId,
                    scheduled_for: schedule_time,
                    recipients_count: targetUserIds.length
                }
            });
        }

        // Get FCM tokens for target users
        const [tokens] = await pool.query(
            `SELECT DISTINCT fcm_token FROM user_fcm_tokens 
             WHERE user_id IN (?) AND fcm_token IS NOT NULL`,
            [targetUserIds]
        );

        const fcmTokens = tokens.map(t => t.fcm_token);

        console.log(`📱 FCM tokens found: ${fcmTokens.length}`);

        if (fcmTokens.length === 0) {
            return res.json({
                success: true,
                message: 'Notification saved but no active devices to send',
                data: {
                    notification_id: notificationId,
                    recipients_count: 0
                }
            });
        }

        // Send notifications via Firebase
        const notificationData = {
            type,
            deep_link: deep_link || '',
            tournament_id: tournament_id || '',
            notification_id: notificationId.toString()
        };

        const result = await sendNotificationToMultipleUsers(
            fcmTokens,
            { title, message },
            notificationData
        );

        // Log successful deliveries
        if (result.success) {
            const logValues = targetUserIds.map(userId => 
                [notificationId, userId]
            );
            
            await pool.query(
                `INSERT INTO admin_notification_logs (notification_id, user_id) VALUES ?`,
                [logValues]
            );
        }

        console.log(`✅ Notification sent - Success: ${result.successCount}, Failed: ${result.failureCount}`);

        res.json({
            success: true,
            message: 'Notification sent successfully',
            data: {
                notification_id: notificationId,
                recipients_count: result.successCount || 0,
                failed_count: result.failureCount || 0
            }
        });

    } catch (error) {
        console.error('Send notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send notification',
            error: error.message
        });
    }
});

// Get notification history for admin
router.get('/admin/history', adminAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const query = `
            SELECT 
                n.*,
                a.username as admin_username
            FROM admin_notifications n
            LEFT JOIN admins a ON n.admin_id = a.admin_id
            ORDER BY n.sent_at DESC
            LIMIT ? OFFSET ?
        `;

        const [notifications] = await pool.query(query, [limit, offset]);

        res.json({
            success: true,
            data: notifications
        });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notification history'
        });
    }
});

// Delete notification (user can delete their own notification logs)
router.delete('/:notificationId', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const notificationId = req.params.notificationId;

        await pool.query(
            `DELETE FROM notification_logs 
             WHERE notification_id = ? AND user_id = ?`,
            [notificationId, userId]
        );

        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification'
        });
    }
});

// Get notification stats for admin
router.get('/admin/stats', adminAuth, async (req, res) => {
    try {
        // Total sent
        const [totalSent] = await pool.query(
            `SELECT COUNT(*) as count FROM admin_notifications WHERE notification_status = 'sent'`
        );

        // Sent today
        const [sentToday] = await pool.query(
            `SELECT COUNT(*) as count FROM admin_notifications 
             WHERE notification_status = 'sent' AND DATE(sent_at) = CURDATE()`
        );

        // Active users (with FCM tokens)
        const [activeUsers] = await pool.query(
            `SELECT COUNT(DISTINCT user_id) as count FROM user_fcm_tokens`
        );

        res.json({
            success: true,
            data: {
                total_sent: totalSent[0].count,
                sent_today: sentToday[0].count,
                active_users: activeUsers[0].count
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notification stats'
        });
    }
});

module.exports = router;