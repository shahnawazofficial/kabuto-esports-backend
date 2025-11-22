// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.header('Authorization');
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token, authorization denied'
            });
        }
        
        // Extract token (remove 'Bearer ' prefix)
        const token = authHeader.substring(7);
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Add user from payload to request
        req.user = decoded;
        
        next();
        
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        res.status(401).json({
            success: false,
            message: 'Token is not valid'
        });
    }
};

module.exports = auth;