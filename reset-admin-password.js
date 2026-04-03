/**
 * ============================================================
 * KABUTO ESPORTS - Admin Password Reset Script
 * ============================================================
 * Run this script on your DigitalOcean server with:
 *   node reset-admin-password.js
 *
 * This will:
 *   1. Show the current admin row from the DB
 *   2. Generate a fresh bcrypt hash for Admin@123
 *   3. Update the admins table with the correct hash
 *   4. Verify the new hash works correctly
 * ============================================================
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./config/database');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Admin@123';
const SALT_ROUNDS = 10;

async function resetAdminPassword() {
    console.log('==============================================');
    console.log('🔧 Kabuto Esports - Admin Password Reset Tool');
    console.log('==============================================\n');

    try {
        // Step 1: Check current admin record
        console.log(`📋 Step 1: Looking up admin "${ADMIN_USERNAME}" in database...`);
        const [rows] = await db.query('SELECT * FROM admins WHERE username = ?', [ADMIN_USERNAME]);

        if (rows.length === 0) {
            console.log(`\n❌ Admin user "${ADMIN_USERNAME}" NOT FOUND in the database!`);
            console.log('👉 Creating a fresh admin account...\n');

            const hash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
            await db.query(
                `INSERT INTO admins (username, password, email, full_name, admin_role, is_active)
                 VALUES (?, ?, ?, ?, 'super', 1)`,
                [ADMIN_USERNAME, hash, 'admin@kabutoesports.com', 'Kabuto Admin']
            );

            console.log(`✅ Admin account created successfully!`);
            console.log(`   Username : ${ADMIN_USERNAME}`);
            console.log(`   Password : ${ADMIN_PASSWORD}`);
        } else {
            const admin = rows[0];
            console.log(`✅ Admin found  — admin_id: ${admin.admin_id}`);
            console.log(`   Username    : ${admin.username}`);
            console.log(`   is_active   : ${admin.is_active}`);
            console.log(`   Stored hash : ${admin.password}\n`);

            // Step 2: Test current hash against the desired password
            console.log(`🔑 Step 2: Testing current hash against "${ADMIN_PASSWORD}"...`);
            const currentMatch = await bcrypt.compare(ADMIN_PASSWORD, admin.password);
            console.log(`   bcrypt.compare result: ${currentMatch ? '✅ MATCH' : '❌ NO MATCH'}\n`);

            if (currentMatch) {
                console.log('✅ Password is already correct! No update needed.');
                console.log('   If login still fails, check: is_active flag and API URL.\n');
            } else {
                // Step 3: Generate a fresh hash
                console.log(`🔄 Step 3: Generating fresh bcrypt hash for "${ADMIN_PASSWORD}"...`);
                const newHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
                console.log(`   New hash: ${newHash}\n`);

                // Step 4: Update DB
                console.log(`💾 Step 4: Updating password in database...`);
                await db.query(
                    'UPDATE admins SET password = ?, is_active = 1 WHERE username = ?',
                    [newHash, ADMIN_USERNAME]
                );
                console.log(`   ✅ Database updated!\n`);

                // Step 5: Verify
                console.log(`✅ Step 5: Verifying new hash works...`);
                const verifyMatch = await bcrypt.compare(ADMIN_PASSWORD, newHash);
                console.log(`   Verification result: ${verifyMatch ? '✅ PASS' : '❌ FAIL'}\n`);

                if (verifyMatch) {
                    console.log('🎉 Password reset complete!');
                    console.log('==============================================');
                    console.log(`   Username : ${ADMIN_USERNAME}`);
                    console.log(`   Password : ${ADMIN_PASSWORD}`);
                    console.log('==============================================');
                } else {
                    console.log('❌ Verification failed — bcrypt may be broken.');
                }
            }
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        // Close the pool and exit
        await db.end();
        process.exit(0);
    }
}

resetAdminPassword();
