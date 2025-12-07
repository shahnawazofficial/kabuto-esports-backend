const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // true only for port 465
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendOtpEmail(toEmail, otp) {
    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

    const mailOptions = {
        from: fromEmail,
        to: toEmail,
        subject: 'Kabuto Esports - Password Reset OTP',
        text: `Your OTP for resetting your password is: ${otp}\n\nThis OTP is valid for 10 minutes.\n\nIf you did not request this, please ignore this email.`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 10px;">
                <h2 style="color: #ff7a00;">Kabuto Esports</h2>
                <p>Your OTP for resetting your password is:</p>
                <h1 style="letter-spacing: 5px;">${otp}</h1>
                <p>This OTP is valid for <b>10 minutes</b>.</p>
                <p>If you did not request this, please ignore this email.</p>
            </div>
        `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('📨 OTP email sent:', info.messageId);
}

module.exports = { sendOtpEmail };
