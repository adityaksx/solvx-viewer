// SolvX Viewer — Variable Layer Control

export class VariableControl {
    constructor(containerId = 'vars', options = {}) {
        this.container = document.getElementById(containerId);
        this.onChange = options.onChange || (() => {});
        this.activeVariable = options.initialVariable || 'temperature';
        this.catalog = [];
    }

    setCatalog(catalog) {
        this.catalog = catalog || [];
        this.render();
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = '';

        const icons = {
            temperature: 'T',
            temperature_anomaly: '∆',
            salinity: 'S',
            currents: 'C',
            sea_level: 'η',
            chlorophyll: 'Ch'
        };

        this.catalog.forEach(item => {
            const btn = document.createElement('button');
            const isActive = item.id === this.activeVariable;
            const isAvail = item.available !== false;

            btn.className = `var ${isActive ? 'active' : ''} ${!isAvail ? 'off' : ''}`;
            btn.disabled = !isAvail;
            btn.innerHTML = `
                <span class="vicon">${icons[item.id] || '•'}</span>
                <span>
                    <b>${item.label || item.id}</b>
                    <small>${item.units || (isAvail ? 'Ready' : 'Unavailable')}</small>
                </span>
                <span class="dot"></span>
            `;

            btn.onclick = () => {
                if (!isAvail) return;
                this.setActive(item.id);
            };

            this.container.appendChild(btn);
        });
    }

    setActive(varId) {
        this.activeVariable = varId;
        this.container?.querySelectorAll('.var').forEach(b => b.classList.remove('active'));
        const activeBtn = this.container?.querySelector(`[data-var="${varId}"]`);
        activeBtn?.classList.add('active');
        this.render();
        this.onChange(varId);
    }
}
