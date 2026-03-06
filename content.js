// VelocityTool Content Script
// This script runs on the pages the user visits.

// List of selectors to hide (like logout buttons, billing pages, etc.)
// so the user cannot accidentally (or maliciously) alter the shared premium account.
const selectorsToHide = [
    // Ahrefs: hide account settings drop down
    '.account-dropdown',
    'a[href*="/user/logout"]',
    'a[href*="/user/settings"]',

    // Semrush: hide profile dropdown
    '.s-header-dropdown--profile',
    'a[data-ui-name="Logout"]',

    // General keywords for links
    'a:contains("Log out")',
    'a:contains("Sign out")',
    'a:contains("Billing")'
];

function securePage() {
    // Hide specific elements to protect the account
    selectorsToHide.forEach(selector => {
        try {
            // Very basic vanilla JS hiding. 
            // Often MutationObserver is used for SPAs (Single Page Apps).
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
            });
        } catch (e) {
            // Ignore invalid selectors for current page
        }
    });

    // We can also inject a floating badge to show it's active
    if (!document.getElementById('vt-badge')) {
        const badge = document.createElement('div');
        badge.id = 'vt-badge';
        badge.innerHTML = '🛡️ VelocityTool Active';
        badge.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: #4f46e5;
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            font-family: Arial, sans-serif;
            z-index: 999999;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            pointer-events: none;
            opacity: 0.8;
        `;
        document.body.appendChild(badge);
    }
}

// Run immediately and also on DOM element changes (for React/Vue apps)
document.addEventListener('DOMContentLoaded', securePage);

// A simple mutation observer to keep hiding elements as the user navigates SPAs
const observer = new MutationObserver((mutations) => {
    securePage();
});

// Start observing the target node for configured mutations
if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    // In case script runs before body
    window.addEventListener('load', () => {
        observer.observe(document.body, { childList: true, subtree: true });
        securePage();
    });
}
