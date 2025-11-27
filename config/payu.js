// ============================================
// PAYU CONFIGURATION
// ============================================

const crypto = require('crypto');

// ============================================
// PAYU CREDENTIALS
// ============================================
const PAYU_CONFIG = {
    merchantKey: process.env.PAYU_MERCHANT_KEY || 'gtKFFx',
    salt: process.env.PAYU_SALT || 'eCwWELxi',
    baseUrl: process.env.PAYU_BASE_URL || 'https://test.payu.in',
    // Production URL: https://secure.payu.in
};

// Log configuration on startup (without exposing sensitive data)
console.log('🔐 PayU Configuration Loaded:');
console.log('   Merchant Key:', PAYU_CONFIG.merchantKey.substring(0, 4) + '***');
console.log('   Base URL:', PAYU_CONFIG.baseUrl);
console.log('   Environment:', PAYU_CONFIG.baseUrl.includes('test') ? 'TEST MODE' : 'PRODUCTION');

// ============================================
// GENERATE PAYU HASH (FOR PAYMENT REQUEST)
// ============================================
// Hash String Format: key|txnid|amount|productinfo|firstname|email|||||||||||salt
function generatePayUHash(params) {
    const { key, txnid, amount, productinfo, firstname, email, salt } = params;
    
    // Validate required parameters
    if (!key || !txnid || !amount || !productinfo || !firstname || !email || !salt) {
        throw new Error('Missing required parameters for hash generation');
    }
    
    // Build hash string (following PayU documentation)
    const hashString = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${salt}`;
    
    // Generate SHA-512 hash
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');
    
    console.log('🔑 Hash Generated:');
    console.log('   TxnID:', txnid);
    console.log('   Amount:', amount);
    console.log('   Hash:', hash.substring(0, 20) + '...');
    
    return hash;
}

// ============================================
// VERIFY PAYU RESPONSE HASH (FOR CALLBACK)
// ============================================
// Hash String Format: salt|status|||||||||||email|firstname|productinfo|amount|txnid|key
function verifyPayUHash(params) {
    const { key, txnid, amount, productinfo, firstname, email, status, salt } = params;
    
    // Validate required parameters
    if (!key || !txnid || !amount || !productinfo || !firstname || !email || !status || !salt) {
        console.error('❌ Missing parameters for hash verification:', {
            key: !!key,
            txnid: !!txnid,
            amount: !!amount,
            productinfo: !!productinfo,
            firstname: !!firstname,
            email: !!email,
            status: !!status,
            salt: !!salt
        });
        throw new Error('Missing required parameters for hash verification');
    }
    
    // Build hash string (REVERSE ORDER - as per PayU documentation)
    const hashString = `${salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    
    // Generate SHA-512 hash
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');
    
    console.log('🔍 Hash Verification:');
    console.log('   TxnID:', txnid);
    console.log('   Status:', status);
    console.log('   Calculated Hash:', hash.substring(0, 20) + '...');
    
    return hash;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Validate merchant configuration
function validateConfig() {
    if (!PAYU_CONFIG.merchantKey || PAYU_CONFIG.merchantKey === '') {
        throw new Error('PayU Merchant Key is not configured');
    }
    
    if (!PAYU_CONFIG.salt || PAYU_CONFIG.salt === '') {
        throw new Error('PayU Salt is not configured');
    }
    
    return true;
}

// Get payment status message
function getStatusMessage(status) {
    const statusMessages = {
        'success': 'Payment completed successfully',
        'failure': 'Payment failed',
        'pending': 'Payment is pending',
        'cancel': 'Payment was cancelled by user',
        'invalid': 'Invalid payment request',
        'bounced': 'Payment bounced',
        'userCancelled': 'Payment cancelled by user',
        'dropped': 'Payment dropped'
    };
    
    return statusMessages[status] || 'Unknown payment status';
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
    PAYU_CONFIG,
    generatePayUHash,
    verifyPayUHash,
    validateConfig,
    getStatusMessage
};