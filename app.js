const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const fsPromises = require('fs').promises;
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

const app = express();
const PORT = 3000;

const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

// Load credentials from file
async function loadCredentials() {
    const content = await fsPromises.readFile(CREDENTIALS_PATH);
    return JSON.parse(content);
}

// Authorize and get OAuth2 client
async function authorize() {
    const credentials = await loadCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
        const token = await fsPromises.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
    } catch (err) {
        return getNewToken(oAuth2Client);
    }

    return oAuth2Client;
}

// Get new token
function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this URL:', authUrl);
    return authUrl;
}

// OAuth callback route
app.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    const credentials = await loadCredentials();
    const oAuth2Client = new google.auth.OAuth2(
        credentials.installed.client_id,
        credentials.installed.client_secret,
        'http://localhost:3000/oauth2callback'
    );

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await fsPromises.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        res.send('Authentication successful! You can close this tab.');
        
        // Start sending emails after successful authentication
        const emails = await readEmailsFromCSV('emails.csv');
        await sendBulkEmails(oAuth2Client, emails);
    } catch (err) {
        console.error('Error retrieving access token', err);
        res.send('Error retrieving access token');
    }
});

// Authorization route
app.get('/authorize', async (req, res) => {
    const credentials = await loadCredentials();
    const oAuth2Client = new google.auth.OAuth2(
        credentials.installed.client_id,
        credentials.installed.client_secret,
        'http://localhost:3000/oauth2callback'
    );
    const authUrl = getNewToken(oAuth2Client);
    res.redirect(authUrl);
});

// Send a single email
async function sendEmail(auth, emailOptions) {
    const gmail = google.gmail({ version: 'v1', auth });
    const subject = "Web and Digital Marketing";
    const htmlBody = `
    <html>
    <head>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
    </head>
    <body>
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
    <a href="https://ibb.co/R2t449m"><img src="https://i.ibb.co/BKxRdTt/K-na-Web-Digital-Marketing.webp" alt="Kaana Web & Digital Marketing" border="0"></a>
    <h1>Your Vision, Our Expertise: Let's Build Something Great Together</h1>
    <p>We are affordable, we are available! We are budget-friendly and efficient at every level. Client satisfaction is our top priority.</p>
    <h2>Our Services:</h2>
    <ul>
        <li><strong>Websites</strong>: Stunning, responsive websites that leave a lasting impression.</li>
        <li><strong>Web Apps</strong>: Powerful web applications tailored to your specific needs.</li>
        <li><strong>Mobile Apps</strong>: Engaging mobile experiences that captivate your audience.</li>
        <li><strong>Digital Marketing</strong>: Strategic campaigns to reach your target market and drive conversions.</li>
        <li><strong>SEO</strong>: Expert SEO optimization to improve your website's visibility and rankings.</li>
        <li><strong>AI Chatbots</strong>: Intelligent chatbots that provide exceptional customer service and automate tasks.</li>
        <li><strong>Business Automation</strong>: Streamline your operations and increase efficiency with automation solutions.</li>
    </ul>
    <h2>Why Choose Us:</h2>
    <ul>
        <li><strong>Customized Solutions</strong>: We work closely with you to understand your unique requirements and deliver tailored solutions.</li>
        <li><strong>Cutting-Edge Technology</strong>: We stay up-to-date with the latest trends and technologies to ensure your digital presence is always ahead of the curve.</li>
        <li><strong>Excellent Customer Service</strong>: Your satisfaction is our top priority. We provide exceptional support and communication throughout the entire process.</li>
    </ul>
    <p>Ready to discuss your project? Let's connect.</p>
    <p><strong>Website:</strong> <a href="https://kaana.in" style="color: #1a73e8; text-decoration: none;">kaana.in</a></p>
    <p><strong>Email:</strong> <a href="mailto:kana.sriman@gmail.com" style="color: #1a73e8; text-decoration: none;">kana.sriman@gmail.com</a></p>
    <p><strong>Phone:</strong><a href="tel:+919008747926" style="text-decoration: none;">
        <span style="color: #1a73e8;">+91 90087 47926</span>
    </a></p>
    <p style="margin-top: 20px;">
        <a href="https://instagram.com/kaana.2024/" style="text-decoration: none; margin-right: 10px;">
        <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram" width="25" height="25" style="vertical-align: middle;">
        <span style="font-family: 'poppins', san-serif; font-weight: 600; color: #1a73e8;">Kāna</span>
        </a>
    </p>
    <p>Best regards,<br><strong>Srinivas Yarrala</strong></p>
    </div>
    </body>
    </html>
    `;

    const encodedMessage = Buffer.from(
        `From: ${emailOptions.sender}\r\n` +
        `To: ${emailOptions.to}\r\n` +
        `Subject: ${subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: text/html; charset=utf-8\r\n\r\n` +
        `${htmlBody}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            resource: { raw: encodedMessage },
        });
        console.log('Email sent:', res.data);
        return res.data;
    } catch (err) {
        console.error('Error sending email:', err);
        throw err;
    }
}

// Read emails from CSV
function readEmailsFromCSV(filePath) {
    return new Promise((resolve, reject) => {
        const emails = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => emails.push(data.email))
            .on('end', () => {
                console.log('Emails loaded from CSV:', emails);
                resolve(emails);
            })
            .on('error', (err) => {
                console.error('Error reading CSV file:', err);
                reject(err);
            });
    });
}

// Log email sending results
async function logEmailResult(email, status, message) {
    const csvWriter = createObjectCsvWriter({
        path: 'emailLogs.csv',
        header: [
            { id: 'email', title: 'Email' },
            { id: 'status', title: 'Status' },
            { id: 'message', title: 'Message' },
            { id: 'timestamp', title: 'Timestamp' },
        ],
        append: true,
    });

    await csvWriter.writeRecords([{
        email,
        status,
        message,
        timestamp: new Date().toISOString(),
    }]);
}

// Send bulk emails with rate limiting
async function sendBulkEmails(auth, emails) {
    const DAILY_LIMIT = 500; // Gmail's daily sending limit for regular Gmail accounts
    const BATCH_SIZE = 100;  // Number of emails to send in each batch
    const BATCH_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const batch = emails.slice(i, i + BATCH_SIZE);
        console.log(`Sending batch ${i / BATCH_SIZE + 1} of ${Math.ceil(emails.length / BATCH_SIZE)}`);

        for (const email of batch) {
            try {
                await sendEmail(auth, {
                    sender: 'kana.sriman@gmail.com', // Replace with your email
                    to: email,
                });
                await logEmailResult(email, 'Success', 'Email sent successfully');
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay between emails
            } catch (err) {
                await logEmailResult(email, 'Failure', err.message);
            }
        }

        if (i + BATCH_SIZE < emails.length) {
            console.log(`Waiting for ${BATCH_INTERVAL / (60 * 1000)} minutes before sending the next batch...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL));
        }
    }
}

// Start the Express server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Visit http://localhost:3000/authorize to start the OAuth flow');
});

// Main flow
(async () => {
    try {
        const auth = await authorize();
        const emails = await readEmailsFromCSV('emails.csv');
        await sendBulkEmails(auth, emails);
    } catch (err) {
        console.error('Error in main flow:', err);
    }
})();