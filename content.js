// VelocityTool Content Script
// Runs on the premium tool pages. Protects the SHARED account from accidental
// changes by teammates: hides/disables logout, billing and subscription controls.
// This is client-side UI protection only (on your own account) — it does not
// touch the provider's security.

// --- CSS selectors for account menus / logout / billing entry points ---
const selectorsToHide = [
    // Ahrefs
    '.account-dropdown',
    'a[href*="/user/logout"]',
    'a[href*="/account/"]',
    'a[href*="/user/subscription"]',

    // Semrush
    '.s-header-dropdown--profile',
    'a[data-ui-name="Logout"]',
    'a[href*="/billing"]',
    'a[href*="/subscriptions"]',
    'a[href*="account.semrush.com"]'
];

// Link/button TEXT that signals a dangerous action (matched case-insensitively).
const DANGER_TEXT = /(log\s*out|sign\s*out|logout|billing|subscription|cancel\s*plan|payment\s*method)/i;

// URL fragments that must never be opened on a shared account.
const BLOCKED_URL = /(log\s*-?\s*out|logout|sign\s*-?\s*out|signout|\/billing|subscription|\/payment)/i;

// Inject a stylesheet so hidden elements disappear instantly (no flash of a
// visible logout button before the JS runs).
function injectHideStyle() {
    if (document.getElementById('vt-hide-style')) return;
    const style = document.createElement('style');
    style.id = 'vt-hide-style';
    style.textContent = selectorsToHide.join(',') + '{display:none !important;visibility:hidden !important;}'
        + '[data-vt-hidden="1"]{display:none !important;visibility:hidden !important;}';
    (document.head || document.documentElement).appendChild(style);
}

// Hide any link/button whose visible text matches a dangerous action.
function hideByText() {
    const clickables = document.querySelectorAll('a,button,[role="menuitem"]');
    clickables.forEach(el => {
        if (el.getAttribute('data-vt-hidden') === '1') return;
        const text = (el.textContent || '').trim();
        if (text && text.length <= 40 && DANGER_TEXT.test(text)) {
            el.setAttribute('data-vt-hidden', '1');
        }
    });
}

function securePage() {
    injectHideStyle();
    hideByText();

    // Floating "active" badge
    if (document.body && !document.getElementById('vt-badge')) {
        const badge = document.createElement('div');
        badge.id = 'vt-badge';
        badge.textContent = '🛡️ VelocityTool Active';
        badge.style.cssText = `
            position: fixed; bottom: 20px; left: 20px;
            background: #4f46e5; color: white;
            padding: 8px 12px; border-radius: 8px;
            font-size: 12px; font-family: Arial, sans-serif;
            z-index: 999999; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            pointer-events: none; opacity: 0.8;
        `;
        document.body.appendChild(badge);
    }
}

// --- Click guard: block navigation to logout / billing even if a control slips through ---
function showBlockedToast() {
    let toast = document.getElementById('vt-blocked-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'vt-blocked-toast';
        toast.style.cssText = `
            position: fixed; bottom: 60px; left: 20px;
            background: #b91c1c; color: #fff;
            padding: 10px 14px; border-radius: 8px;
            font-size: 12px; font-family: Arial, sans-serif;
            z-index: 1000000; box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            max-width: 260px; line-height: 1.4;
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = '🔒 Disabled to protect the shared team account.';
    toast.style.opacity = '1';
    clearTimeout(showBlockedToast._t);
    showBlockedToast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('a,button,[role="menuitem"]');
    if (!link) return;
    const href = (link.getAttribute && link.getAttribute('href')) || '';
    const text = (link.textContent || '').trim();
    const dangerous =
        (href && BLOCKED_URL.test(href)) ||
        (text && text.length <= 40 && DANGER_TEXT.test(text));
    if (dangerous) {
        e.preventDefault();
        e.stopPropagation();
        showBlockedToast();
    }
}, true); // capture phase so we run before the page's own handlers

// Run immediately, and keep re-running as SPA content changes.
document.addEventListener('DOMContentLoaded', securePage);

const observer = new MutationObserver(() => securePage());
if (document.body) {
    securePage();
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    // Hide ASAP even before <body> exists, then start observing on load.
    injectHideStyle();
    window.addEventListener('load', () => {
        observer.observe(document.body, { childList: true, subtree: true });
        securePage();
    });
}
