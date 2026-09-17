// SolvX Viewer — Coordinate Input Controller

export class CoordinateInput {
    constructor(options = {}) {
        this.onSubmit = options.onSubmit || (() => {});
        this.onChange = options.onChange || (() => {});
        this.minLatInput = document.getElementById(options.minLatId || 'coordMinLat');
        this.maxLatInput = document.getElementById(options.maxLatId || 'coordMaxLat');
        this.minLonInput = document.getElementById(options.minLonId || 'coordMinLon');
        this.maxLonInput = document.getElementById(options.maxLonId || 'coordMaxLon');
        this.errorElement = document.getElementById(options.errorId || 'coordError');
        this.submitBtn = document.getElementById(options.submitId || 'coordSubmit');

        this.setupEvents();
    }

    setValues(bbox) {
        if (!bbox) return;
        if (this.minLatInput) this.minLatInput.value = bbox.min_lat.toFixed(2);
        if (this.maxLatInput) this.maxLatInput.value = bbox.max_lat.toFixed(2);
        if (this.minLonInput) this.minLonInput.value = bbox.min_lon.toFixed(2);
        if (this.maxLonInput) this.maxLonInput.value = bbox.max_lon.toFixed(2);
        this.clearError();
    }

    getValues() {
        return {
            min_lat: parseFloat(this.minLatInput?.value || 0),
            max_lat: parseFloat(this.maxLatInput?.value || 0),
            min_lon: parseFloat(this.minLonInput?.value || 0),
            max_lon: parseFloat(this.maxLonInput?.value || 0)
        };
    }

    validate(bbox) {
        if (isNaN(bbox.min_lat) || isNaN(bbox.max_lat) || isNaN(bbox.min_lon) || isNaN(bbox.max_lon)) {
            return 'All coordinates must be valid numbers';
        }
        if (bbox.min_lat < -90 || bbox.max_lat > 90) {
            return 'Latitude must be between -90° and 90°';
        }
        if (bbox.min_lon < -180 || bbox.max_lon > 180) {
            return 'Longitude must be between -180° and 180°';
        }
        if (bbox.min_lat >= bbox.max_lat) {
            return 'Min latitude must be strictly less than max latitude';
        }
        if (bbox.min_lon >= bbox.max_lon) {
            return 'Min longitude must be strictly less than max longitude';
        }
        if (bbox.max_lat - bbox.min_lat < 0.2 || bbox.max_lon - bbox.min_lon < 0.2) {
            return 'Selected region is too small (minimum 0.2°span required)';
        }
        return null;
    }

    showError(msg) {
        if (this.errorElement) {
            this.errorElement.textContent = msg;
            this.errorElement.classList.remove('hidden');
        }
    }

    clearError() {
        if (this.errorElement) {
            this.errorElement.textContent = '';
            this.errorElement.classList.add('hidden');
        }
    }

    setupEvents() {
        const handleInput = () => {
            const bbox = this.getValues();
            const err = this.validate(bbox);
            if (err) {
                this.showError(err);
            } else {
                this.clearError();
                this.onChange(bbox);
            }
        };

        [this.minLatInput, this.maxLatInput, this.minLonInput, this.maxLonInput].forEach(el => {
            el?.addEventListener('input', handleInput);
        });

        this.submitBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            const bbox = this.getValues();
            const err = this.validate(bbox);
            if (err) {
                this.showError(err);
            } else {
                this.clearError();
                this.onSubmit(bbox);
            }
        });
    }
}
