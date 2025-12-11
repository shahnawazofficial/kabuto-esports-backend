// ============================================
// NOTIFICATION ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { verifyAdminToken } = require('../middleware/adminAuth');
const {
    sendNotificationToUser,
    sendNotificationToMultipleUsers,
    sendNotificationToTopic
} = require('../config/firebase');

// ============================================
// USER ROUTES - Save/Update FCM Token
// ============================================

// Save or update user's FCM token
router.post('/token', verifyToken, async (req, res) => {
    try {
        const { fcm_token, device_type = 'android' } = req.body;
        const userId = req.user.userId;

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

        await db.query(query, [userId, fcm_token, device_type]);

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
router.get('/user', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
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
            FROM notification_logs nl
            JOIN notifications n ON nl.notification_id = n.notification_id
            WHERE nl.user_id = ?
            ORDER BY nl.delivered_at DESC
            LIMIT ? OFFSET ?
        `;

        const [notifications] = await db.query(query, [userId, limit, offset]);

        // Get unread count
        const [unreadCount] = await db.query(
            `SELECT COUNT(*) as count FROM notification_logs 
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
router.post('/read/:notificationId', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const notificationId = req.params.notificationId;

        await db.query(
            `UPDATE notification_logs 
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
router.post('/read-all', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        await db.query(
            `UPDATE notification_logs 
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
// ADMIN ROUTES - Send Notifications
// ============================================

// Send notification from admin panel
router.post('/admin/send', verifyAdminToken, async (req, res) => {
    try {
        const {
            type,
            title,
            message,
            target_audience,
            specific_users,
            deep_link,
            tournament_id,
            send_option,
            schedule_time
        } = req.body;

        const adminId = req.admin.admin_id;

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
                        message: 'Specific user IDs required'
                    });
                }
                targetUserIds = specific_users.split(',').map(id => parseInt(id.trim()));
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid target audience'
                });
        }

        // Execute query if not specific users
        if (target_audience !== 'specific') {
            const [users] = await db.query(query);
            targetUserIds = users.map(u => u.user_id);
        }

        if (targetUserIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No users found for the selected audience'
            });
        }

        // Save notification to database
        const [notificationResult] = await db.query(
            `INSERT INTO notifications 
             (admin_id, notification_type, title, message, target_audience, 
              specific_user_ids, deep_link, tournament_id, send_option, 
              schedule_time, recipients_count, status)
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
        const [tokens] = await db.query(
            `SELECT DISTINCT fcm_token FROM user_fcm_tokens 
             WHERE user_id IN (?) AND fcm_token IS NOT NULL`,
            [targetUserIds]
        );

        const fcmTokens = tokens.map(t => t.fcm_token);

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

            await db.query(
                `INSERT INTO notification_logs (notification_id, user_id) VALUES ?`,
                [logValues]
            );
        }

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
router.get('/admin/history', verifyAdminToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const query = `
            SELECT 
                n.*,
                a.username as admin_username
            FROM notifications n
            LEFT JOIN admins a ON n.admin_id = a.admin_id
            ORDER BY n.sent_at DESC
            LIMIT ? OFFSET ?
        `;

        const [notifications] = await db.query(query, [limit, offset]);

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

// Get notification stats for admin
router.get('/admin/stats', verifyAdminToken, async (req, res) => {
    try {
        // Total sent
        const [totalSent] = await db.query(
            `SELECT COUNT(*) as count FROM notifications WHERE status = 'sent'`
        );

        // Sent today
        const [sentToday] = await db.query(
            `SELECT COUNT(*) as count FROM notifications 
             WHERE status = 'sent' AND DATE(sent_at) = CURDATE()`
        );

        // Active users (with FCM tokens)
        const [activeUsers] = await db.query(
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