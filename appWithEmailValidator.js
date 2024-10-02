const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const dns = require('dns');
const validator = require('email-validator');
const punycode = require('punycode');

const app = express();
const PORT = 3000;

// Enhanced email validation function
async function validateEmail(email) {
    // Step 1: Basic format check
    if (!validator.validate(email)) {
        return { isValid: false, reason: 'Invalid email format' };
    }

    const [localPart, domain] = email.split('@');

    // Step 2: Check local part length
    if (localPart.length > 64) {
        return { isValid: false, reason: 'Local part exceeds maximum length' };
    }

    // Step 3: Check domain
    try {
        const punycodeDomain = punycode.toASCII(domain);
        
        // Check MX records
        const mxRecords = await dns.promises.resolveMx(punycodeDomain);
        if (mxRecords.length === 0) {
            return { isValid: false, reason: 'No MX records found' };
        }

        // Check A records as a fallback
        try {
            await dns.promises.resolve4(punycodeDomain);
        } catch (err) {
            if (err.code === 'ENODATA') {
                return { isValid: false, reason: 'No A records found' };
            }
        }

        // Step 4: Additional checks for common providers
        if (domain.toLowerCase() === 'gmail.com') {
            // Gmail-specific checks
            if (localPart.includes('+') || localPart.includes('.')) {
                // These are valid in Gmail, but might be problematic for some systems
                return { isValid: true, reason: 'Valid, but contains Gmail-specific features' };
            }
            if (localPart.length < 6) {
                // Gmail requires at least 6 characters
                return { isValid: false, reason: 'Gmail addresses require at least 6 characters before @' };
            }
        }

        // Step 5: Check for disposable email domains
        const disposableDomains = ['mailinator.com', 'temp-mail.org', 'guerrillamail.com']; // Add more as needed
        if (disposableDomains.includes(domain.toLowerCase())) {
            return { isValid: false, reason: 'Disposable email address' };
        }

        return { isValid: true, reason: 'Valid email address' };
    } catch (error) {
        if (error.code === 'ENOTFOUND') {
            return { isValid: false, reason: 'Domain does not exist' };
        }
        return { isValid: false, reason: 'Validation error: ' + error.message };
    }
}

// Read and validate emails from CSV
async function readAndValidateEmailsFromCSV(filePath) {
    return new Promise((resolve, reject) => {
        const emails = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => emails.push(data.email))
            .on('end', async () => {
                console.log('Emails loaded from CSV. Validating...');
                const validatedEmails = [];
                for (const email of emails) {
                    const result = await validateEmail(email);
                    validatedEmails.push({ email, ...result });
                }
                console.log('Email validation complete.');
                resolve(validatedEmails);
            })
            .on('error', (err) => {
                console.error('Error reading CSV file:', err);
                reject(err);
            });
    });
}

// Log email validation results
async function logEmailResults(validatedEmails) {
    const csvWriter = createObjectCsvWriter({
        path: 'emailLogs.csv',
        header: [
            { id: 'email', title: 'Email' },
            { id: 'isValid', title: 'Is Valid' },
            { id: 'validationReason', title: 'Validation Reason' },
            { id: 'timestamp', title: 'Timestamp' },
        ],
        append: true,
    });

    await csvWriter.writeRecords(validatedEmails.map(({ email, isValid, reason }) => ({
        email,
        isValid,
        validationReason: reason,
        timestamp: new Date().toISOString(),
    })));
}

// Main flow to trigger email validation
app.get('/validate-emails', async (req, res) => {
    const filePath = req.query.filePath;
    if (!filePath) {
        return res.status(400).send('File path is required');
    }

    try {
        const validatedEmails = await readAndValidateEmailsFromCSV(filePath);
        await logEmailResults(validatedEmails);
        res.json(validatedEmails);
    } catch (error) {
        console.error('Error during email validation:', error);
        res.status(500).send('Internal server error');
    }
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});