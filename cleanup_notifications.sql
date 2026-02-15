-- ============================================
-- NOTIFICATION & INBOX HISTORY CLEANUP SCRIPT
-- ============================================
-- WARNING: This will permanently delete ALL notification history
-- ============================================

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- Display counts BEFORE cleanup
SELECT '========== BEFORE CLEANUP ==========' as status;
SELECT COUNT(*) as notification_logs_count FROM admin_notification_logs;
SELECT COUNT(*) as notifications_count FROM admin_notifications;

-- Truncate all notification tables
TRUNCATE TABLE admin_notification_logs;
TRUNCATE TABLE admin_notifications;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- Display counts AFTER cleanup
SELECT '========== AFTER CLEANUP ==========' as status;
SELECT COUNT(*) as notification_logs_count FROM admin_notification_logs;
SELECT COUNT(*) as notifications_count FROM admin_notifications;

SELECT '✅ Cleanup completed successfully!' as result;
