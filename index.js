const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const app = express();

// Middlewares for parsing incoming requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serves all static HTML / CSS / JS files from the root directory
app.use(express.static(__dirname));

// Mount the Firebase + WhatsApp API Route router
const apiRouter = require('./routes/api');
app.use('/api', apiRouter);

// Premium Session Auto-Routing: Root domain auto-checker
app.get('/', (req, res) => {
    const phone = req.cookies.auth_phone;
    const session = req.cookies.user_session;

    if (phone && session === 'true') {
        // Logged-in users are redirected to the home dashboard
        return res.redirect('/home.html');
    }
    // Unauthenticated users are redirected to the login interface
    return res.redirect('/login.html');
});

// Helper routes to keep URLs clean without .html extension
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

// Dynamic Wildcard Page Not Found Handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'login.html')); // Fallback to login
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Core easy-otp server executing on port ${PORT}`);
});

module.exports = app; // Mandatory for Vercel deployment handler
