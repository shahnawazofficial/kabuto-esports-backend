// ============================================
// NOTIFICATION CLEANUP SCRIPT
// ============================================
// This script safely cleans all notification history
// while preserving user, tournament, and auth data
// ============================================

const db = require('./config/database');

async function cleanupNotifications() {
    try {
        console.log('🧹 Starting notification cleanup...\n');

        // Disable foreign key checks temporarily
        await db.query('SET FOREIGN_KEY_CHECKS = 0');

        // Get counts BEFORE cleanup
        console.log('========== BEFORE CLEANUP ==========');
        const [logsBefore] = await db.query('SELECT COUNT(*) as count FROM admin_notification_logs');
        const [notifsBefore] = await db.query('SELECT COUNT(*) as count FROM admin_notifications');
        console.log(`📊 Notification logs: ${logsBefore[0].count}`);
        console.log(`📊 Notifications: ${notifsBefore[0].count}\n`);

        // Truncate tables
        console.log('🗑️  Truncating tables...');
        await db.query('TRUNCATE TABLE admin_notification_logs');
        await db.query('TRUNCATE TABLE admin_notifications');
        console.log('✅ Tables truncated\n');

        // Re-enable foreign key checks
        await db.query('SET FOREIGN_KEY_CHECKS = 1');

        // Get counts AFTER cleanup
        console.log('========== AFTER CLEANUP ==========');
        const [logsAfter] = await db.query('SELECT COUNT(*) as count FROM admin_notification_logs');
        const [notifsAfter] = await db.query('SELECT COUNT(*) as count FROM admin_notifications');
        console.log(`📊 Notification logs: ${logsAfter[0].count}`);
        console.log(`📊 Notifications: ${notifsAfter[0].count}\n`);

        console.log('✅ Cleanup completed successfully!');
        console.log('🎉 All notification history has been removed');
        console.log('💡 Users, tournaments, and auth data remain intact\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        console.error('Stack trace:', error);
        process.exit(1);
    }
}

// Run the cleanup
cleanupNotifications();
