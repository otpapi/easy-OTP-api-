const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');

const upload = multer();

// ===================================
// FIREBASE & WHATSAPP CONFIGURATIONS
// ===================================
const MASTER_WHATSAPP_API = 'https://api-watheapp-1.onrender.com';
const MASTER_USER_ID = '87149204-1e93-40af-90ed-27e6397b1606';
const FIREBASE_API_KEY = 'AIzaSyBwE_cFD2DcrtTJVHM69O8_mWAE6-U84K4';

// UPDATE THIS: Replace with your Firebase Realtime Database URL
const FIREBASE_DB_URL = 'https://easyotpapi-online-default-rtdb.firebaseio.com';

const COOKIE_SECRET = 'easyotp_hmac_secret_salt_keys_982103';

// ===================================
// CRYPTO HELPERS (Stateless OTP Verification)
// ===================================
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function createOtpHash(phone, otp, expiry) {
    const data = `${phone}.${otp}.${expiry}`;
    return crypto.createHmac('sha256', COOKIE_SECRET).update(data).digest('hex');
}

// ===================================
// FIREBASE DB REST UTILITIES
// ===================================
async function getFirebaseUser(phone) {
    try {
        const response = await fetch(`${FIREBASE_DB_URL}/users/${phone}.json`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
}

async function updateFirebaseUser(phone, data) {
    try {
        await fetch(`${FIREBASE_DB_URL}/users/${phone}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return true;
    } catch (e) {
        return false;
    }
}

// ===================================
// AUTHENTICATION MIDDLEWARE
// ===================================
function checkAuth(req, res, next) {
    const phone = req.cookies.auth_phone;
    if (!phone) {
        return res.status(401).json({ status: false, message: 'Unauthorized session' });
    }
    req.phone = phone;
    next();
}

// ===================================
// WHATSAPP API GATEWAYS
// ===================================
async function sendMasterOTP(phone, otp) {
    const url = `${MASTER_WHATSAPP_API}/send?userId=${MASTER_USER_ID}&number=91${phone}&otp=${otp}`;
    try {
        const response = await fetch(url);
        return response.ok;
    } catch (e) {
        return false;
    }
}

// ===================================
// FIREBASE AUTH REST APIs
// ===================================
async function firebaseLogin(phone) {
    const email = `${phone}@easyotpapi.online`;
    const password = `easyotpapi${phone}`;
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        return await response.json();
    } catch (e) {
        return null;
    }
}

async function firebaseRegister(phone) {
    const email = `${phone}@easyotpapi.online`;
    const password = `easyotpapi${phone}`;
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        return await response.json();
    } catch (e) {
        return null;
    }
}

// ===================================
// SYSTEM CONTROLLERS
// ===================================

// Login OTP Sender & Verification Gateways (Used by login.html)
router.post('/', upload.none(), async (req, res) => {
    if (req.body.phone !== undefined) {
        const phone = req.body.phone.replace(/[^0-9]/g, '');
        if (!phone) return res.json({ status: false, message: 'Phone number required' });

        const otp = generateOTP();
        const expiry = Date.now() + 300 * 1000;
        const hash = createOtpHash(phone, otp, expiry);

        const sent = await sendMasterOTP(phone, otp);
        if (!sent) return res.json({ status: false, message: 'OTP dispatch failed' });

        res.cookie('auth_phone', phone, { maxAge: 300000, httpOnly: true });
        res.cookie('auth_hash', hash, { maxAge: 300000, httpOnly: true });
        res.cookie('auth_expiry', expiry.toString(), { maxAge: 300000, httpOnly: true });

        return res.json({ status: true, message: 'OTP sent successfully' });
    }

    if (req.body.verify_otp !== undefined) {
        const userOtp = req.body.verify_otp;
        const phone = req.cookies.auth_phone;
        const savedHash = req.cookies.auth_hash;
        const savedExpiry = req.cookies.auth_expiry;

        if (!phone || !savedHash || !savedExpiry) {
            return res.json({ status: false, message: 'Verification session expired' });
        }

        if (Date.now() > parseInt(savedExpiry)) {
            return res.json({ status: false, message: 'OTP expired' });
        }

        const computedHash = createOtpHash(phone, userOtp, savedExpiry);
        if (computedHash === savedHash) {
            
            let loginResult = await firebaseLogin(phone);
            if (loginResult && loginResult.error) {
                let regResult = await firebaseRegister(phone);
                if (regResult && regResult.error) {
                    return res.json({ status: false, message: 'Database enrollment failed' });
                }
            }

            let dbUser = await getFirebaseUser(phone);
            if (!dbUser) {
                dbUser = {
                    balance: 100, // Gift trial balance
                    total_otp: 0,
                    today_otp: 0,
                    today_spend: 0,
                    api_key: '',
                    whatsapp_connected: 'DISCONNECTED',
                    whatsapp_user_id: '',
                    whatsapp_number: '',
                    pairing_code: '',
                    transactions: [
                        { id: 'TXN-' + Math.floor(Math.random() * 900000), date: new Date().toLocaleDateString(), type: 'Welcome Trial Credits', status: 'COMPLETED', amount: 100 }
                    ]
                };
                await updateFirebaseUser(phone, dbUser);
            }

            res.cookie('auth_phone', phone, { maxAge: 86400 * 1000 * 7, httpOnly: true });
            res.cookie('user_session', 'true', { maxAge: 86400 * 1000 * 7, httpOnly: true });
            res.clearCookie('auth_hash');
            res.clearCookie('auth_expiry');

            return res.json({ status: true, message: 'Login successful' });
        } else {
            return res.json({ status: false, message: 'Invalid OTP code' });
        }
    }
    return res.json({ status: false, message: 'Invalid operation parameters' });
});

// Fetch Dashboard Metrics & Real WhatsApp Node Status
router.get('/dashboard-data', checkAuth, async (req, res) => {
    const user = await getFirebaseUser(req.phone);
    if (!user) return res.json({ status: false, message: 'Session data invalid' });

    // Auto status checker from Render API if status is pending
    let whatsappStatus = user.whatsapp_connected || 'DISCONNECTED';
    if (whatsappStatus === 'PENDING' && user.whatsapp_user_id) {
        try {
            const statusUrl = `${MASTER_WHATSAPP_API}/status?userId=${user.whatsapp_user_id}`;
            const resStatus = await fetch(statusUrl);
            const statusResult = await resStatus.json();
            
            if (statusResult && statusResult.connected === true) {
                whatsappStatus = 'CONNECTED';
                const dynamicApiKey = 'easyotp_' + crypto.randomBytes(12).toString('hex');
                await updateFirebaseUser(req.phone, {
                    whatsapp_connected: 'CONNECTED',
                    api_key: dynamicApiKey
                });
                user.api_key = dynamicApiKey;
            }
        } catch (e) {
            console.error("Uptime status API checker failed temporarily");
        }
    }

    return res.json({
        status: true,
        phone: req.phone,
        balance: user.balance || 0,
        total_otp: user.total_otp || 0,
        today_otp: user.today_otp || 0,
        today_spend: user.today_spend || 0,
        api_key: user.api_key || '',
        transactions: user.transactions || [],
        whatsapp_connected: whatsappStatus,
        whatsapp_number: user.whatsapp_number || '',
        pairing_code: user.pairing_code || '',
        active_sessions: whatsappStatus === 'CONNECTED' ? 1 : 0,
        success_rate: whatsappStatus === 'CONNECTED' ? 100 : 0,
        week_otp: user.today_otp || 0,
        month_otp: user.today_otp || 0
    });
});

// WHATSAPP STEP 1: Create Session & Request Pairing Code (Render APIs)
router.post('/whatsapp/connect', checkAuth, upload.none(), async (req, res) => {
    const pairingPhone = req.body.number.replace(/[^0-9]/g, '');
    if (!pairingPhone || pairingPhone.length < 10) {
        return res.json({ status: false, message: 'Valid 10-digit pairing number required' });
    }

    try {
        // 1. Create Session
        const createSessionUrl = `${MASTER_WHATSAPP_API}/create-session`;
        const resSession = await fetch(createSessionUrl);
        const sessionResult = await resSession.json();

        if (!sessionResult || !sessionResult.userId) {
            return res.json({ status: false, message: 'WhatsApp session allocation failed. Please retry.' });
        }

        const allocatedUserId = sessionResult.userId;

        // 2. Fetch Pair QR/Code
        const pairUrl = `${MASTER_WHATSAPP_API}/pair?userId=${allocatedUserId}&number=91${pairingPhone}`;
        const resPair = await fetch(pairUrl);
        const pairResult = await resPair.json();

        if (!pairResult || !pairResult.code) {
            return res.json({ status: false, message: 'Pairing generation limits exceeded. Try again.' });
        }

        // Save progress to Realtime Database
        await updateFirebaseUser(req.phone, {
            whatsapp_connected: 'PENDING',
            whatsapp_user_id: allocatedUserId,
            whatsapp_number: pairingPhone,
            pairing_code: pairResult.code
        });

        return res.json({
            status: true,
            pairing_code: pairResult.code,
            userId: allocatedUserId
        });

    } catch (e) {
        return res.json({ status: false, message: 'API dispatch error. Is render server sleeping?' });
    }
});

// WHATSAPP STEP 2: Disconnect Sessions (Render APIs)
router.post('/whatsapp/disconnect', checkAuth, async (req, res) => {
    const user = await getFirebaseUser(req.phone);
    if (!user || !user.whatsapp_user_id) {
        return res.json({ status: false, message: 'No active WhatsApp session linked' });
    }

    try {
        const disconnectUrl = `${MASTER_WHATSAPP_API}/disconnect?userId=${user.whatsapp_user_id}`;
        await fetch(disconnectUrl);
    } catch (e) {
        console.error("Render API disconnect error. Flushing database anyway.");
    }

    // Flush fields in Firebase Database Node
    await updateFirebaseUser(req.phone, {
        whatsapp_connected: 'DISCONNECTED',
        whatsapp_user_id: '',
        whatsapp_number: '',
        pairing_code: '',
        api_key: ''
    });

    return res.json({ status: true, message: 'WhatsApp disconnected successfully' });
});

// Wallet Recharge Logic
router.post('/recharge', checkAuth, upload.none(), async (req, res) => {
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
        return res.json({ status: false, message: 'Invalid recharge amount' });
    }

    const user = await getFirebaseUser(req.phone);
    if (!user) return res.json({ status: false, message: 'Record not found' });

    const updatedBalance = (user.balance || 0) + amount;
    const newTxn = {
        id: 'TXN-' + Math.floor(Math.random() * 9000000),
        date: new Date().toLocaleDateString(),
        type: 'UPI Instant Top-Up',
        status: 'COMPLETED',
        amount: amount
    };

    const txns = user.transactions || [];
    txns.unshift(newTxn);

    await updateFirebaseUser(req.phone, {
        balance: parseFloat(updatedBalance.toFixed(2)),
        transactions: txns
    });

    return res.json({ status: true, balance: updatedBalance });
});

// Logout Session Controller
router.post('/logout', (req, res) => {
    res.clearCookie('auth_phone');
    res.clearCookie('user_session');
    return res.json({ status: true });
});

module.exports = router;
