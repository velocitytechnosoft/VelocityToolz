// Import the CryptoJS library + the cookie-core injection helper
importScripts('lib/crypto-js.min.js', 'lib/cookie-core.js');

// Must match API location
const API_BASE_URL = 'https://velocitytechnosoft.com/api';
// Secret key for AES encryption (must match your PHP scraper environment)
const AES_SECRET = 'YOUR_SUPER_SECRET_AES_KEY_2026';



// We need an addEventListener for modern MV3 message passing, or just onMessage.addListener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'access_tool') {
        handleToolAccess(request.tool_id, request.tool_name, request.hwid, sendResponse);
        return true; // Keep the message channel open for async response
    }
});

// --- IP SECURITY REMOVED ---
// IP checks have been disabled to prevent errors on dynamic IP networks.

async function handleToolAccess(toolId, toolName, hwid, sendResponse) {
    try {

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
                tool_id: toolId,
                hwid: hwid
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

        // 3. Decrypt the payload into a cookie array (no mock fallback — a failure is a real failure)
        let cookiesArray = [];
        try {
            const bytes = CryptoJS.AES.decrypt(encryptedPayload, AES_SECRET);
            const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
            if (!decryptedString) throw new Error('empty decryption result');
            cookiesArray = JSON.parse(decryptedString);
        } catch (error) {
            console.error('Cookie decryption/parse failed:', error);
            sendResponse({
                success: false,
                message: `Could not read the saved session for ${toolName}. Re-capture its cookies in the admin panel (and check the AES key matches).`
            });
            return;
        }

        if (!Array.isArray(cookiesArray) || cookiesArray.length === 0) {
            sendResponse({
                success: false,
                message: `No session is saved for ${toolName} yet. Capture its cookies in the admin panel first.`
            });
            return;
        }

        // 4. Validate + normalize the cookies for this tool's own domain
        const cleanDomain = targetDomain.startsWith('.') ? targetDomain.substring(1) : targetDomain;

        const { prepared, skippedExpired, skippedInvalid } = CookieCore.prepareImport(cookiesArray, {
            allowedRoots: allowedRootsFor(cleanDomain),  // tool domain (+ google.com for Google tools)
            minimumDays: 30                               // keep shared sessions alive at least ~30 days
        });

        if (prepared.length === 0) {
            sendResponse({
                success: false,
                message: `The saved ${toolName} session looks expired or invalid (${skippedExpired} expired, ${skippedInvalid} invalid). Please re-capture its cookies.`
            });
            return;
        }

        // 5. Clear any conflicting cookies, then inject + verify
        await clearDomainCookies("http://" + cleanDomain);
        await clearDomainCookies("https://" + cleanDomain);

        let injected = 0;
        let failed = 0;
        for (const item of prepared) {
            try {
                const set = await chrome.cookies.set(item.details);
                if (set) {
                    injected++;
                    const issues = CookieCore.verifyCookie(set, item.expected);
                    if (issues.length) {
                        console.debug(`Cookie ${item.details.name} set with differences:`, issues);
                    }
                } else {
                    failed++;
                    console.warn(`chrome.cookies.set returned null for ${item.details.name}`);
                }
            } catch (err) {
                failed++;
                console.warn(`Failed to set cookie ${item.details.name}:`, err.message);
            }
        }

        if (injected === 0) {
            sendResponse({
                success: false,
                message: `Could not apply the ${toolName} session (${failed} cookies failed). Check the admin capture format.`
            });
            return;
        }
        console.log(`VelocityTool: injected ${injected}/${prepared.length} cookies for ${toolName} (failed ${failed}, skipped ${skippedExpired} expired / ${skippedInvalid} invalid).`);

        // 6. Small delay to let Chrome fully commit all cookies before opening the page
        await new Promise(resolve => setTimeout(resolve, 400));

        // 7. Open new tab to the tool
        if (redirectUrl && redirectUrl.trim() !== '') {
            chrome.tabs.create({ url: redirectUrl.trim() });
        } else {
            chrome.tabs.create({ url: "https://" + cleanDomain });
        }

        sendResponse({ success: true });

        // 8. Fire-and-forget: Log this access for admin activity tracking
        fetch(`${API_BASE_URL}/log_access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: user.user_id,
                token: user.token,
                tool_id: toolId,
                hwid: hwid
            })
        }).catch(() => { }); // Silent failure — never block the user

    } catch (error) {
        console.error('Handle Tool Error:', error);
        sendResponse({ success: false, message: 'Crash: ' + error.message });
    }
}

// Which cookie domains are allowed for a given tool domain.
// Google apps (labs.google, gemini.google.com, flow.google.com, ...) authenticate
// with cookies on .google.com, so those tools also allow google.com.
function allowedRootsFor(toolDomain) {
    const d = String(toolDomain || '').replace(/^\./, '').toLowerCase();
    const roots = new Set();
    if (d) roots.add(d);
    const isGoogle = d === 'google.com' || d.endsWith('.google.com') || d === 'labs.google' || d.endsWith('.google');
    if (isGoogle) roots.add('google.com');
    return [...roots];
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
