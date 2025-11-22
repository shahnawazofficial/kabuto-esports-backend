require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

async function addSampleTournaments() {
    try {
        const tournaments = [
            {
                tournament_name: 'BGMI Winter Championship 2024',
                game_mode: 'Squad',
                game_type: 'Battle Royale',
                max_teams: 100,
                entry_fee: 50,
                prize_pool: 10000,
                tournament_status: 'registration_open',
                start_date: '2024-12-15T18:00:00',
                registration_end_date: '2024-12-14T23:59:59',
                map_type: 'Erangel',
                perspective: 'TPP',
                team_size: 4
            },
            {
                tournament_name: 'Solo Showdown - Miramar',
                game_mode: 'Solo',
                game_type: 'Battle Royale',
                max_teams: 64,
                entry_fee: 30,
                prize_pool: 5000,
                tournament_status: 'registration_open',
                start_date: '2024-12-10T20:00:00',
                registration_end_date: '2024-12-09T23:59:59',
                map_type: 'Miramar',
                perspective: 'FPP',
                team_size: 1
            },
            {
                tournament_name: 'Duo Masters Challenge',
                game_mode: 'Duo',
                game_type: 'Battle Royale',
                max_teams: 50,
                entry_fee: 40,
                prize_pool: 7500,
                tournament_status: 'registration_open',
                start_date: '2024-12-20T19:00:00',
                registration_end_date: '2024-12-19T23:59:59',
                map_type: 'Sanhok',
                perspective: 'TPP',
                team_size: 2
            },
            {
                tournament_name: 'BGMI Pro League Finals',
                game_mode: 'Squad',
                game_type: 'Battle Royale',
                max_teams: 16,
                entry_fee: 100,
                prize_pool: 50000,
                tournament_status: 'ongoing',
                start_date: '2024-11-21T18:00:00',
                registration_end_date: '2024-11-20T23:59:59',
                map_type: 'Erangel',
                perspective: 'TPP',
                team_size: 4,
                stream_url: 'https://www.youtube.com/@kabutoislive'
            }
        ];

        for (const tournament of tournaments) {
            await pool.query(
                `INSERT INTO tournaments 
                (tournament_name, game_mode, game_type, max_teams, entry_fee, prize_pool, 
                tournament_status, start_date, registration_end_date, map_type, perspective, team_size, stream_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tournament.tournament_name,
                    tournament.game_mode,
                    tournament.game_type,
                    tournament.max_teams,
                    tournament.entry_fee,
                    tournament.prize_pool,
                    tournament.tournament_status,
                    tournament.start_date,
                    tournament.registration_end_date,
                    tournament.map_type,
                    tournament.perspective,
                    tournament.team_size,
                    tournament.stream_url || null
                ]
            );
            console.log(`✅ Added: ${tournament.tournament_name}`);
        }

        console.log('\n🎉 All sample tournaments added successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

addSampleTournaments();