// ============================================
// PAYU CONFIGURATION
// ============================================

const crypto = require('crypto');

const PAYU_CONFIG = {
    merchantKey: process.env.PAYU_MERCHANT_KEY || 'gtKFFx',
    salt: process.env.PAYU_SALT || 'eCwWELxi',
    baseUrl: process.env.PAYU_BASE_URL || 'https://test.payu.in', // test URL
    // Production: https://secure.payu.in
};

// Generate PayU Hash
function generatePayUHash(params) {
    const { key, txnid, amount, productinfo, firstname, email, salt } = params;
    
    const hashString = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${salt}`;
    
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');
    
    return hash;
}

// Verify PayU Response Hash
function verifyPayUHash(params) {
    const { key, txnid, amount, productinfo, firstname, email, status, salt } = params;
    
    const hashString = `${salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');
    
    return hash;
}

module.exports = {
    PAYU_CONFIG,
    generatePayUHash,
    verifyPayUHash
};