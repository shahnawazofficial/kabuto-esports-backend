const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken } = require('./auth');

// ROUTE: Create New Team
router.post('/', verifyToken, async (req, res) => {
    try {
        const { team_name, team_tag, max_members } = req.body;
        
        if (!team_name) {
            return res.status(400).json({
                success: false,
                message: 'Team name is required'
            });
        }
        
        const [existingTeams] = await db.query(
            'SELECT * FROM teams WHERE captain_user_id = ? AND team_status = "active"',
            [req.userId]
        );
        
        if (existingTeams.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'You are already captain of an active team'
            });
        }
        
        const [result] = await db.query(
            `INSERT INTO teams (team_name, team_tag, captain_user_id, max_members) 
             VALUES (?, ?, ?, ?)`,
            [team_name, team_tag || null, req.userId, max_members || 4]
        );
        
        await db.query(
            `INSERT INTO team_members (team_id, user_id, role) 
             VALUES (?, ?, 'captain')`,
            [result.insertId, req.userId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Team created successfully',
            data: {
                team_id: result.insertId,
                team_name: team_name
            }
        });
        
    } catch (error) {
        console.error('Create team error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating team',
            error: error.message
        });
    }
});

// ROUTE: Get Team Details
router.get('/:id', async (req, res) => {
    try {
        const [teams] = await db.query(
            `SELECT t.*, u.username as captain_username, u.full_name as captain_name
             FROM teams t
             JOIN users u ON t.captain_user_id = u.user_id
             WHERE t.team_id = ?`,
            [req.params.id]
        );
        
        if (teams.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }
        
        const [members] = await db.query(
            `SELECT tm.*, u.username, u.full_name, u.profile_image_url, 
                    u.player_level, u.total_wins
             FROM team_members tm
             JOIN users u ON tm.user_id = u.user_id
             WHERE tm.team_id = ?`,
            [req.params.id]
        );
        
        res.json({
            success: true,
            data: {
                team: teams[0],
                members: members
            }
        });
        
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching team',
            error: error.message
        });
    }
});

// ROUTE: Get My Teams
router.get('/my/teams', verifyToken, async (req, res) => {
    try {
        const [teams] = await db.query(
            `SELECT t.*, tm.role
             FROM teams t
             JOIN team_members tm ON t.team_id = tm.team_id
             WHERE tm.user_id = ? AND t.team_status = 'active'`,
            [req.userId]
        );
        
        res.json({
            success: true,
            data: teams
        });
        
    } catch (error) {
        console.error('Get my teams error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching teams',
            error: error.message
        });
    }
});

// ROUTE: Invite User to Team
router.post('/:id/invite', verifyToken, async (req, res) => {
    try {
        const { invitee_user_id, message } = req.body;
        const teamId = req.params.id;
        
        const [teams] = await db.query(
            'SELECT * FROM teams WHERE team_id = ? AND captain_user_id = ?',
            [teamId, req.userId]
        );
        
        if (teams.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Only team captain can send invitations'
            });
        }
        
        const [memberCount] = await db.query(
            'SELECT COUNT(*) as count FROM team_members WHERE team_id = ?',
            [teamId]
        );
        
        if (memberCount[0].count >= teams[0].max_members) {
            return res.status(400).json({
                success: false,
                message: 'Team is full'
            });
        }
        
        const [existingMember] = await db.query(
            'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
            [teamId, invitee_user_id]
        );
        
        if (existingMember.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User is already a team member'
            });
        }
        
        const [pendingInvite] = await db.query(
            `SELECT * FROM team_invitations 
             WHERE team_id = ? AND invitee_user_id = ? AND status = 'pending'`,
            [teamId, invitee_user_id]
        );
        
        if (pendingInvite.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invitation already sent to this user'
            });
        }
        
        await db.query(
            `INSERT INTO team_invitations (team_id, inviter_user_id, invitee_user_id, message) 
             VALUES (?, ?, ?, ?)`,
            [teamId, req.userId, invitee_user_id, message || null]
        );
        
        await db.query(
            `INSERT INTO notifications (user_id, notification_type, title, message, reference_type, reference_id)
             VALUES (?, 'team_invitation', 'Team Invitation', ?, 'team', ?)`,
            [invitee_user_id, `You've been invited to join ${teams[0].team_name}!`, teamId]
        );
        
        res.json({
            success: true,
            message: 'Invitation sent successfully'
        });
        
    } catch (error) {
        console.error('Invite error:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending invitation',
            error: error.message
        });
    }
});

// ROUTE: Get My Invitations
router.get('/my/invitations', verifyToken, async (req, res) => {
    try {
        const [invitations] = await db.query(
            `SELECT ti.*, t.team_name, t.team_tag, u.username as inviter_username
             FROM team_invitations ti
             JOIN teams t ON ti.team_id = t.team_id
             JOIN users u ON ti.inviter_user_id = u.user_id
             WHERE ti.invitee_user_id = ? AND ti.status = 'pending'
             ORDER BY ti.created_at DESC`,
            [req.userId]
        );
        
        res.json({
            success: true,
            data: invitations
        });
        
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching invitations',
            error: error.message
        });
    }
});

// ROUTE: Respond to Team Invitation
router.post('/invitations/:id/respond', verifyToken, async (req, res) => {
    try {
        const { action } = req.body;
        const invitationId = req.params.id;
        
        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid action. Use "accept" or "reject"'
            });
        }
        
        const [invitations] = await db.query(
            'SELECT * FROM team_invitations WHERE invitation_id = ? AND invitee_user_id = ?',
            [invitationId, req.userId]
        );
        
        if (invitations.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Invitation not found'
            });
        }
        
        const invitation = invitations[0];
        
        if (invitation.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Invitation already responded to'
            });
        }
        
        if (action === 'accept') {
            const [teams] = await db.query(
                'SELECT * FROM teams WHERE team_id = ?',
                [invitation.team_id]
            );
            
            const [memberCount] = await db.query(
                'SELECT COUNT(*) as count FROM team_members WHERE team_id = ?',
                [invitation.team_id]
            );
            
            if (memberCount[0].count >= teams[0].max_members) {
                return res.status(400).json({
                    success: false,
                    message: 'Team is full'
                });
            }
            
            await db.query(
                'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, "member")',
                [invitation.team_id, req.userId]
            );
            
            await db.query(
                'UPDATE team_invitations SET status = "accepted", responded_at = NOW() WHERE invitation_id = ?',
                [invitationId]
            );
            
            res.json({
                success: true,
                message: 'Invitation accepted! You joined the team.'
            });
        } else {
            await db.query(
                'UPDATE team_invitations SET status = "rejected", responded_at = NOW() WHERE invitation_id = ?',
                [invitationId]
            );
            
            res.json({
                success: true,
                message: 'Invitation rejected'
            });
        }
        
    } catch (error) {
        console.error('Respond invitation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error responding to invitation',
            error: error.message
        });
    }
});

// ROUTE: Leave Team
router.post('/:id/leave', verifyToken, async (req, res) => {
    try {
        const teamId = req.params.id;
        
        const [teams] = await db.query(
            'SELECT * FROM teams WHERE team_id = ? AND captain_user_id = ?',
            [teamId, req.userId]
        );
        
        if (teams.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Captain cannot leave team. Transfer captaincy or disband team first.'
            });
        }
        
        await db.query(
            'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
            [teamId, req.userId]
        );
        
        res.json({
            success: true,
            message: 'You left the team successfully'
        });
        
    } catch (error) {
        console.error('Leave team error:', error);
        res.status(500).json({
            success: false,
            message: 'Error leaving team',
            error: error.message
        });
    }
});

module.exports = router;