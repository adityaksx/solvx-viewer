// SolvX Viewer — Timeline & Playback Controller

export class TimelineControl {
    constructor(options = {}) {
        this.onTimeChange = options.onTimeChange || (() => {});
        this.slider = document.getElementById(options.sliderId || 'timeSlider');
        this.playBtn = document.getElementById(options.playBtnId || 'play');
        this.valueDisplay = document.getElementById(options.valueDisplayId || 'timeValue');
        this.rawDisplay = document.getElementById(options.rawDisplayId || 'timeRaw');
        this.countDisplay = document.getElementById(options.countDisplayId || 'timeCount');

        this.times = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playInterval = null;

        this.setupEvents();
    }

    setTimes(times = []) {
        this.times = times;
        if (this.slider) {
            this.slider.max = String(Math.max(0, times.length - 1));
            this.slider.value = '0';
        }
        this.currentIndex = 0;
        this.updateDisplay();
    }

    updateDisplay() {
        const raw = this.times[this.currentIndex] || '';
        if (this.valueDisplay) {
            this.valueDisplay.textContent = raw
                ? new Date(raw).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                : 'Ocean time';
        }
        if (this.rawDisplay) {
            this.rawDisplay.textContent = raw || '—';
        }
        if (this.countDisplay) {
            this.countDisplay.textContent = `${this.currentIndex + 1}/${Math.max(1, this.times.length)}`;
        }
    }

    setupEvents() {
        this.slider?.addEventListener('input', (e) => {
            this.currentIndex = Number(e.target.value);
            this.updateDisplay();
            this.onTimeChange(this.currentIndex, this.times[this.currentIndex]);
        });

        this.playBtn?.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            if (this.playBtn) {
                this.playBtn.textContent = this.isPlaying ? 'PAUSE' : 'PLAY';
            }

            if (this.isPlaying) {
                this.playInterval = setInterval(() => {
                    if (!this.times.length) return;
                    this.currentIndex = (this.currentIndex + 1) % this.times.length;
                    if (this.slider) this.slider.value = String(this.currentIndex);
                    this.updateDisplay();
                    this.onTimeChange(this.currentIndex, this.times[this.currentIndex]);
                }, 1000);
            } else {
                clearInterval(this.playInterval);
            }
        });
    }

    destroy() {
        if (this.playInterval) clearInterval(this.playInterval);
    }
}
