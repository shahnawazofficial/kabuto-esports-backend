// ============================================
// INBOX ROUTES
// ============================================
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// ============================================
// GET USER INBOX MESSAGES
// ============================================
router.get('/user/:userId', auth, async (req, res) => {
    try {
        const userId = req.params.userId;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        // Verify user is requesting their own inbox
        if (req.user.user_id !== parseInt(userId)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

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

        const [notifications] = await db.query(query, [userId, limit, offset]);

        // Get unread count
        const [unreadCount] = await db.query(
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
        console.error('Get inbox messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inbox messages'
        });
    }
});

// ============================================
// MARK MESSAGE AS READ
// ============================================
router.post('/mark-read/:messageId', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const messageId = req.params.messageId;

        await db.query(
            `UPDATE admin_notification_logs 
             SET read_at = CURRENT_TIMESTAMP 
             WHERE notification_id = ? AND user_id = ? AND read_at IS NULL`,
            [messageId, userId]
        );

        res.json({
            success: true,
            message: 'Message marked as read'
        });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark message as read'
        });
    }
});

// ============================================
// MARK ALL MESSAGES AS READ
// ============================================
router.post('/mark-all-read', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;

        await db.query(
            `UPDATE admin_notification_logs 
             SET read_at = CURRENT_TIMESTAMP 
             WHERE user_id = ? AND read_at IS NULL`,
            [userId]
        );

        res.json({
            success: true,
            message: 'All messages marked as read'
        });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark all messages as read'
        });
    }
});

// ============================================
// DELETE MESSAGE
// ============================================
router.delete('/:messageId', auth, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const messageId = req.params.messageId;

        await db.query(
            `DELETE FROM admin_notification_logs 
             WHERE notification_id = ? AND user_id = ?`,
            [messageId, userId]
        );

        res.json({
            success: true,
            message: 'Message deleted successfully'
        });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete message'
        });
    }
});

module.exports = router;
