const nodemailer = require('nodemailer');

// Gmail SMTP configuration (works better with cloud services)
const transporter = nodemailer.createTransport({
    service: 'gmail', // Using Gmail service
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verify SMTP connection on startup
transporter.verify(function(error, success) {
    if (error) {
        console.error('❌ SMTP connection error:', error);
        console.error('SMTP Config:', {
            service: 'gmail',
            user: process.env.SMTP_USER
        });
    } else {
        console.log('✅ SMTP Server is ready to send emails');
        console.log('📧 Using Gmail SMTP');
    }
});

async function sendOtpEmail(toEmail, otp) {
    try {
        console.log(`📧 Preparing to send OTP email to: ${toEmail}`);
        
        const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

        const mailOptions = {
            from: fromEmail,
            to: toEmail,
            subject: 'Kabuto Esports - Password Reset OTP',
            text: `Your OTP for resetting your password is: ${otp}\n\nThis OTP is valid for 10 minutes.\n\nIf you did not request this, please ignore this email.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #C96A0D 0%, #A85808 100%); padding: 20px; border-radius: 10px 10px 0 0;">
                        <h2 style="color: #ffffff; margin: 0;">Kabuto Esports</h2>
                    </div>
                    <div style="background: #f5f5f5; padding: 30px; border-radius: 0 0 10px 10px;">
                        <p style="font-size: 16px; color: #333;">Your OTP for resetting your password is:</p>
                        <div style="background: #ffffff; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                            <h1 style="letter-spacing: 10px; color: #C96A0D; margin: 0; font-size: 36px;">${otp}</h1>
                        </div>
                        <p style="font-size: 14px; color: #666;">This OTP is valid for <b>10 minutes</b>.</p>
                        <p style="font-size: 14px; color: #999; margin-top: 30px;">If you did not request this, please ignore this email.</p>
                    </div>
                    <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
                        <p>© 2024 Kabuto Esports. All rights reserved.</p>
                    </div>
                </div>
            `
        };

        console.log('📧 Sending email...');

        const info = await transporter.sendMail(mailOptions);
        
        console.log('✅ OTP email sent successfully!');
        console.log('📨 Message ID:', info.messageId);
        
        return info;
    } catch (error) {
        console.error('❌ Error in sendOtpEmail function:', error);
        console.error('❌ Error details:', {
            message: error.message,
            code: error.code
        });
        throw error;
    }
}

module.exports = { sendOtpEmail };