// ============================================
// FIREBASE ADMIN SDK CONFIGURATION
// ============================================

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccount = require(path.join(__dirname, '..', 'firebase-service-account.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Get Firebase Messaging instance
const messaging = admin.messaging();

// ============================================
// SEND NOTIFICATION TO SINGLE USER
// ============================================
const sendNotificationToUser = async (fcmToken, notification, data = {}) => {
    try {
        const message = {
            token: fcmToken,
            notification: {
                title: notification.title,
                body: notification.message
            },
            data: {
                type: data.type || 'general',
                deep_link: data.deep_link || '',
                tournament_id: data.tournament_id?.toString() || '',
                notification_id: data.notification_id?.toString() || '',
                ...data
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'kabuto_notifications',
                    color: '#6c5ce7',
                    icon: 'ic_notification'
                }
            }
        };

        const response = await messaging.send(message);
        console.log('✅ Notification sent successfully:', response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('❌ Error sending notification:', error);
        return { success: false, error: error.message };
    }
};

// ============================================
// SEND NOTIFICATION TO MULTIPLE USERS
// ============================================
const sendNotificationToMultipleUsers = async (fcmTokens, notification, data = {}) => {
    try {
        // Remove invalid tokens and duplicates
        const validTokens = [...new Set(fcmTokens.filter(token => token && token.length > 0))];

        if (validTokens.length === 0) {
            return { success: false, error: 'No valid tokens provided' };
        }

        const message = {
            notification: {
                title: notification.title,
                body: notification.message
            },
            data: {
                type: data.type || 'general',
                deep_link: data.deep_link || '',
                tournament_id: data.tournament_id?.toString() || '',
                notification_id: data.notification_id?.toString() || '',
                ...data
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'kabuto_notifications',
                    color: '#6c5ce7',
                    icon: 'ic_notification'
                }
            },
            tokens: validTokens
        };

        const response = await messaging.sendEachForMulticast(message);
        
        console.log('✅ Multicast notification sent:');
        console.log(`   Success: ${response.successCount}/${validTokens.length}`);
        console.log(`   Failed: ${response.failureCount}`);

        // Log failed tokens for cleanup
        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.log(`   ❌ Failed token: ${validTokens[idx].substring(0, 20)}...`);
                }
            });
        }

        return {
            success: true,
            successCount: response.successCount,
            failureCount: response.failureCount,
            responses: response.responses
        };
    } catch (error) {
        console.error('❌ Error sending multicast notification:', error);
        return { success: false, error: error.message };
    }
};

// ============================================
// SEND NOTIFICATION TO TOPIC
// ============================================
const sendNotificationToTopic = async (topic, notification, data = {}) => {
    try {
        const message = {
            topic: topic,
            notification: {
                title: notification.title,
                body: notification.message
            },
            data: {
                type: data.type || 'general',
                deep_link: data.deep_link || '',
                tournament_id: data.tournament_id?.toString() || '',
                ...data
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'kabuto_notifications',
                    color: '#6c5ce7'
                }
            }
        };

        const response = await messaging.send(message);
        console.log('✅ Topic notification sent successfully:', response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('❌ Error sending topic notification:', error);
        return { success: false, error: error.message };
    }
};

// ============================================
// SUBSCRIBE USER TO TOPIC
// ============================================
const subscribeToTopic = async (fcmTokens, topic) => {
    try {
        const response = await messaging.subscribeToTopic(fcmTokens, topic);
        console.log(`✅ Subscribed to topic ${topic}:`, response);
        return { success: true, response };
    } catch (error) {
        console.error('❌ Error subscribing to topic:', error);
        return { success: false, error: error.message };
    }
};

// ============================================
// UNSUBSCRIBE USER FROM TOPIC
// ============================================
const unsubscribeFromTopic = async (fcmTokens, topic) => {
    try {
        const response = await messaging.unsubscribeFromTopic(fcmTokens, topic);
        console.log(`✅ Unsubscribed from topic ${topic}:`, response);
        return { success: true, response };
    } catch (error) {
        console.error('❌ Error unsubscribing from topic:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    admin,
    messaging,
    sendNotificationToUser,
    sendNotificationToMultipleUsers,
    sendNotificationToTopic,
    subscribeToTopic,
    unsubscribeFromTopic
}; 