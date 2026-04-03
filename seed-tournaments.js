// ============================================
// KABUTO ESPORTS - Seed Sample Tournament Data
// Uses the CORRECT current DB schema columns.
// Run on VPS: node seed-tournaments.js
// ============================================

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'kabuto_esports',
    waitForConnections: true,
    connectionLimit: 5
});

// Future dates so tournaments remain "active"
const future = (daysFromNow) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().slice(0, 19).replace('T', ' ');
};

const tournaments = [
    {
        tournament_name: 'BGMI Solo Showdown #1',
        tournament_description: 'Top 64 solo warriors compete on Erangel TPP. Only the strongest survive! Registration is free.',
        game_mode: 'solo',
        max_participants: 64,
        registration_start: future(0),
        registration_end: future(4),
        tournament_start_time: future(5),
        tournament_status: 'registration_open',
        map_name: 'Erangel',
        perspective: 'TPP',
        current_participants: 0,
        banner_image_url: null
    },
    {
        tournament_name: 'BGMI Squad Championship',
        tournament_description: 'The ultimate squad battle — 25 teams fight across 3 matches for glory and bragging rights!',
        game_mode: 'squad',
        max_participants: 100,
        registration_start: future(0),
        registration_end: future(6),
        tournament_start_time: future(7),
        tournament_status: 'registration_open',
        map_name: 'Miramar',
        perspective: 'TPP',
        current_participants: 0,
        banner_image_url: null
    },
    {
        tournament_name: 'Duo Masters - Sanhok',
        tournament_description: 'Fast-paced duo tournament on Sanhok. Quick matches, high intensity. Register with your partner now!',
        game_mode: 'duo',
        max_participants: 50,
        registration_start: future(0),
        registration_end: future(9),
        tournament_start_time: future(10),
        tournament_status: 'registration_open',
        map_name: 'Sanhok',
        perspective: 'FPP',
        current_participants: 0,
        banner_image_url: null
    },
    {
        tournament_name: 'BGMI Pro League Season 1',
        tournament_description: 'Premier competitive tournament. Top 16 squads only. Prove you are the best!',
        game_mode: 'squad',
        max_participants: 64,
        registration_start: future(1),
        registration_end: future(12),
        tournament_start_time: future(14),
        tournament_status: 'registration_open',
        map_name: 'Erangel',
        perspective: 'TPP',
        current_participants: 0,
        banner_image_url: null
    }
];

async function seedTournaments() {
    console.log('🌱 Starting tournament seed...');
    console.log(`📊 DB: ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_NAME}`);

    try {
        // Check DB connection first
        const [rows] = await pool.query('SELECT 1 AS ok');
        if (rows[0].ok !== 1) throw new Error('DB connection test failed');
        console.log('✅ Database connected successfully!');

        // Check if tournaments already exist
        const [existing] = await pool.query('SELECT COUNT(*) as cnt FROM tournaments');
        console.log(`ℹ️  Current tournament count: ${existing[0].cnt}`);

        if (existing[0].cnt > 0) {
            console.log('⚠️  Tournaments already exist. Skipping seed (delete them first if you want to re-seed).');
            process.exit(0);
        }

        // Check if there is at least one user to use as host_user_id
        const [users] = await pool.query('SELECT user_id FROM users LIMIT 1');
        const hostUserId = users.length > 0 ? users[0].user_id : null;

        for (const t of tournaments) {
            await pool.query(
                `INSERT INTO tournaments (
                    tournament_name, tournament_description, host_user_id, game_mode,
                    max_participants, registration_start, registration_end,
                    tournament_start_time, tournament_status, map_name, perspective,
                    current_participants, banner_image_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    t.tournament_name,
                    t.tournament_description,
                    hostUserId,
                    t.game_mode,
                    t.max_participants,
                    t.registration_start,
                    t.registration_end,
                    t.tournament_start_time,
                    t.tournament_status,
                    t.map_name,
                    t.perspective,
                    t.current_participants,
                    t.banner_image_url
                ]
            );
            console.log(`✅ Added: ${t.tournament_name}`);
        }

        const [after] = await pool.query('SELECT COUNT(*) as cnt FROM tournaments');
        console.log(`\n🎉 Seed complete! Total tournaments in DB: ${after[0].cnt}`);
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Seed failed:', error.message);
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('👉 Fix: Run the MySQL user fix commands from the README first.');
        }
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.error('👉 Fix: The database schema may not be set up yet. Run your schema.sql first.');
        }
        process.exit(1);
    }
}

seedTournaments();
