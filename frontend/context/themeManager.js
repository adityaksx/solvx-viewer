// SolvX — Unified Theme Manager
// Controls Light / Dark theme switching, persistence, DOM attributes, and event broadcasting.

const STORAGE_KEY = 'solvx_theme';

class ThemeManager {
    constructor() {
        this.currentTheme = this._getStoredTheme();
        this._listeners = new Set();
        this._applyTheme(this.currentTheme, false);
    }

    _getStoredTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'light';
        } catch (_) {
            return 'light';
        }
    }

    _applyTheme(theme, emit = true) {
        this.currentTheme = theme;
        const isDark = theme === 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (_) {}

        this._updateToggleButtons(isDark);

        if (emit) {
            const detail = { theme, isDark };
            window.dispatchEvent(new CustomEvent('solvx:themeChange', { detail }));
            this._listeners.forEach(fn => {
                try { fn(detail); } catch (e) { console.error(e); }
            });
        }
    }

    _updateToggleButtons(isDark) {
        const desiredText = isDark ? '☾' : '☼';
        const desiredTitle = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        document.querySelectorAll('.theme-toggle-btn, #themeToggleBtn').forEach(btn => {
            if (btn.textContent !== desiredText) {
                btn.textContent = desiredText;
            }
            if (btn.getAttribute('title') !== desiredTitle) {
                btn.setAttribute('title', desiredTitle);
                btn.setAttribute('aria-label', desiredTitle);
            }
        });
    }

    init() {
        this._applyTheme(this.currentTheme, true);
        
        // Auto-bind any theme toggle buttons on the page
        document.querySelectorAll('.theme-toggle-btn, #themeToggleBtn').forEach(btn => {
            if (!btn._themeBound) {
                btn._themeBound = true;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.toggleTheme();
                });
            }
        });
    }

    toggleTheme() {
        const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this._applyTheme(nextTheme, true);
        return nextTheme;
    }

    setTheme(theme) {
        if (theme !== 'light' && theme !== 'dark') return;
        this._applyTheme(theme, true);
    }

    getTheme() {
        return this.currentTheme;
    }

    isDark() {
        return this.currentTheme === 'dark';
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
}

export const themeManager = new ThemeManager();

// Automatically initialize when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => themeManager.init());
    } else {
        themeManager.init();
    }
}
