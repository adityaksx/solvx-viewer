// SolvX — Multi-Resolution Dynamic Timeline Controller
// Handles variable-driven time discovery from /api/data/timeline,
// hourly/daily/monthly switching, historical vs forecast boundary marking,
// and configurable playback speeds.

import { ApiClient } from '../api/apiClient.js';

export class TimelineControl {
    constructor(options = {}) {
        this.onTimeChange = options.onTimeChange || (() => {});
        this.slider = document.getElementById(options.sliderId || 'timeSlider');
        this.playBtn = document.getElementById(options.playBtnId || 'play');
        this.valueDisplay = document.getElementById(options.valueDisplayId || 'timeValue');
        this.rawDisplay = document.getElementById(options.rawDisplayId || 'timeRaw');
        this.countDisplay = document.getElementById(options.countDisplayId || 'timeCount');
        this.badgeDisplay = document.getElementById('timeBadge');
        this.speedSelect = document.getElementById('playSpeed');

        this.resHourlyBtn = document.getElementById('resHourly');
        this.resDailyBtn = document.getElementById('resDaily');
        this.resMonthlyBtn = document.getElementById('resMonthly');

        this.timelineData = null;
        this.allTimestamps = [];
        this.filteredTimestamps = [];
        this.currentResolution = 'daily';
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playInterval = null;
        this.speedMultiplier = 1.0;

        this.setupEvents();
    }

    async loadTimelineForVariable(variable, bbox = null, depth = null) {
        try {
            const data = await ApiClient.getDataTimeline({ variable, bbox, depth });
            this.timelineData = data;
            this.allTimestamps = data.available_timestamps || [];
            this.currentResolution = data.default_resolution || 'daily';

            this._updateResolutionButtons(data.resolutions || ['daily']);
            this._applyResolutionFilter();
            return data;
        } catch (e) {
            console.warn('[TimelineControl] Failed fetching timeline metadata:', e);
            return null;
        }
    }

    _updateResolutionButtons(supportedResolutions = []) {
        const setBtn = (btn, res) => {
            if (!btn) return;
            const supported = supportedResolutions.includes(res);
            btn.disabled = !supported;
            btn.classList.toggle('disabled', !supported);
            btn.classList.toggle('active', this.currentResolution === res);
        };

        setBtn(this.resHourlyBtn, 'hourly');
        setBtn(this.resDailyBtn, 'daily');
        setBtn(this.resMonthlyBtn, 'monthly');
    }

    _applyResolutionFilter() {
        if (!this.allTimestamps.length) {
            this.filteredTimestamps = [];
            this.setTimes([]);
            return;
        }

        if (this.currentResolution === 'monthly') {
            // Pick first timestamp of each unique month
            const seen = new Set();
            this.filteredTimestamps = this.allTimestamps.filter(ts => {
                const ym = ts.slice(0, 7);
                if (seen.has(ym)) return false;
                seen.add(ym);
                return true;
            });
        } else if (this.currentResolution === 'daily') {
            // Pick first timestamp of each unique day
            const seen = new Set();
            this.filteredTimestamps = this.allTimestamps.filter(ts => {
                const ymd = ts.slice(0, 10);
                if (seen.has(ymd)) return false;
                seen.add(ymd);
                return true;
            });
        } else {
            // Hourly or raw full resolution
            this.filteredTimestamps = [...this.allTimestamps];
        }

        this.setTimes(this.filteredTimestamps);
    }

    setTimes(times = []) {
        this.filteredTimestamps = times;
        if (this.slider) {
            this.slider.max = String(Math.max(0, times.length - 1));
            this.slider.value = '0';
        }
        this.currentIndex = 0;
        this.updateDisplay();
        if (times.length > 0) {
            this.onTimeChange(0, times[0], this.getCurrentMeta());
        }
    }

    getCurrentTimestamp() {
        return this.filteredTimestamps[this.currentIndex] || null;
    }

    getCurrentMeta() {
        const ts = this.getCurrentTimestamp();
        let isForecast = false;
        if (this.timelineData?.forecast?.from && ts) {
            isForecast = ts >= this.timelineData.forecast.from;
        }
        return {
            timestamp: ts,
            isForecast,
            resolution: this.currentResolution,
            index: this.currentIndex,
            total: this.filteredTimestamps.length
        };
    }

    updateDisplay() {
        const raw = this.filteredTimestamps[this.currentIndex] || '';
        const meta = this.getCurrentMeta();

        if (this.valueDisplay) {
            if (raw) {
                const d = new Date(raw);
                const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
                this.valueDisplay.innerHTML = `${dateStr} <span style="opacity: 0.7; font-size: 11px;">${timeStr} UTC</span>`;
            } else {
                this.valueDisplay.textContent = 'No timestamp available';
            }
        }

        if (this.rawDisplay) {
            this.rawDisplay.textContent = raw || '—';
        }

        if (this.countDisplay) {
            this.countDisplay.textContent = `${this.currentIndex + 1} / ${Math.max(1, this.filteredTimestamps.length)}`;
        }

        if (this.badgeDisplay) {
            if (raw) {
                if (meta.isForecast) {
                    this.badgeDisplay.textContent = 'FORECAST';
                    this.badgeDisplay.className = 'time-badge forecast';
                } else {
                    this.badgeDisplay.textContent = 'HISTORICAL';
                    this.badgeDisplay.className = 'time-badge historical';
                }
            } else {
                this.badgeDisplay.textContent = '';
                this.badgeDisplay.className = 'time-badge hidden';
            }
        }
    }

    setupEvents() {
        this.slider?.addEventListener('input', (e) => {
            this.currentIndex = Number(e.target.value);
            this.updateDisplay();
            this.onTimeChange(this.currentIndex, this.getCurrentTimestamp(), this.getCurrentMeta());
        });

        // Resolution buttons
        const handleResClick = (res) => {
            if (this.currentResolution === res) return;
            this.currentResolution = res;
            if (this.timelineData) {
                this._updateResolutionButtons(this.timelineData.resolutions || ['daily']);
            }
            this._applyResolutionFilter();
        };

        this.resHourlyBtn?.addEventListener('click', () => handleResClick('hourly'));
        this.resDailyBtn?.addEventListener('click', () => handleResClick('daily'));
        this.resMonthlyBtn?.addEventListener('click', () => handleResClick('monthly'));

        // Speed multiplier selector
        this.speedSelect?.addEventListener('change', (e) => {
            this.speedMultiplier = parseFloat(e.target.value) || 1.0;
            if (this.isPlaying) {
                this._restartPlayback();
            }
        });

        // Play/Pause button
        this.playBtn?.addEventListener('click', () => {
            this.togglePlay();
        });
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        if (this.playBtn) {
            this.playBtn.textContent = this.isPlaying ? 'PAUSE' : 'PLAY';
            this.playBtn.classList.toggle('playing', this.isPlaying);
        }

        if (this.isPlaying) {
            this._restartPlayback();
        } else {
            if (this.playInterval) clearInterval(this.playInterval);
        }
    }

    _restartPlayback() {
        if (this.playInterval) clearInterval(this.playInterval);
        const intervalMs = Math.max(150, Math.round(1000 / this.speedMultiplier));
        this.playInterval = setInterval(() => {
            if (!this.filteredTimestamps.length) return;
            this.currentIndex = (this.currentIndex + 1) % this.filteredTimestamps.length;
            if (this.slider) this.slider.value = String(this.currentIndex);
            this.updateDisplay();
            this.onTimeChange(this.currentIndex, this.getCurrentTimestamp(), this.getCurrentMeta());
        }, intervalMs);
    }

    destroy() {
        if (this.playInterval) clearInterval(this.playInterval);
    }
}
