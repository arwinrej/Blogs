/**
 * Green Journal — Real Views Counter
 * 
 * A lightweight, zero-dependency view counter designed for GitHub Pages.
 * - Out-of-the-box: Saves and counts views locally via localStorage.
 * - Production: When SUPABASE_URL and SUPABASE_KEY are provided, it automatically
 *   uses a free serverless Supabase database to track real global visitor counts.
 */

// ==========================================
// 1. DATABASE CONFIGURATION
// ==========================================
// Copy-paste your Supabase credentials here when ready to deploy.
// If left blank, the site will run in LocalStorage fallback mode automatically.
const SUPABASE_URL = "https://prtdxvclxjigrbypipvk.supabase.co";
const SUPABASE_KEY = "sb_publishable_ubAGDoqPnAuLFPruhZKg-w_1mYsQbm6";

// ==========================================
// 2. VIEWS ENGINE
// ==========================================
class RealViewCounter {
    constructor() {
        this.isSupabaseConfigured = SUPABASE_URL && SUPABASE_KEY;
        this.localStorageKey = "green_journal_views";
        this.headers = this.isSupabaseConfigured ? {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
        } : {};
    }

    /**
     * Fetch the view counts for all registered posts.
     * @returns {Promise<Record<string, number>>}
     */
    async getAllViews() {
        if (!this.isSupabaseConfigured) {
            return this._getLocalViews();
        }

        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/views?select=id,count`, {
                method: "GET",
                headers: this.headers
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            const viewsMap = {};
            data.forEach(item => {
                viewsMap[item.id] = parseInt(item.count, 10) || 0;
            });
            return viewsMap;
        } catch (error) {
            console.warn("Supabase fetch failed. Falling back to local storage.", error);
            return this._getLocalViews();
        }
    }

    /**
     * Record a new view for a specific post.
     * @param {string} postId 
     * @returns {Promise<number>} Updated view count
     */
    async incrementView(postId) {
        if (!postId) return 0;

        if (!this.isSupabaseConfigured) {
            const localViews = this._getLocalViews();
            localViews[postId] = (localViews[postId] || 0) + 1;
            this._saveLocalViews(localViews);
            return localViews[postId];
        }

        try {
            // Call the database function 'increment_view' via RPC
            const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_view`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({ post_id: postId })
            });

            if (!response.ok) throw new Error(`RPC increment failed: ${response.status}`);

            // Fetch the updated count for this specific post
            const fetchResponse = await fetch(`${SUPABASE_URL}/rest/v1/views?id=eq.${postId}&select=count`, {
                method: "GET",
                headers: this.headers
            });

            if (fetchResponse.ok) {
                const result = await fetchResponse.json();
                if (result && result.length > 0) {
                    return parseInt(result[0].count, 10) || 1;
                }
            }
            return 1;
        } catch (error) {
            console.warn("Supabase increment failed. Falling back to local storage.", error);
            const localViews = this._getLocalViews();
            localViews[postId] = (localViews[postId] || 0) + 1;
            this._saveLocalViews(localViews);
            return localViews[postId];
        }
    }

    // --- Helper Local Storage Methods ---
    _getLocalViews() {
        try {
            const data = localStorage.getItem(this.localStorageKey);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            console.error("Local storage error:", e);
            return {};
        }
    }

    _saveLocalViews(views) {
        try {
            localStorage.setItem(this.localStorageKey, JSON.stringify(views));
        } catch (e) {
            console.error("Failed to save to local storage:", e);
        }
    }
}

// ==========================================
// 3. UI RENDERING & DOM INJECTION
// ==========================================
const SVG_EYE_ICON = `
    <span class="views-icon" aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; color: var(--primary); vertical-align: middle; margin-right: 2px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" style="width: 14px; height: 14px; stroke: currentColor; stroke-width: 2.2; fill: none; display: inline-block;">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
    </span>
`;

/**
 * Creates and formats the view count HTML badge.
 * @param {number} count 
 * @returns {string} HTML string
 */
function createViewsBadgeHTML(count) {
    const formattedCount = new Intl.NumberFormat().format(count);
    const label = count === 1 ? "view" : "views";
    return `
        <span class="views-count-wrap" title="${formattedCount} total page views">
            <span class="views-separator"> · </span>
            ${SVG_EYE_ICON}
            <span class="views-count">${formattedCount}</span>
            <span class="views-label"> ${label}</span>
        </span>
    `;
}

// Initialize when the DOM is fully interactive
document.addEventListener("DOMContentLoaded", async () => {
    const tracker = new RealViewCounter();

    // 1. Handle Single Post Page (Track view & render badge in header)
    const singlePostElement = document.querySelector("article.single-post[data-post-id]");
    if (singlePostElement) {
        const postId = singlePostElement.getAttribute("data-post-id");
        const metaContainer = singlePostElement.querySelector(".post-meta");

        if (metaContainer) {
            // First increment the view on load
            const currentViewCount = await tracker.incrementView(postId);

            // Dynamically inject the badge
            metaContainer.insertAdjacentHTML("beforeend", createViewsBadgeHTML(currentViewCount));

            // Trigger a soft animation to showcase the count load
            const badge = metaContainer.querySelector(".views-count-wrap");
            if (badge) {
                setTimeout(() => {
                    badge.classList.add("loaded");
                    // Trigger a brief bounce/pulse on load to emphasize actual counting
                    badge.classList.add("incremented");
                }, 100);
            }
        }
    }

    // 2. Handle Homepage (Render views badges for all post cards)
    const postCards = document.querySelectorAll("[data-post-id]:not(.single-post)");
    if (postCards.length > 0) {
        try {
            const allViews = await tracker.getAllViews();

            postCards.forEach(card => {
                const postId = card.getAttribute("data-post-id");
                const count = allViews[postId] || 0;
                const metaContainer = card.querySelector(".post-meta");

                if (metaContainer) {
                    metaContainer.insertAdjacentHTML("beforeend", createViewsBadgeHTML(count));
                    const badge = metaContainer.querySelector(".views-count-wrap");
                    if (badge) {
                        setTimeout(() => badge.classList.add("loaded"), 50);
                    }
                }
            });
        } catch (error) {
            console.error("Failed to render homepage views:", error);
        }
    }
});
