// ============================================
// KABUTO ESPORTS - MAIN SERVER FILE
// ============================================

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const db = require('./config/database');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const teamRoutes = require('./routes/teams');
const tournamentRoutes = require('./routes/tournaments');
const walletRoutes = require('./routes/wallet');
const hostRoutes = require('./routes/host');
const paymentRoutes = require('./routes/payment');

const app = express();

// MIDDLEWARE
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ROUTES
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Kabuto Esports API is running!',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/host', hostRoutes);
app.use('/api/payment', paymentRoutes);

// ERROR HANDLING
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});

// START SERVER
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