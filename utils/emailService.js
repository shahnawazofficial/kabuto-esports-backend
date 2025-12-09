const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Verify Resend is configured
if (process.env.RESEND_API_KEY) {
    console.log('✅ Resend API configured');
} else {
    console.error('❌ RESEND_API_KEY not found in environment variables');
}

async function sendOtpEmail(toEmail, otp) {
    try {
        console.log(`📧 Preparing to send OTP email via Resend to: ${toEmail}`);
        
        const { data, error } = await resend.emails.send({
            from: 'Kabuto Esports <verificationmail@kabutoesports.com>', //  - change later
            to: toEmail,
            subject: 'Kabuto Esports - Password Reset OTP',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #ffffff;">
                    <div style="background: linear-gradient(135deg, #C96A0D 0%, #A85808 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                        <h2 style="color: #ffffff; margin: 0; font-size: 24px;">Kabuto Esports</h2>
                        <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 14px;">No Mercy. Just Victory.</p>
                    </div>
                    <div style="background: #f5f5f5; padding: 40px 30px; border-radius: 0 0 10px 10px;">
                        <h3 style="color: #333; margin: 0 0 20px 0;">Password Reset Request</h3>
                        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">Your OTP for resetting your password is:</p>
                        <div style="background: #ffffff; padding: 25px; border-radius: 8px; text-align: center; margin: 0 0 30px 0; border: 2px solid #C96A0D;">
                            <h1 style="letter-spacing: 15px; color: #C96A0D; margin: 0; font-size: 42px; font-weight: bold;">${otp}</h1>
                        </div>
                        <div style="background: #fff3e0; padding: 15px; border-radius: 6px; border-left: 4px solid #C96A0D; margin: 0 0 20px 0;">
                            <p style="font-size: 14px; color: #666; margin: 0;">⏱️ This OTP is valid for <b style="color: #C96A0D;">10 minutes</b>.</p>
                        </div>
                        <p style="font-size: 13px; color: #999; margin: 20px 0 0 0; line-height: 1.6;">If you did not request this password reset, please ignore this email or contact support if you have concerns.</p>
                    </div>
                    <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                        <p style="margin: 0;">© 2024 Kabuto Esports. All rights reserved.</p>
                    </div>
                </div>
            `
        });

        if (error) {
            console.error('❌ Resend API error:', error);
            throw error;
        }

        console.log('✅ OTP email sent successfully via Resend!');
        console.log('📨 Email ID:', data.id);
        
        return data;
    } catch (error) {
        console.error('❌ Error in sendOtpEmail function:', error);
        console.error('❌ Error details:', {
            message: error.message,
            name: error.name
        });
        throw error;
    }
}

module.exports = { sendOtpEmail };