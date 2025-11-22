// ============================================
// DATABASE CONNECTION CONFIGURATION
// ============================================

const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,  // ← ADD THIS LINE!
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'kabuto123',
    database: process.env.DB_NAME || 'kabuto_esports',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 60000  // ← ADD THIS: 60 second timeout
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        console.error('Connection details:', {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            database: process.env.DB_NAME
        });
        // Don't exit on Render - let it retry
        return;
    }
    
    console.log('✅ Database connected successfully!');
    console.log(`📊 Database: ${process.env.DB_NAME || 'kabuto_esports'}`);
    console.log(`🌐 Host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    
    connection.release();
});

const promisePool = pool.promise();

module.exports = promisePool;