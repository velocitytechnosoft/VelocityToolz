document.addEventListener('DOMContentLoaded', () => {
    const loginSection = document.getElementById('login-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const loginForm = document.getElementById('login-form');
    const loginMsg = document.getElementById('login-msg');
    const actionMsg = document.getElementById('action-msg');
    const btnLogout = document.getElementById('btn-logout');
    const welcomeText = document.getElementById('welcome-text');
    const headerUser = document.getElementById('header-user');
    const searchInput = document.getElementById('search-input');
    const categoryTabs = document.getElementById('category-tabs');
    const toolGrid = document.getElementById('tool-grid');
    const btnCopyCookies = document.getElementById('btn-copy-cookies');
    const btnUploadSession = document.getElementById('btn-upload-session');
    const uploadToolSelect = document.getElementById('upload-tool-select');
    const cookieToast = document.getElementById('cookie-toast');

    let toastTimer = null;
    let currentUser = null;   // set on login/boot; used by admin upload

    function showCookieToast(text, type) {
        if (toastTimer) clearTimeout(toastTimer);
        cookieToast.textContent = text;
        cookieToast.className = `cookie-toast ${type}`;
        toastTimer = setTimeout(() => {
            cookieToast.classList.add('hidden');
        }, 4500);
    }

    // --- CAPTURE CURRENT TAB COOKIES (shared by Copy + Upload) ---
    // Returns { hostname, cookies } or throws with a user-friendly message.
    async function captureCurrentTabCookies() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
            throw new Error('Open the tool\'s website tab (http/https) first.');
        }

        const hostname = new URL(tab.url).hostname;

        // All cookies applicable to the active URL (includes parent domains like
        // .ahrefs.com) plus any scoped to the current hostname.
        const [urlCookies, domainCookies] = await Promise.all([
            chrome.cookies.getAll({ url: tab.url }),
            chrome.cookies.getAll({ domain: hostname })
        ]);

        const seen = new Set();
        const cookies = [];
        for (const c of [...urlCookies, ...domainCookies]) {
            const key = `${c.domain}|${c.path}|${c.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entry = {
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path,
                secure: c.secure,
                httpOnly: c.httpOnly,
                hostOnly: c.hostOnly,
                sameSite: c.sameSite
            };
            if (c.expirationDate) entry.expirationDate = c.expirationDate;
            cookies.push(entry);
        }

        if (cookies.length === 0) throw new Error(`No cookies found for ${hostname}.`);
        return { hostname, cookies };
    }

    // --- COPY CURRENT TAB COOKIES AS JSON ---
    btnCopyCookies.addEventListener('click', async () => {
        const originalLabel = btnCopyCookies.textContent;
        btnCopyCookies.disabled = true;
        btnCopyCookies.textContent = 'Copying...';
        try {
            const { hostname, cookies } = await captureCurrentTabCookies();
            const jsonStr = JSON.stringify(cookies, null, 2);
            try {
                await navigator.clipboard.writeText(jsonStr);
            } catch {
                const ta = document.createElement('textarea');
                ta.value = jsonStr;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            btnCopyCookies.textContent = '✅ Copied!';
            showCookieToast(`✅ Copied ${cookies.length} cookies from ${hostname}! Paste directly in Admin.`, 'success');
            setTimeout(() => { btnCopyCookies.textContent = originalLabel; }, 2000);
        } catch (err) {
            console.error('Cookie capture failed:', err);
            showCookieToast(err.message || 'Failed to capture cookies.', 'error');
            btnCopyCookies.textContent = originalLabel;
        } finally {
            btnCopyCookies.disabled = false;
            if (btnCopyCookies.textContent === 'Copying...') btnCopyCookies.textContent = originalLabel;
        }
    });

    // --- ADMIN: CAPTURE & UPLOAD CURRENT TAB SESSION TO SERVER ---
    btnUploadSession.addEventListener('click', async () => {
        if (!currentUser || !currentUser.token) {
            showCookieToast('Please log in first.', 'error');
            return;
        }
        const originalLabel = btnUploadSession.textContent;
        btnUploadSession.disabled = true;
        btnUploadSession.textContent = 'Uploading...';
        try {
            const toolId = uploadToolSelect ? uploadToolSelect.value : '';
            if (!toolId) {
                showCookieToast('Pick which tool to upload this session to first.', 'error');
                return;
            }

            const { hostname, cookies } = await captureCurrentTabCookies();

            const res = await fetch(`${API_BASE_URL}/admin_upload_session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.user_id,
                    token: currentUser.token,
                    tool_id: parseInt(toolId, 10),
                    domain: hostname,
                    cookies: cookies
                })
            });
            const data = await res.json();
            if (data.success) {
                btnUploadSession.textContent = '✅ Uploaded!';
                showCookieToast(`✅ ${data.message}`, 'success');
            } else {
                showCookieToast('Upload failed: ' + (data.message || 'Unknown error.'), 'error');
            }
            setTimeout(() => { btnUploadSession.textContent = originalLabel; }, 2000);
        } catch (err) {
            console.error('Session upload failed:', err);
            showCookieToast(err.message || 'Failed to upload session.', 'error');
            btnUploadSession.textContent = originalLabel;
        } finally {
            btnUploadSession.disabled = false;
            if (btnUploadSession.textContent === 'Uploading...') btnUploadSession.textContent = originalLabel;
        }
    });

    const API_BASE_URL = 'https://velocitytechnosoft.com/api';

    let allTools = [];       // Full list loaded from server
    let activeCategory = 'all';

    let deviceId = '';

    // --- INITIALIZE DEVICE ID ---
    chrome.storage.local.get(['device_id'], (res) => {
        if (res.device_id) {
            deviceId = res.device_id;
            bootSession();
        } else {
            // Generate a unique device ID
            deviceId = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0')).join('');
            chrome.storage.local.set({ device_id: deviceId }, () => {
                bootSession();
            });
        }
    });

    function bootSession() {
        // --- BOOT: Check stored session ---
        chrome.storage.local.get(['user'], (result) => {
            if (result.user && result.user.token) {
                // Check if session has expired (30 days)
                if (result.user.expires_at) {
                    const expiry = new Date(result.user.expires_at);
                    if (new Date() > expiry) {
                        // Session expired - force logout
                        chrome.storage.local.remove(['user']);
                        return; // Stay on login page
                    }
                }
                showDashboard(result.user);
            }
        });
    }

    // --- LOGIN ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const btnLogin = document.getElementById('btn-login');
        if (!username || !password) return;

        btnLogin.textContent = 'Logging in...';
        btnLogin.disabled = true;
        loginMsg.textContent = '';
        loginMsg.className = 'message';

        try {
            const res = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, hwid: deviceId })
            });
            const data = await res.json();
            if (data.success) {
                chrome.storage.local.set({ user: data.data }, () => showDashboard(data.data));
            } else {
                showMsg(loginMsg, data.message || 'Login failed.', 'error');
            }
        } catch {
            showMsg(loginMsg, 'Connection error. Check your network.', 'error');
        } finally {
            btnLogin.textContent = 'Login Securely →';
            btnLogin.disabled = false;
        }
    });

    // --- LOGOUT ---
    btnLogout.addEventListener('click', () => {
        chrome.storage.local.remove(['user'], () => {
            currentUser = null;
            if (btnUploadSession) btnUploadSession.classList.add('hidden');
            if (uploadToolSelect) { uploadToolSelect.classList.add('hidden'); uploadToolSelect.innerHTML = ''; }
            loginSection.classList.add('active');
            loginSection.classList.remove('hidden');
            dashboardSection.classList.add('hidden');
            dashboardSection.classList.remove('active');
            headerUser.classList.add('hidden');
            loginForm.reset();
        });
    });

    // --- SEARCH ---
    searchInput.addEventListener('input', () => renderGrid());

    // --- CATEGORY TAB CLICKS (event delegation) ---
    categoryTabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('cat-tab')) {
            document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.getAttribute('data-cat');
            renderGrid();
        }
    });

    // --- TOOL CARD CLICK (event delegation) ---
    toolGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.tool-card');
        if (!card || card.classList.contains('loading')) return;

        const toolId = card.getAttribute('data-tool-id');
        const toolName = card.getAttribute('data-tool-name');

        card.classList.add('loading');
        showMsg(actionMsg, `Accessing ${toolName}...`, '');

        chrome.runtime.sendMessage({
            action: 'access_tool',
            tool_id: toolId,
            tool_name: toolName,
            hwid: deviceId
        }, (response) => {
            card.classList.remove('loading');
            if (chrome.runtime.lastError) {
                showMsg(actionMsg, 'Error: Could not reach background worker.', 'error');
                return;
            }
            if (response && response.success) {
                card.classList.add('success');
                showMsg(actionMsg, `✅ Logged into ${toolName}!`, 'success');
                setTimeout(() => window.close(), 1200);
            } else {
                showMsg(actionMsg, response ? response.message : 'Failed to access tool.', 'error');
            }
        });
    });

    // --- ADMIN: load ALL tools into the upload picker ---
    async function loadAdminTools() {
        if (!uploadToolSelect || !currentUser) return;
        try {
            const res = await fetch(`${API_BASE_URL}/admin_list_tools`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.user_id, token: currentUser.token })
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.tools)) {
                uploadToolSelect.innerHTML = '<option value="">— Upload to… —</option>' +
                    data.tools.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
            }
        } catch (e) {
            // leave the picker with whatever it had
        }
    }

    // --- SHOW DASHBOARD ---
    async function showDashboard(user) {
        currentUser = user;
        // Admin-only: reveal the "Upload Session" controls + load the tool picker
        const isAdmin = Number(user.is_admin) === 1;
        if (btnUploadSession) btnUploadSession.classList.toggle('hidden', !isAdmin);
        if (uploadToolSelect) uploadToolSelect.classList.toggle('hidden', !isAdmin);
        if (isAdmin) loadAdminTools();
        welcomeText.textContent = user.username;
        loginSection.classList.remove('active');
        loginSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
        dashboardSection.classList.add('active');
        headerUser.classList.remove('hidden');
        showMsg(actionMsg, 'Loading tools...', '');

        try {
            // POST user_id and hwid so server can filter by user permissions and check device blocking
            const res = await fetch(`${API_BASE_URL}/get_tools`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: user.user_id, token: user.token, hwid: deviceId })
            });
            const data = await res.json();

            // Show announcement banner if present
            showAnnouncement(data.announcement);

            if (data.success && data.tools.length > 0) {
                allTools = data.tools;
                buildCategoryTabs(allTools);
                renderGrid();
                actionMsg.textContent = '';
            } else if (!data.success) {
                // Fatal server error (blocked device, session expired, etc.) — force logout
                const errorMsg = data.message || 'Access denied.';
                chrome.storage.local.remove(['user'], () => {
                    dashboardSection.classList.add('hidden');
                    dashboardSection.classList.remove('active');
                    loginSection.classList.remove('hidden');
                    loginSection.classList.add('active');
                    headerUser.classList.add('hidden');
                    showMsg(loginMsg, '🚫 ' + errorMsg, 'error');
                });
            } else {
                // Authenticated but no tools assigned yet
                toolGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🛠️</div><p>No tools assigned to your account yet. Contact your administrator.</p></div>`;
                actionMsg.textContent = '';
            }
        } catch {
            showMsg(actionMsg, 'Network error loading tools.', 'error');
        }
    }

    // --- ANNOUNCEMENT BANNER ---
    function showAnnouncement(announcement) {
        // Remove existing banner
        const existing = document.getElementById('announcement-banner');
        if (existing) existing.remove();

        if (!announcement || !announcement.message) return;

        const colorMap = {
            blue: { bg: 'rgba(99,102,241,0.15)', border: '#6366f1', text: '#a5b4fc' },
            green: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#6ee7b7' },
            red: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#fca5a5' },
            yellow: { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', text: '#fcd34d' },
        };
        const c = colorMap[announcement.color] || colorMap.blue;
        const banner = document.createElement('div');
        banner.id = 'announcement-banner';
        banner.style.cssText = `
            background: ${c.bg};
            border: 1px solid ${c.border};
            border-radius: 8px;
            color: ${c.text};
            font-size: 12px;
            font-weight: 500;
            padding: 9px 12px;
            margin-bottom: 12px;
            display: flex;
            gap: 7px;
            align-items: flex-start;
            line-height: 1.4;
        `;
        banner.innerHTML = `<span style="flex-shrink:0;">📢</span><span>${announcement.message}</span>`;
        dashboardSection.insertBefore(banner, dashboardSection.firstChild);
    }

    // --- BUILD CATEGORY TABS ---
    function buildCategoryTabs(tools) {
        // Collect unique categories
        const cats = [...new Set(tools.map(t => t.category || 'General'))].sort();

        // Clear existing dynamic tabs (keep "All")
        document.querySelectorAll('.cat-tab:not([data-cat="all"])').forEach(t => t.remove());

        cats.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'cat-tab';
            btn.setAttribute('data-cat', cat);
            btn.textContent = cat;
            categoryTabs.appendChild(btn);
        });
    }

    // --- RENDER GRID (filter by search + category) ---
    function renderGrid() {
        const query = searchInput.value.toLowerCase().trim();

        const filtered = allTools.filter(tool => {
            const matchesSearch = tool.name.toLowerCase().includes(query);
            const matchesCat = activeCategory === 'all' || (tool.category || 'General') === activeCategory;
            return matchesSearch && matchesCat;
        });

        toolGrid.innerHTML = '';

        if (filtered.length === 0) {
            toolGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No tools match your search.</p></div>`;
            return;
        }

        filtered.forEach(tool => {
            const card = document.createElement('div');
            card.className = 'tool-card';
            card.setAttribute('data-tool-id', tool.id);
            card.setAttribute('data-tool-name', tool.name);

            // Build icon: use icon_url if available, otherwise use first letter of name
            const iconHtml = tool.icon_url
                ? `<img class="tool-icon" src="${tool.icon_url}" alt="${escHtml(tool.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div class="tool-icon-fallback" style="display:none;">${tool.name.charAt(0).toUpperCase()}</div>`
                : `<div class="tool-icon-fallback">${tool.name.charAt(0).toUpperCase()}</div>`;

            card.innerHTML = `
                ${iconHtml}
                <span class="tool-name">${escHtml(tool.name)}</span>
            `;
            toolGrid.appendChild(card);
        });
    }

    function showMsg(el, text, type) {
        el.textContent = text;
        el.className = 'message' + (type === 'error' ? ' msg-error' : type === 'success' ? ' msg-success' : '');
    }

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
});
