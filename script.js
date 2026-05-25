/**
 * Green Journal — Real Views & Likes Counter
 * 
 * A lightweight, zero-dependency engine designed for GitHub Pages.
 * - Out-of-the-box: Saves and counts views/likes locally via localStorage.
 * - Production: Uses your free serverless Supabase database to track real global visitor stats.
 */

// ==========================================
// 1. DATABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = "https://prtdxvclxjigrbypipvk.supabase.co";
const SUPABASE_KEY = "sb_publishable_ubAGDoqPnAuLFPruhZKg-w_1mYsQbm6";

// ==========================================
// 2. STATS ENGINE
// ==========================================
class RealViewCounter {
    constructor() {
        this.isSupabaseConfigured = SUPABASE_URL && SUPABASE_KEY;
        this.localStorageKey = "green_journal_views";
        this.localLikesKey = "green_journal_likes"; // Tracks which posts this device has liked
        this.localLikesCountKey = "green_journal_likes_count"; // Tracks likes counts in local fallback mode
        this.headers = this.isSupabaseConfigured ? {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
        } : {};
    }

    /**
     * Fetch all stats (views and likes) for all registered posts.
     * @returns {Promise<{views: Record<string, number>, likes: Record<string, number>}>}
     */
    async getAllStats() {
        if (!this.isSupabaseConfigured) {
            return {
                views: this._getLocalViews(),
                likes: this._getLocalLikesCount()
            };
        }

        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/views?select=id,count,likes`, {
                method: "GET",
                headers: this.headers
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            const viewsMap = {};
            const likesMap = {};
            data.forEach(item => {
                viewsMap[item.id] = parseInt(item.count, 10) || 0;
                likesMap[item.id] = parseInt(item.likes, 10) || 0;
            });
            return { views: viewsMap, likes: likesMap };
        } catch (error) {
            console.warn("Supabase fetch failed. Falling back to local storage.", error);
            return {
                views: this._getLocalViews(),
                likes: this._getLocalLikesCount()
            };
        }
    }

    /**
     * Backward-compatible helper to fetch views maps.
     */
    async getAllViews() {
        const stats = await this.getAllStats();
        return stats.views;
    }

    /**
     * Record a new view and get current post stats.
     * @param {string} postId 
     * @returns {Promise<{views: number, likes: number}>} Updated views and likes
     */
    async incrementViewAndGetStats(postId) {
        if (!postId) return { views: 0, likes: 0 };

        if (!this.isSupabaseConfigured) {
            const localViews = this._getLocalViews();
            localViews[postId] = (localViews[postId] || 0) + 1;
            this._saveLocalViews(localViews);

            const localLikes = this._getLocalLikesCount();
            return {
                views: localViews[postId],
                likes: localLikes[postId] || 0
            };
        }

        try {
            // Call the database function 'increment_view' via RPC
            const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_view`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({ post_id: postId })
            });

            if (!response.ok) throw new Error(`RPC increment failed: ${response.status}`);

            // Fetch the updated count and likes count for this specific post
            const fetchResponse = await fetch(`${SUPABASE_URL}/rest/v1/views?id=eq.${postId}&select=count,likes`, {
                method: "GET",
                headers: this.headers
            });

            if (fetchResponse.ok) {
                const result = await fetchResponse.json();
                if (result && result.length > 0) {
                    return {
                        views: parseInt(result[0].count, 10) || 1,
                        likes: parseInt(result[0].likes, 10) || 0
                    };
                }
            }
            return { views: 1, likes: 0 };
        } catch (error) {
            console.warn("Supabase increment failed. Falling back to local storage.", error);
            const localViews = this._getLocalViews();
            localViews[postId] = (localViews[postId] || 0) + 1;
            this._saveLocalViews(localViews);
            return {
                views: localViews[postId],
                likes: this._getLocalLikesCount()[postId] || 0
            };
        }
    }

    /**
     * Check if a specific post has been liked by this user locally.
     * @param {string} postId 
     * @returns {boolean}
     */
    isPostLikedLocally(postId) {
        try {
            const likedPosts = JSON.parse(localStorage.getItem(this.localLikesKey)) || {};
            return !!likedPosts[postId];
        } catch (e) {
            return false;
        }
    }

    /**
     * Toggle the liked state of a post and return the updated count.
     * @param {string} postId 
     * @returns {Promise<{liked: boolean, count: number}>}
     */
    async toggleLike(postId) {
        if (!postId) return { liked: false, count: 0 };

        const currentlyLiked = this.isPostLikedLocally(postId);
        const newLikedState = !currentlyLiked;

        // Update local record of which posts this device has liked
        try {
            const likedPosts = JSON.parse(localStorage.getItem(this.localLikesKey)) || {};
            if (newLikedState) {
                likedPosts[postId] = true;
            } else {
                delete likedPosts[postId];
            }
            localStorage.setItem(this.localLikesKey, JSON.stringify(likedPosts));
        } catch (e) {
            console.error("Local storage liked posts error:", e);
        }

        // Local Fallback Mode
        if (!this.isSupabaseConfigured) {
            const likesCount = this._getLocalLikesCount();
            likesCount[postId] = Math.max(0, (likesCount[postId] || 0) + (newLikedState ? 1 : -1));
            this._saveLocalLikesCount(likesCount);
            return { liked: newLikedState, count: likesCount[postId] };
        }

        // Supabase Mode
        try {
            const rpcFunction = newLikedState ? "increment_like" : "decrement_like";
            const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcFunction}`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({ post_id: postId })
            });

            if (!response.ok) throw new Error(`RPC like toggle failed: ${response.status}`);

            // Fetch the updated count
            const fetchResponse = await fetch(`${SUPABASE_URL}/rest/v1/views?id=eq.${postId}&select=likes`, {
                method: "GET",
                headers: this.headers
            });

            if (fetchResponse.ok) {
                const result = await fetchResponse.json();
                if (result && result.length > 0) {
                    return { liked: newLikedState, count: parseInt(result[0].likes, 10) || 0 };
                }
            }
            return { liked: newLikedState, count: newLikedState ? 1 : 0 };
        } catch (error) {
            console.warn("Supabase like toggle failed. Falling back to local storage.", error);
            const likesCount = this._getLocalLikesCount();
            likesCount[postId] = Math.max(0, (likesCount[postId] || 0) + (newLikedState ? 1 : -1));
            this._saveLocalLikesCount(likesCount);
            return { liked: newLikedState, count: likesCount[postId] };
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
            console.error("Failed to save views count to local storage:", e);
        }
    }

    _getLocalLikesCount() {
        try {
            const data = localStorage.getItem(this.localLikesCountKey);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    }

    _saveLocalLikesCount(likes) {
        try {
            localStorage.setItem(this.localLikesCountKey, JSON.stringify(likes));
        } catch (e) {
            console.error("Failed to save likes count to local storage:", e);
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

const SVG_HEART_ICON = `
    <span class="likes-icon" aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; color: #e05260; vertical-align: middle; margin-right: 2px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" style="width: 14px; height: 14px; stroke: currentColor; stroke-width: 2.2; fill: none; display: inline-block;">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
        </svg>
    </span>
`;

/**
 * Creates and formats a combined Views & Likes HTML badge container.
 * @param {number} viewsCount 
 * @param {number} likesCount 
 * @param {boolean} hasLiked 
 * @returns {string} HTML string
 */
function createStatsBadgesHTML(viewsCount, likesCount, hasLiked) {
    const formattedViews = new Intl.NumberFormat().format(viewsCount);
    const formattedLikes = new Intl.NumberFormat().format(likesCount);
    const viewsLabel = viewsCount === 1 ? "view" : "views";
    const likesLabel = likesCount === 1 ? "like" : "likes";
    
    return `
        <span class="views-count-wrap" title="${formattedViews} total page views">
            <span class="views-separator"> · </span>
            ${SVG_EYE_ICON}
            <span class="views-count">${formattedViews}</span>
            <span class="views-label"> ${viewsLabel}</span>
        </span>
        <span class="likes-count-wrap ${hasLiked ? 'liked' : ''}" title="${formattedLikes} total likes">
            <span class="views-separator"> · </span>
            ${SVG_HEART_ICON}
            <span class="likes-count">${formattedLikes}</span>
            <span class="likes-label"> ${likesLabel}</span>
        </span>
    `;
}

/**
 * Creates the markup for the bottom interactive like button.
 */
function createInteractiveLikeButtonHTML(likesCount, hasLiked) {
    return `
        <button class="like-btn ${hasLiked ? 'liked' : ''}" aria-label="${hasLiked ? 'Unlike this post' : 'Like this post'}">
            <span class="btn-heart-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
                </svg>
            </span>
            <span class="btn-like-text">${hasLiked ? 'Liked' : 'Like this post'}</span>
            <span style="opacity: 0.15">·</span>
            <span class="btn-likes-count">${new Intl.NumberFormat().format(likesCount)}</span>
        </button>
    `;
}

// Initialize when the DOM is fully interactive
document.addEventListener("DOMContentLoaded", async () => {
    const tracker = new RealViewCounter();

    // 1. Handle Single Post Page (Track view, render stats badges in header & like button at the bottom)
    const singlePostElement = document.querySelector("article.single-post[data-post-id]");
    if (singlePostElement) {
        const postId = singlePostElement.getAttribute("data-post-id");
        const metaContainer = singlePostElement.querySelector(".post-meta");
        const likeButtonContainer = document.querySelector(".like-button-container");

        if (metaContainer) {
            // Record view and fetch stats
            const stats = await tracker.incrementViewAndGetStats(postId);
            const hasLiked = tracker.isPostLikedLocally(postId);

            // Dynamically inject combined views and likes badges
            metaContainer.insertAdjacentHTML("beforeend", createStatsBadgesHTML(stats.views, stats.likes, hasLiked));
            
            // Trigger a soft animation to showcase the counts load
            const vBadge = metaContainer.querySelector(".views-count-wrap");
            const lBadge = metaContainer.querySelector(".likes-count-wrap");
            if (vBadge) {
                setTimeout(() => {
                    vBadge.classList.add("loaded");
                    vBadge.classList.add("incremented");
                }, 100);
            }
            if (lBadge) {
                setTimeout(() => lBadge.classList.add("loaded"), 150);
            }

            // Dynamically inject the interactive Like Button if placeholder exists
            if (likeButtonContainer) {
                likeButtonContainer.innerHTML = createInteractiveLikeButtonHTML(stats.likes, hasLiked);
                const likeBtn = likeButtonContainer.querySelector(".like-btn");

                if (likeBtn) {
                    likeBtn.addEventListener("click", async () => {
                        // Prevent rapid double-clicks while network is pending
                        if (likeBtn.classList.contains("pop")) return;

                        // Add immediate squishy pop effect
                        likeBtn.classList.add("pop");

                        // Toggle like state
                        const result = await tracker.toggleLike(postId);

                        // Update states
                        if (result.liked) {
                            likeBtn.classList.add("liked");
                            likeBtn.querySelector(".btn-like-text").textContent = "Liked";
                        } else {
                            likeBtn.classList.remove("liked");
                            likeBtn.querySelector(".btn-like-text").textContent = "Like this post";
                        }

                        // Update likes counts
                        likeBtn.querySelector(".btn-likes-count").textContent = new Intl.NumberFormat().format(result.count);

                        // Sync top meta badge
                        const metaLikesCountEl = metaContainer.querySelector(".likes-count");
                        const metaLikesWrap = metaContainer.querySelector(".likes-count-wrap");
                        if (metaLikesCountEl) {
                            metaLikesCountEl.textContent = new Intl.NumberFormat().format(result.count);
                        }
                        if (metaLikesWrap) {
                            if (result.liked) {
                                metaLikesWrap.classList.add("liked");
                            } else {
                                metaLikesWrap.classList.remove("liked");
                            }
                        }

                        // Clean up pop animation
                        setTimeout(() => likeBtn.classList.remove("pop"), 450);
                    });
                }
            }
        }
    }

    // 2. Handle Homepage (Render views and likes badges for all post cards)
    const postCards = document.querySelectorAll("[data-post-id]:not(.single-post)");
    if (postCards.length > 0) {
        try {
            const stats = await tracker.getAllStats();

            postCards.forEach(card => {
                const postId = card.getAttribute("data-post-id");
                const viewsCount = stats.views[postId] || 0;
                const likesCount = stats.likes[postId] || 0;
                const hasLiked = tracker.isPostLikedLocally(postId);
                const metaContainer = card.querySelector(".post-meta");

                if (metaContainer) {
                    metaContainer.insertAdjacentHTML("beforeend", createStatsBadgesHTML(viewsCount, likesCount, hasLiked));
                    const vBadge = metaContainer.querySelector(".views-count-wrap");
                    const lBadge = metaContainer.querySelector(".likes-count-wrap");
                    
                    if (vBadge) setTimeout(() => vBadge.classList.add("loaded"), 50);
                    if (lBadge) setTimeout(() => lBadge.classList.add("loaded"), 100);
                }
            });
        } catch (error) {
            console.error("Failed to render homepage stats:", error);
        }
    }
});
