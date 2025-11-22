// ============================================
// DATABASE CONNECTION CONFIGURATION
// ============================================

const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'kabuto123',
    database: process.env.DB_NAME || 'kabuto_esports',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
        process.exit(1);
    }
    
    console.log('✅ Database connected successfully!');
    console.log(`📊 Database: ${process.env.DB_NAME || 'kabuto_esports'}`);
    
    connection.release();
});

const promisePool = pool.promise();

module.exports = promisePool;