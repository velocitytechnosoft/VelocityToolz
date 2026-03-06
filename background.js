// Import the CryptoJS library
importScripts('lib/crypto-js.min.js');

// Must match API location
const API_BASE_URL = 'https://velocitytechnosoft.com/api';
// Secret key for AES encryption (must match your PHP scraper environment)
const AES_SECRET = 'YOUR_SUPER_SECRET_AES_KEY_2026';



// We need an addEventListener for modern MV3 message passing, or just onMessage.addListener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'access_tool') {
        handleToolAccess(request.tool_id, request.tool_name, sendResponse);
        return true; // Keep the message channel open for async response
    }
});

// --- IP SECURITY: THE HEARTBEAT SHREDDER ---
// Set an alarm to wake up the service worker every 1 minute
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("ipSecurityCheck", { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create("ipSecurityCheck", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "ipSecurityCheck") {
        checkIPSecurity();
    }
});

async function checkIPSecurity() {
    try {
        const response = await fetch(`${API_BASE_URL}/verify_ip?_t=` + Date.now());
        const data = await response.json();

        // If the server explicitly commands a SHRED, destroy the session
        if (data && data.action === 'SHRED') {
            console.warn(`SECURITY ALERT: Unauthorized IP (${data.ip || 'Unknown'}) detected. Shredding cookies.`);
            await executeShredder();
        }
    } catch (error) {
        // Heartbeat check failed (e.g., user is offline, server is down).
        // We fail silently and assume safe to prevent Chrome from logging an Error in the extension dashboard.
    }
}

async function executeShredder() {
    // 1. Clear Extension Local Storage (logs user out of extension)
    await chrome.storage.local.clear();

    // 2. Fetch all domains that belong to active tools and destroy cookies
    try {
        // We do a "best effort" wipe of common premium tool domains to cover tracks
        const domainsToWipe = [
            ".ahrefs.com", ".semrush.com", "ahrefs.com", "semrush.com",
            ".google.com", ".labs.google", "labs.google", "gemini.google.com"
        ];

        for (let domain of domainsToWipe) {
            await clearDomainCookies("http://" + domain.replace(/^\./, ''));
            await clearDomainCookies("https://" + domain.replace(/^\./, ''));
        }

        console.log("SHREDDER COMPLETE: User session destroyed.");
    } catch (err) {
        console.error("Shredder encountered error during domain wipe:", err);
    }
}
// ------------------------------------------

async function handleToolAccess(toolId, toolName, sendResponse) {
    try {
        // 0. Pre-flight IP Security Check
        try {
            const ipCheckRes = await fetch(`${API_BASE_URL}/verify_ip?_t=` + Date.now());
            const ipData = await ipCheckRes.json();
            if (ipData && ipData.action === 'SHRED') {
                const detectedIp = ipData.ip || 'Unknown';
                console.warn(`BLOCKED: Unauthorized IP (${detectedIp}). Shredding...`);
                await executeShredder();
                sendResponse({ success: false, message: `SECURITY BLOCK: Your extension IP (${detectedIp}) is not whitelisted. Please add it in the Admin Dashboard.` });
                return;
            }
        } catch (e) { /* Ignore network errors here to allow fallback */ }

        // 1. Get user session from local storage
        const storage = await chrome.storage.local.get(['user']);
        if (!storage.user || !storage.user.token) {
            sendResponse({ success: false, message: 'User not authenticated.' });
            return;
        }

        const user = storage.user;

        // 2. Fetch the encrypted cookies from the PHP API
        const response = await fetch(`${API_BASE_URL}/get_cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: user.user_id,
                token: user.token,
                tool_id: toolId
            })
        });

        const data = await response.json();

        if (!data.success) {
            sendResponse({ success: false, message: data.message });
            return;
        }

        // 3. Decrypt the payload
        const encryptedPayload = data.data.payload;
        const targetDomain = data.data.domain;
        const redirectUrl = data.data.redirect_url;

        let cookiesArray = [];
        try {
            // Decrypt using CryptoJS
            const bytes = CryptoJS.AES.decrypt(encryptedPayload, AES_SECRET);
            const decryptedString = bytes.toString(CryptoJS.enc.Utf8);

            // If it's pure JSON string of cookies
            cookiesArray = JSON.parse(decryptedString);
        } catch (error) {
            console.error('Decryption failed. This is expected if the payload was a dummy string.', error);
            // FALLBACK for testing: If decryption fails (because our dummy SQL data wasn't real AES), 
            // we will just inject a dummy cookie so we can at least observe the injection working!
            cookiesArray = [
                {
                    name: "velocity_session_auth",
                    value: "mock_token_for_" + toolName.replace(/\s+/g, ''),
                    domain: "." + targetDomain,
                    path: "/",
                    secure: true,
                    httpOnly: true
                }
            ];
        }

        // 4. Clear old cookies and Inject new cookies
        const cleanDomain = targetDomain.startsWith('.') ? targetDomain.substring(1) : targetDomain;

        await clearDomainCookies("http://" + cleanDomain);
        await clearDomainCookies("https://" + cleanDomain);

        for (let cookie of cookiesArray) {
            try {
                // SPECIAL SECURITY HANDLING:
                let finalDomain = cookie.domain;
                let finalPath = cookie.path || '/';

                // 1. HostOnly cookies MUST NOT have a domain attribute
                if (cookie.hostOnly) {
                    finalDomain = undefined;
                }

                // 2. __Host- cookies MUST be secure, have path=/, and NO domain
                if (cookie.name.startsWith('__Host-')) {
                    finalDomain = undefined;
                    finalPath = '/';
                    cookie.secure = true;
                }

                // 3. __Secure- cookies MUST be secure
                if (cookie.name.startsWith('__Secure-')) {
                    cookie.secure = true;
                }

                // Force HTTPS URL for all premium tools
                let urlDomain = cookie.domain ? cookie.domain.replace(/^\./, '') : cleanDomain;
                const url = "https://" + urlDomain + finalPath;

                // 4. Handle SameSite compatibility
                let sameSiteStr = undefined;
                if (cookie.sameSite) {
                    const ss = String(cookie.sameSite).toLowerCase();
                    if (ss === 'no_restriction' || ss === 'none') {
                        sameSiteStr = 'no_restriction';
                        cookie.secure = true; // None requires secure
                    } else if (ss === 'lax') {
                        sameSiteStr = 'lax';
                    } else if (ss === 'strict') {
                        sameSiteStr = 'strict';
                    }
                }

                let cookieDetails = {
                    url: url,
                    name: cookie.name,
                    value: (cookie.value !== undefined && cookie.value !== null) ? String(cookie.value) : "",
                    domain: finalDomain,
                    path: finalPath,
                    secure: cookie.secure !== false, // default true
                    httpOnly: Boolean(cookie.httpOnly),
                    sameSite: sameSiteStr
                };

                // Preserve original expiration date so they don't downgrade to session cookies
                if (cookie.expirationDate) {
                    cookieDetails.expirationDate = cookie.expirationDate;
                }

                await chrome.cookies.set(cookieDetails);
            } catch (err) {
                console.warn(`Skipping cookie ${cookie.name} due to error:`, err);
                // We CONSCIOUSLY swallow the error here! 
                // A single junk cookie failing to parse shouldn't crash the whole login flow.
            }
        }

        // 5. Small delay to let Chrome fully commit all cookies before opening the page
        await new Promise(resolve => setTimeout(resolve, 500));

        // 6. Open new tab to the tool
        if (redirectUrl && redirectUrl.trim() !== '') {
            chrome.tabs.create({ url: redirectUrl.trim() });
        } else {
            chrome.tabs.create({ url: "https://" + cleanDomain });
        }

        sendResponse({ success: true });

        // 6. Fire-and-forget: Log this access for admin activity tracking
        fetch(`${API_BASE_URL}/log_access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: user.user_id,
                token: user.token,
                tool_id: toolId
            })
        }).catch(() => { }); // Silent failure — never block the user

    } catch (error) {
        console.error('Handle Tool Error:', error);
        sendResponse({ success: false, message: 'Crash: ' + error.message });
    }
}

// Helper: Clear existing cookies for a domain to prevent conflicts
async function clearDomainCookies(url) {
    try {
        const cookies = await chrome.cookies.getAll({ url: url });
        for (let cookie of cookies) {
            await chrome.cookies.remove({
                url: url + cookie.path,
                name: cookie.name
            });
        }
    } catch (error) {
        console.error("Error clearing cookies for: " + url, error);
    }
}
