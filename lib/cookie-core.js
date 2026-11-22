/**
 * VelocityToolz — cookie-core
 * Robust, standards-aware helper for injecting a saved session via chrome.cookies.set().
 *
 * It builds correct cookie details (host-only vs domain, __Host-/__Secure- prefixes,
 * SameSite, path, expiration), validates each cookie against the tool's own domain,
 * drops expired/invalid entries, and verifies what actually landed in the jar.
 *
 * Plain, readable code on purpose — no obfuscation. Exposes a global `CookieCore`.
 */
(function (root) {
    "use strict";

    const DAY = 86400;
    const MAX_DAYS = 400; // Chrome caps persistent cookie lifetime at ~400 days
    const SAME_SITE = new Set(["no_restriction", "lax", "strict", "unspecified"]);

    function cleanDomain(d) {
        return String(d || "").trim().toLowerCase().replace(/^\.+/, "");
    }

    // Only allow cookies that belong to one of the allowed roots (or a subdomain
    // of one). Google tools, for example, pass both "labs.google" and "google.com"
    // because the session cookies live on .google.com.
    function isAllowedDomain(domain, roots) {
        if (!roots || roots.length === 0) return true; // no restriction
        return roots.some(function (r) {
            return domain === r || domain.endsWith("." + r);
        });
    }

    function normSameSite(v) {
        if (v === null || v === undefined || v === "") return undefined;
        let s = String(v).toLowerCase().replace(/-/g, "_");
        if (s === "none") s = "no_restriction";
        return SAME_SITE.has(s) ? s : undefined;
    }

    // Keep the original expiry when present; optionally extend short-lived cookies
    // to at least `minimumDays` so a shared session doesn't die the same day.
    function resolveExpiration(cookie, minimumDays, now) {
        if (cookie.session === true) return undefined;
        const orig = Number(cookie.expirationDate);
        const hasOrig = Number.isFinite(orig) && orig > 0;
        const cap = now + MAX_DAYS * DAY;
        const days = Number(minimumDays);

        if (!Number.isFinite(days) || days <= 0) {
            return hasOrig ? Math.min(orig, cap) : undefined;
        }
        const minExp = now + Math.min(days, MAX_DAYS) * DAY;
        return hasOrig ? Math.min(Math.max(orig, minExp), cap) : minExp;
    }

    // Turn one exported cookie object into { details, expected }.
    // `details` is passed straight to chrome.cookies.set(); `expected` is for verify.
    function buildSetDetails(cookie, options) {
        options = options || {};
        const now = Number.isFinite(options.nowSeconds) ? options.nowSeconds : Date.now() / 1000;

        const name = String(cookie.name || "").trim();
        if (!name) throw new Error("cookie has no name");

        const dom = cleanDomain(cookie.domain);
        if (!dom) throw new Error("cookie has no domain");
        const roots = Array.isArray(options.allowedRoots)
            ? options.allowedRoots
            : (options.allowedRoot ? [options.allowedRoot] : []);
        if (roots.length && !isAllowedDomain(dom, roots)) {
            throw new Error("domain " + dom + " is not in the allowed set");
        }

        const isHostPrefix = name.startsWith("__Host-");
        const isSecurePrefix = name.startsWith("__Secure-");

        // If the export omits hostOnly, infer it: a leading dot means a domain cookie.
        const rawDomain = String(cookie.domain || "");
        const inferredHostOnly = !rawDomain.startsWith(".");
        const hostOnly = isHostPrefix
            ? true
            : (typeof cookie.hostOnly === "boolean" ? cookie.hostOnly : inferredHostOnly);

        const path = isHostPrefix
            ? "/"
            : (typeof cookie.path === "string" && cookie.path.startsWith("/") ? cookie.path : "/");

        const sameSite = normSameSite(cookie.sameSite);
        const secure = Boolean(cookie.secure) || isHostPrefix || isSecurePrefix || sameSite === "no_restriction";

        const details = {
            url: "https://" + dom + path,
            name: name,
            value: (cookie.value !== undefined && cookie.value !== null) ? String(cookie.value) : "",
            path: path,
            secure: secure,
            httpOnly: Boolean(cookie.httpOnly)
        };
        // Host-only cookies MUST NOT carry a domain attribute.
        if (!hostOnly) details.domain = "." + dom;
        if (sameSite) details.sameSite = sameSite;

        const exp = resolveExpiration(cookie, options.minimumDays, now);
        if (exp !== undefined) details.expirationDate = exp;

        return {
            details: details,
            expected: {
                domain: dom,
                hostOnly: hostOnly,
                path: path,
                secure: secure,
                httpOnly: Boolean(cookie.httpOnly),
                sameSite: sameSite || "unspecified"
            }
        };
    }

    // Validate + normalize a whole array; skip expired/invalid; de-duplicate.
    function prepareImport(cookies, options) {
        options = options || {};
        const now = Date.now() / 1000;
        const list = Array.isArray(cookies) ? cookies : (cookies && cookies.cookies) || [];
        const prepared = [];
        const seen = new Set();
        let skippedExpired = 0;
        let skippedInvalid = 0;

        for (const c of list) {
            if (!c || typeof c !== "object") { skippedInvalid++; continue; }
            const exp = Number(c.expirationDate);
            if (c.session !== true && Number.isFinite(exp) && exp > 0 && exp <= now) {
                skippedExpired++;
                continue;
            }
            try {
                const item = buildSetDetails(c, Object.assign({}, options, { nowSeconds: now }));
                const key = [item.details.name, item.expected.domain, item.expected.hostOnly, item.expected.path].join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                prepared.push(item);
            } catch (e) {
                skippedInvalid++;
            }
        }
        return { prepared: prepared, skippedExpired: skippedExpired, skippedInvalid: skippedInvalid };
    }

    // Compare what chrome.cookies.set() returned against what we asked for.
    // Returns a list of mismatched attribute names (empty = perfect).
    function verifyCookie(actual, expected) {
        const problems = [];
        if (!actual) return ["missing"];
        if (actual.domain.replace(/^\./, "") !== expected.domain) problems.push("domain");
        if (actual.hostOnly !== expected.hostOnly) problems.push("hostOnly");
        if (actual.path !== expected.path) problems.push("path");
        if (actual.secure !== expected.secure) problems.push("secure");
        if (actual.httpOnly !== expected.httpOnly) problems.push("httpOnly");
        return problems;
    }

    root.CookieCore = { buildSetDetails: buildSetDetails, prepareImport: prepareImport, verifyCookie: verifyCookie };
})(self);
