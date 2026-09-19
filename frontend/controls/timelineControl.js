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
        
        this.timeStart = document.getElementById('timeStart');
        this.timeEnd = document.getElementById('timeEnd');
        this.btnSetPeriod = document.getElementById('btnSetPeriod');

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

    async loadTimelineForVariable(variable, bbox = null, depth = null, start = null, end = null) {
        this.activeVariable = variable;
        this.bbox = bbox;
        this.depth = depth;
        try {
            const params = { variable, bbox, depth };
            if (start) params.start = start;
            if (end) params.end = end;
            const data = await ApiClient.getDataTimeline(params);
            this.timelineData = data;
            this.allTimestamps = data.available_timestamps || [];
            this.currentResolution = data.default_resolution || 'daily';
            
            // Set default date range to match loaded data
            if (this.allTimestamps.length > 0) {
                if (this.timeStart) this.timeStart.value = this.allTimestamps[0].substring(0, 16);
                if (this.timeEnd) this.timeEnd.value = this.allTimestamps[this.allTimestamps.length - 1].substring(0, 16);
            }

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
            const seen = new Set();
            this.filteredTimestamps = this.allTimestamps.filter(ts => {
                const ym = ts.slice(0, 7);
                if (seen.has(ym)) return false;
                seen.add(ym);
                return true;
            });
        } else if (this.currentResolution === 'daily') {
            const seen = new Set();
            this.filteredTimestamps = this.allTimestamps.filter(ts => {
                const ymd = ts.slice(0, 10);
                if (seen.has(ymd)) return false;
                seen.add(ymd);
                return true;
            });
        } else {
            this.filteredTimestamps = [...this.allTimestamps];
        }

        this.setTimes(this.filteredTimestamps);
    }

    setTimes(times = [], notify = false) {
        this.filteredTimestamps = times;
        if (this.slider) {
            this.slider.max = String(Math.max(0, times.length - 1));
            this.slider.value = '0';
        }
        this.currentIndex = 0;
        this.updateDisplay();
        if (notify && times.length > 0) {
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
        let sliderDebounce = null;
        this.slider?.addEventListener('input', (e) => {
            this.currentIndex = Number(e.target.value);
            this.updateDisplay();
            clearTimeout(sliderDebounce);
            sliderDebounce = setTimeout(() => {
                this.onTimeChange(this.currentIndex, this.getCurrentTimestamp(), this.getCurrentMeta());
            }, 200);
        });

        if (this.btnSetPeriod) {
            this.btnSetPeriod.addEventListener('click', async () => {
                const startVal = this.timeStart?.value;
                const endVal = this.timeEnd?.value;
                if (!startVal || !endVal) return;
                
                const dStart = new Date(startVal);
                const dEnd = new Date(endVal);
                if (dStart > dEnd) return;
                
                await this.loadTimelineForVariable(this.activeVariable, this.bbox, this.depth, dStart.toISOString(), dEnd.toISOString());
                if (this.filteredTimestamps.length > 0) {
                    this.onTimeChange(0, this.getCurrentTimestamp(), this.getCurrentMeta());
                }
            });
        }

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

    pause() {
        if (this.isPlaying) {
            this.togglePlay();
        }
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
        let isBusy = false;
        this.playInterval = setInterval(async () => {
            if (!this.filteredTimestamps.length || isBusy) return;
            isBusy = true;
            try {
                this.currentIndex = (this.currentIndex + 1) % this.filteredTimestamps.length;
                if (this.slider) this.slider.value = String(this.currentIndex);
                this.updateDisplay();
                await this.onTimeChange(this.currentIndex, this.getCurrentTimestamp(), this.getCurrentMeta());
            } catch (err) {
                console.debug('[TimelineControl] Playback frame error:', err);
            } finally {
                isBusy = false;
            }
        }, intervalMs);
    }

    destroy() {
        if (this.playInterval) clearInterval(this.playInterval);
    }
}
