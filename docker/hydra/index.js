const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const session = require('express-session');

const app = express();
const port = 3001;

// Settings - explicitly specify IPv4 addresses
const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL || 'http://hydra:4444';  // For browser
const HYDRA_INTERNAL_URL = process.env.HYDRA_INTERNAL_URL || 'http://hydra:4444'; // For internal requests from container
const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL || 'http://hydra:4445';      // IPv4 for admin API
const CLIENT_ID = process.env.CLIENT_ID || 'web';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'web-secret';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://127.0.0.1:3001/callback';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3001';

console.log('App settings:');
console.log('HYDRA_PUBLIC_URL:', HYDRA_PUBLIC_URL);
console.log('HYDRA_INTERNAL_URL:', HYDRA_INTERNAL_URL);
console.log('HYDRA_ADMIN_URL:', HYDRA_ADMIN_URL);
console.log('CLIENT_ID:', CLIENT_ID);
console.log('REDIRECT_URI:', REDIRECT_URI);
console.log('APP_URL:', APP_URL);

app.use(session({
    secret: 'your-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000 // 1 hour
    }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Middleware for debugging cookies and sessions
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
        sessionID: req.sessionID,
        cookies: req.headers.cookie,
        session: req.session
    });
    next();
});

// ============= OAuth2 Client part =============

// Main page
app.get('/', (req, res) => {
    const token = req.session.token;
    const loginChallenge = req.query.login_challenge;
    const loginError = req.query.error;

    // If there is a login_challenge, show the login form
    if (loginChallenge) {
        return res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Login - OAuth2</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h2 { color: #333; margin-bottom: 20px; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; background: #007bff; color: white; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .info { background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
        .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Login</h2>
        ${loginError ? `<div class="error">${loginError}</div>` : ''}
        <form method="POST" action="/auth/login">
            <input type="hidden" name="challenge" value="${loginChallenge}">
            <input type="email" name="email" placeholder="Email" value="test@example.com" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>
        `);
    }

    // Regular main page
    let content = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth2 Demo</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
        .button:hover { background: #0056b3; }
        .token-info { background: #f8f9fa; padding: 20px; margin-top: 20px; border-radius: 4px; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
        .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 4px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>OAuth2 Demo Application</h1>`;

    if (token) {
        // Decode JWT
        let claims = {};
        try {
            const parts = token.access_token.split('.');
            if (parts.length === 3) {
                claims = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            }
        } catch (e) {
            // Opaque token
        }

        content += `
        <div class="success">
            <h3>✅ You are logged in!</h3>
        </div>
        <div class="token-info">
            <p><strong>Access Token:</strong></p>
            <pre>${token.access_token}</pre>
            <p><strong>Token Type:</strong> ${token.token_type}</p>
            <p><strong>Expires In:</strong> ${token.expires_in} seconds</p>
            ${token.refresh_token ? `<p><strong>Refresh Token:</strong></p><pre>${token.refresh_token}</pre>` : ''}
            ${claims.sub ? `
            <hr>
            <h4>Information from token:</h4>
            <p><strong>User ID:</strong> ${claims.sub}</p>
            <p><strong>Email:</strong> ${claims.ext.traits?.email || 'N/A'}</p>
            <p><strong>Roles:</strong> ${JSON.stringify(claims.ext.traits?.roles || [])}</p>
            <p><strong>Scope:</strong> ${JSON.stringify(claims.scp)}</p>
            <p><strong>Issued At:</strong> ${new Date(claims.iat * 1000).toLocaleString()}</p>
            <p><strong>Expires At:</strong> ${new Date(claims.exp * 1000).toLocaleString()}</p>
            ` : ''}
        </div>

        <form action="/logout" method="post" style="margin-top: 20px;">
            <button type="submit" class="button" style="background: #dc3545;">Logout</button>
        </form>`;
    } else {
        content += `
        <p>This is a demo application for testing OAuth2 flow with Ory Hydra.</p>
        <p>Click the button below to start the authorization process.</p>
        <form action="/start-oauth" method="post">
            <label>Scopes (separated by space):</label>
            <input name="scope" value="openid offline users:read products:read orders:read" />
            <button type="submit" class="button">Start OAuth2 Authorization</button>
        </form>`;
    }

    content += `
    </div>
</body>
</html>`;

    res.send(content);
});

// Start OAuth2 flow
app.post('/start-oauth', (req, res) => {
    const scope = req.body.scope || 'openid offline';
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

    // Save in session
    req.session.oauth = { state, verifier };
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
        }
    });

    console.log('Starting OAuth flow:', {
        state,
        sessionID: req.sessionID,
        session: req.session
    });

    // Redirect to Hydra
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: scope,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    const authUrl = `${HYDRA_PUBLIC_URL}/oauth2/auth?${params}`;
    console.log('Redirecting to:', authUrl);

    res.redirect(authUrl);
});

// OAuth2 callback
app.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    console.log('Callback received:', { code: code?.substring(0, 10) + '...', state, error });
    console.log('Session oauth:', req.session.oauth);
    console.log('Session ID:', req.sessionID);

    if (error) {
        return res.send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Authorization Error</h2>
                <p><strong>Error:</strong> ${error}</p>
                <p><strong>Description:</strong> ${error_description || ''}</p>
                <a href="/">← Back</a>
            </div>
        `);
    }

    if (!req.session.oauth) {
        console.error('No OAuth session found');
        return res.status(400).send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Session Error</h2>
                <p>OAuth session not found. Please try again.</p>
                <a href="/">← Back</a>
            </div>
        `);
    }

    if (req.session.oauth.state !== state) {
        console.error('State mismatch:', {
            expected: req.session.oauth.state,
            received: state
        });
        return res.status(400).send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Security Error</h2>
                <p>Invalid state parameter</p>
                <p><small>Expected: ${req.session.oauth.state}</small></p>
                <p><small>Received: ${state}</small></p>
                <a href="/">← Back</a>
            </div>
        `);
    }

    try {
        // Exchange code for tokens - use INTERNAL URL for server-to-server
        const tokenResponse = await axios.post(
            `${HYDRA_INTERNAL_URL}/oauth2/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code_verifier: req.session.oauth.verifier
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        req.session.token = tokenResponse.data;
        delete req.session.oauth;

        res.redirect('/');
    } catch (error) {
        console.error('Token exchange error:', error.response?.data || error);
        res.status(500).send(`
            <div style="max-width: 600px; margin: 50px auto; padding: 20px;">
                <h2>Token Retrieval Error</h2>
                <pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>
                <a href="/">← Back</a>
            </div>
        `);
    }
});

// ============= Login/Consent Provider part =============

// Login handler
app.post('/auth/login', async (req, res) => {
    const { email, password, challenge } = req.body;

    try {
        // 1. Get login flow from Kratos
        const flowResp = await axios.get('http://kratos:4433/self-service/login/api');
        const flowId = flowResp.data.id;

        // 2. Submit login credentials to Kratos
        const kratosResponse = await axios.post(
            `http://kratos:4433/self-service/login?flow=${flowId}`,
            {
                method: 'password',
                identifier: email,
                password: password
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        // If login is successful, use the entered email as subject
        const userId = email;

        // Save Kratos identity traits in session for consent
        if (kratosResponse.data && kratosResponse.data.session && kratosResponse.data.session.identity) {
            req.session.userTraits = kratosResponse.data.session.identity.traits;
        } else {
            req.session.userTraits = { email };
        }

        // Accept login in Hydra
        const acceptResponse = await axios.put(
            `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/login/accept?login_challenge=${challenge}`,
            {
                subject: userId,
                remember: true,
                remember_for: 3600,
                acr: '0'
            }
        );

        return res.redirect(acceptResponse.data.redirect_to);
    } catch (error) {
        let errorMsg = 'Login failed';
        if (error.response && error.response.data) {
            if (typeof error.response.data === 'string') {
                errorMsg = error.response.data;
            } else if (error.response.data.error && error.response.data.error.message) {
                errorMsg = error.response.data.error.message;
            } else if (error.response.data.message) {
                errorMsg = error.response.data.message;
            } else if (error.response.data.ui && error.response.data.ui.messages && error.response.data.ui.messages.length > 0) {
                errorMsg = error.response.data.ui.messages.map(m => m.text).join(' ');
            }
        }
        console.error('Login error:', error.response?.data || error);
        res.redirect(`/?login_challenge=${challenge}&error=${encodeURIComponent(errorMsg)}`);
    }
});

// Login endpoint for Hydra
app.get('/login', async (req, res) => {
    const { login_challenge } = req.query;

    if (!login_challenge) {
        // If no challenge, redirect to main
        return res.redirect('/');
    }

    // Redirect to main with challenge
    res.redirect(`/?login_challenge=${login_challenge}`);
});

// Consent endpoint - automatically grant consent
app.get('/consent', async (req, res) => {
    const { consent_challenge } = req.query;

    if (!consent_challenge) {
        return res.status(400).send('Missing consent_challenge');
    }

    try {
        // Get consent request
        const consentRequest = await axios.get(
            `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent?consent_challenge=${consent_challenge}`
        );

        // Use user traits from session if available
        const userTraits = req.session.userTraits || {
            email: 'test@example.com',
            name: 'Test User',
            roles: ['admin', 'user']
        };

        // Accept consent
        const acceptResponse = await axios.put(
            `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent/accept?consent_challenge=${consent_challenge}`,
            {
                grant_scope: consentRequest.data.requested_scope,
                grant_access_token_audience: consentRequest.data.requested_access_token_audience,
                remember: true,
                remember_for: 3600,
                session: {
                    access_token: {
                        email: userTraits.email,
                        traits: userTraits
                    },
                    id_token: {
                        email: userTraits.email,
                        name: userTraits.name,
                        traits: userTraits
                    }
                }
            }
        );

        return res.redirect(acceptResponse.data.redirect_to);
    } catch (error) {
        console.error('Consent error:', error.response?.data || error);
        res.status(500).send('Consent error');
    }
});

// ============= Additional endpoints =============

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(port, () => {
    console.log(`All-in-One OAuth2 App running at http://localhost:${port}`);
    console.log('This app serves as:');
    console.log('  - OAuth2 Client');
    console.log('  - Login Provider');
    console.log('  - Consent Provider');
});
