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

    const API_BASE_URL = 'https://velocitytechnosoft.com/api';

    let allTools = [];       // Full list loaded from server
    let activeCategory = 'all';

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
                body: JSON.stringify({ username, password })
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
            tool_name: toolName
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

    // --- SHOW DASHBOARD ---
    async function showDashboard(user) {
        welcomeText.textContent = user.username;
        loginSection.classList.remove('active');
        loginSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
        dashboardSection.classList.add('active');
        headerUser.classList.remove('hidden');
        showMsg(actionMsg, 'Loading tools...', '');

        try {
            // POST user_id so server can filter by user permissions
            const res = await fetch(`${API_BASE_URL}/get_tools`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: user.user_id })
            });
            const data = await res.json();

            // Show announcement banner if present
            showAnnouncement(data.announcement);

            if (data.success && data.tools.length > 0) {
                allTools = data.tools;
                buildCategoryTabs(allTools);
                renderGrid();
                actionMsg.textContent = '';
            } else {
                toolGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🛠️</div><p>No tools available yet.</p></div>`;
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
