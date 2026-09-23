"""
SolvX — ML Model Evaluation
===========================
Computes rigorous, publication-grade validation and test metrics:
- Precision, Recall, F1
- ROC-AUC
- PR-AUC (Average Precision) for imbalanced ocean hazard events
- Confusion Matrix
- Brier Score (probability calibration)
(Plan.md Section 9)
"""

from typing import Dict, Any, List, Optional
import numpy as np
from sklearn.metrics import (
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    brier_score_loss,
)


def evaluate_horizon_predictions(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    threshold: float = 0.5
) -> Dict[str, Any]:
    """
    Evaluates binary predictions for a single forecast horizon.

    Args:
        y_true: Ground truth binary array (N,)
        y_proba: Predicted probability array (N,)
        threshold: Classification cutoff

    Returns:
        Structured evaluation metrics dictionary.
    """
    y_pred = (y_proba >= threshold).astype(int)

    # Base counts
    n_total = len(y_true)
    n_pos = int(np.sum(y_true))
    n_neg = n_total - n_pos
    pos_rate = float(n_pos / n_total) if n_total > 0 else 0.0

    # Precision, Recall, F1
    prec = float(precision_score(y_true, y_pred, zero_division=0))
    rec = float(recall_score(y_true, y_pred, zero_division=0))
    f1 = float(f1_score(y_true, y_pred, zero_division=0))

    # ROC-AUC (only valid if both classes are present)
    try:
        roc_auc = float(roc_auc_score(y_true, y_proba)) if len(np.unique(y_true)) > 1 else None
    except Exception:
        roc_auc = None

    # PR-AUC / Average Precision (vital for imbalanced rare hazard classes)
    try:
        pr_auc = float(average_precision_score(y_true, y_proba)) if len(np.unique(y_true)) > 1 else None
    except Exception:
        pr_auc = None

    # Brier Score (mean squared error of probability forecast — calibration metric)
    brier = float(brier_score_loss(y_true, y_proba))

    # Confusion matrix
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = (int(cm[0, 0]), int(cm[0, 1]), int(cm[1, 0]), int(cm[1, 1])) if cm.shape == (2, 2) else (0, 0, 0, 0)

    return {
        'total_samples': n_total,
        'positive_samples': n_pos,
        'positive_rate': round(pos_rate, 4),
        'precision': round(prec, 4),
        'recall': round(rec, 4),
        'f1': round(f1, 4),
        'roc_auc': round(roc_auc, 4) if roc_auc is not None else None,
        'pr_auc': round(pr_auc, 4) if pr_auc is not None else None,
        'brier_score': round(brier, 4),
        'confusion_matrix': {
            'true_negatives': tn,
            'false_positives': fp,
            'false_negatives': fn,
            'true_positives': tp,
        }
    }


def evaluate_model(
    model: Any,
    X_test: np.ndarray,
    y_test: np.ndarray,
    horizons: Optional[List[int]] = None
) -> Dict[str, Any]:
    """
    Evaluates the full multi-horizon OceanHazardModel on test data.

    Returns:
        Comprehensive multi-horizon evaluation report dictionary.
    """
    horizon_list = horizons or [6, 12, 24]
    probas = model.predict_proba(X_test)

    horizon_metrics = {}
    f1_list = []
    roc_list = []
    pr_list = []
    brier_list = []

    for idx, h in enumerate(horizon_list):
        key = f'risk_{h}h'
        y_h_true = y_test[:, idx]
        y_h_proba = probas[key]

        m = evaluate_horizon_predictions(y_h_true, y_h_proba)
        horizon_metrics[f'{h}h'] = m

        f1_list.append(m['f1'])
        if m['roc_auc'] is not None:
            roc_list.append(m['roc_auc'])
        if m['pr_auc'] is not None:
            pr_list.append(m['pr_auc'])
        brier_list.append(m['brier_score'])

    overall = {
        'mean_f1': round(float(np.mean(f1_list)), 4) if f1_list else 0.0,
        'mean_roc_auc': round(float(np.mean(roc_list)), 4) if roc_list else None,
        'mean_pr_auc': round(float(np.mean(pr_list)), 4) if pr_list else None,
        'mean_brier_score': round(float(np.mean(brier_list)), 4) if brier_list else 0.0,
        'test_samples': int(len(X_test)),
    }

    return {
        'overall': overall,
        'by_horizon': horizon_metrics
    }
