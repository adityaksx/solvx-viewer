// SolvX Viewer — Variable Layer Control

export class VariableControl {
    constructor(containerId = 'vars', options = {}) {
        this.container = document.getElementById(containerId);
        this.onChange = options.onChange || (() => {});
        this.activeVariable = options.initialVariable || 'ocean_temperature';
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
            ocean_temperature: 'T',
            sea_level_anomaly: '∆',
            salinity: 'S',
            currents: 'C',
            sea_surface_height: 'η',
            chlorophyll: 'Ch',
            temperature_anomaly: '∆T',
            mixed_layer_depth: 'M',
            dissolved_oxygen: 'O₂',
            ph: 'pH',
            nitrate: 'N',
            phosphate: 'P',
            wave_height: 'W',
            wave_direction: 'Wd',
            wind_speed: 'U',
            wind_direction: 'Ud',
            wind_stress: 'τ'
        };

        const groups = {};
        this.catalog.forEach(item => {
            const group = item.group || 'OTHER';
            if (!groups[group]) groups[group] = [];
            groups[group].push(item);
        });

        for (const [groupName, items] of Object.entries(groups)) {
            const groupHeader = document.createElement('div');
            groupHeader.style.fontSize = '10px';
            groupHeader.style.fontWeight = 'bold';
            groupHeader.style.color = '#1da5d8';
            groupHeader.style.marginTop = '10px';
            groupHeader.style.marginBottom = '4px';
            groupHeader.textContent = groupName;
            this.container.appendChild(groupHeader);
            
            items.forEach(item => {
                const btn = document.createElement('button');
                const isActive = item.id === this.activeVariable;
                const isAvail = item.available !== false;

                btn.className = `var ${isActive ? 'active' : ''} ${!isAvail ? 'off' : ''}`;
                btn.disabled = !isAvail;
                // add data-var so setActive can find it
                btn.setAttribute('data-var', item.id);
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
