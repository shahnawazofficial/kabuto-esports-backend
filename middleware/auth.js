// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.header('Authorization');
        
        console.log('🔐 Auth middleware called');
        console.log('   Path:', req.path);
        console.log('   Auth header exists:', !!authHeader);
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ No valid authorization header');
            return res.status(401).json({
                success: false,
                message: 'No token, authorization denied'
            });
        }
        
        // Extract token (remove 'Bearer ' prefix)
        const token = authHeader.substring(7);
        
        console.log('   Token length:', token.length);
        console.log('   Token (first 20 chars):', token.substring(0, 20) + '...');
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        console.log('✅ Token verified');
        console.log('   User ID:', decoded.user_id);
        console.log('   Username:', decoded.username);
        
        // Add user from payload to request
        req.user = decoded;
        
        next();
        
    } catch (error) {
        console.error('❌ Auth middleware error:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token has expired'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        
        res.status(401).json({
            success: false,
            message: 'Token is not valid'
        });
    }
};

module.exports = auth;