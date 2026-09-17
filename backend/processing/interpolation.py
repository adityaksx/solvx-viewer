from typing import List, Dict, Any
import numpy as np

def compare_vertical_profiles(
    model_depths: List[float],
    model_temps: List[float],
    obs_profile: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Interpolates model vertical temperature profile to match observation depths,
    and computes difference, RMSE, and mean bias.
    """
    if not model_depths or not model_temps or not obs_profile:
        return {'comparison': [], 'rmse': None, 'bias': None}

    m_d = np.asarray(model_depths, dtype=float)
    m_t = np.asarray(model_temps, dtype=float)

    # Sort model depths monotonically
    sort_idx = np.argsort(m_d)
    m_d = m_d[sort_idx]
    m_t = m_t[sort_idx]

    comparison = []
    diffs = []

    for point in obs_profile:
        z = float(point.get('depth', 0.0))
        obs_val = point.get('temp')
        if obs_val is None:
            continue
        obs_val = float(obs_val)

        # Interpolate model temperature at depth z
        mod_val = float(np.interp(z, m_d, m_t))
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
        'rmse': round(rmse, 4) if rmse is not None else None,
        'bias': round(bias, 4) if bias is not None else None
    }
