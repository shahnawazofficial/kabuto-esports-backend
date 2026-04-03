// ============================================
// KABUTO ESPORTS - MAIN SERVER FILE
// ============================================

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require("path");   // ← IMPORTANT for serving admin panel


// Load environment variables
dotenv.config();

// Database connection
const db = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const teamRoutes = require('./routes/teams');
const tournamentRoutes = require('./routes/tournaments');
const hostRoutes = require('./routes/host');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');
const inboxRoutes = require('./routes/inbox');

const app = express();

// ============================================
// MIDDLEWARE (MUST BE BEFORE ROUTES!)
// ============================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// SERVE ADMIN PANEL (STATIC HOSTING)
// ============================================

// 👉 This allows accessing admin panel from ANY device
// Example: http://139.59.1.29:3000/admin
app.use(
    "/admin",
    express.static(path.join(__dirname, "admin-panel"))
);

// When user opens /admin, send login page by default
app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "admin-panel", "login.html"));
});

// ============================================
// ROOT ROUTE
// ============================================
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Kabuto Esports API is running!',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ============================================
// API ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/host', hostRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inbox', inboxRoutes);

app.use('/uploads', express.static('uploads'));

// ============================================
// ERROR HANDLING
// ============================================

// 404 Handler - Route not found
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('=================================');
    console.log('🚀 KABUTO ESPORTS API SERVER');
    console.log('=================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ API URL: http://localhost:${PORT}`);
    console.log('=================================');
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    db.end((err) => {
        if (err) {
            console.error('Error closing database connection:', err);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});

module.exports = app;
