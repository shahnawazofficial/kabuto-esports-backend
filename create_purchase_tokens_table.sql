-- ============================================
-- CREATE PURCHASE_TOKENS TABLE
-- ============================================
-- This table stores Google Play purchase tokens to:
-- 1. Verify purchases server-side
-- 2. Prevent replay attacks (same token used twice)
-- 3. Track payment history
-- ============================================

CREATE TABLE IF NOT EXISTS purchase_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    tournament_id INT NOT NULL,
    purchase_token VARCHAR(512) NOT NULL UNIQUE,
    product_id VARCHAR(100) NOT NULL,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    
    -- Indexes for performance
    INDEX idx_user_tournament (user_id, tournament_id),
    INDEX idx_purchase_token (purchase_token),
    INDEX idx_verified_at (verified_at)
);

-- Add comment
ALTER TABLE purchase_tokens COMMENT = 'Stores Google Play Billing purchase tokens for tournament registrations';
