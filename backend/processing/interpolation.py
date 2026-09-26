from typing import List, Dict, Any
import numpy as np

def compare_vertical_profiles(
    model_depths: List[float],
    model_vals: List[float],
    obs_profile: List[Dict[str, Any]],
    variable: str = 'temperature'
) -> Dict[str, Any]:
    """
    Interpolates model vertical profile to match observation depths,
    and computes difference, RMSE, and mean bias.
    """
    if not model_depths or not model_vals or not obs_profile:
        return {'profile': [], 'comparison': [], 'rmse': None, 'bias': None}

    # Filter out NaNs from model values
    valid_mask = [not (np.isnan(d) or np.isnan(v)) for d, v in zip(model_depths, model_vals)]
    m_d = np.asarray([d for d, m in zip(model_depths, valid_mask) if m], dtype=float)
    m_v = np.asarray([v for v, m in zip(model_vals, valid_mask) if m], dtype=float)

    if len(m_d) == 0:
        return {'profile': [], 'comparison': [], 'rmse': None, 'bias': None}

    # Sort model depths monotonically
    sort_idx = np.argsort(m_d)
    m_d = m_d[sort_idx]
    m_v = m_v[sort_idx]

    comparison = []
    diffs = []

    for point in obs_profile:
        z = float(point.get('depth', 0.0))
        if variable in ('salinity', 'sal', 'so'):
            obs_val = point.get('sal') if point.get('sal') is not None else point.get('salinity')
        else:
            obs_val = point.get('temp') if point.get('temp') is not None else point.get('temperature')

        if obs_val is None or np.isnan(obs_val):
            continue
        obs_val = float(obs_val)

        # Interpolate model variable at depth z
        mod_val = float(np.interp(z, m_d, m_v))
        diff = mod_val - obs_val
        diffs.append(diff)

        comparison.append({
            'depth': z,
            'model': round(mod_val, 3),
            'observed': round(obs_val, 3),
            'diff': round(diff, 3)
        })

    rmse = float(np.sqrt(np.mean(np.square(diffs)))) if diffs else None
    bias = float(np.mean(diffs)) if diffs else None

    return {
        'profile': comparison,
        'comparison': comparison,
        'rmse': round(rmse, 4) if rmse is not None else None,
        'bias': round(bias, 4) if bias is not None else None
    }
