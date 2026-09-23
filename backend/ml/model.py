"""
SolvX — Ocean Hazard Risk Model
===============================
Tabular Machine Learning Model for multi-horizon Ocean Hazard Risk Prediction
(6h, 12h, 24h risk probabilities) using Gradient Boosted Trees (HistGradientBoostingClassifier).
"""

from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import logging
import numpy as np
import joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance

from .config import MODEL_FILE, MODEL_VERSION, MODEL_ALGORITHM, ALL_FEATURES, PREDICTION_HORIZONS

logger = logging.getLogger('solvx.model')


class OceanHazardModel:
    """
    Multi-horizon Gradient Boosted Trees model predicting ocean hazard risk
    at 6-hour, 12-hour, and 24-hour lead times.
    """

    def __init__(self, feature_names: Optional[List[str]] = None):
        self.feature_names = feature_names or ALL_FEATURES
        self.horizons = PREDICTION_HORIZONS
        self.version = MODEL_VERSION
        self.algorithm = MODEL_ALGORITHM

        # Separate calibrated gradient boosted tree estimator per horizon
        self.estimators: Dict[int, HistGradientBoostingClassifier] = {
            h: HistGradientBoostingClassifier(
                max_iter=100,
                learning_rate=0.08,
                max_leaf_nodes=31,
                min_samples_leaf=20,
                l2_regularization=1.0,
                random_state=42 + h
            )
            for h in self.horizons
        }
        self.is_trained = False
        self.feature_importances_: Dict[str, float] = {}

    def fit(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: Optional[np.ndarray] = None,
        y_val: Optional[np.ndarray] = None
    ) -> "OceanHazardModel":
        """
        Fits each horizon's classifier on chronological training data.

        Args:
            X_train: (N, num_features)
            y_train: (N, 3) where columns correspond to [6h, 12h, 24h]
            X_val: optional validation features
            y_val: optional validation targets
        """
        logger.info("Fitting OceanHazardModel across %d horizons with %d samples...", len(self.horizons), len(X_train))

        for idx, h in enumerate(self.horizons):
            y_h = y_train[:, idx]
            est = self.estimators[h]
            est.fit(X_train, y_h)

        self.is_trained = True

        # Calculate feature importances using the 24h horizon model on training data
        try:
            perm = permutation_importance(
                self.estimators[24], X_train[:500], y_train[:500, 2],
                n_repeats=5, random_state=42
            )
            raw_imp = perm.importances_mean
            total_imp = float(np.sum(np.maximum(0, raw_imp)))
            if total_imp > 0:
                norm_imp = np.maximum(0, raw_imp) / total_imp
                self.feature_importances_ = {
                    name: round(float(norm_imp[i]), 4)
                    for i, name in enumerate(self.feature_names)
                }
            else:
                self.feature_importances_ = {name: round(1.0 / len(self.feature_names), 4) for name in self.feature_names}
        except Exception as e:
            logger.warning("Could not calculate permutation importances: %s; using uniform baseline", e)
            self.feature_importances_ = {name: round(1.0 / len(self.feature_names), 4) for name in self.feature_names}

        return self

    def predict_proba(self, X: np.ndarray) -> Dict[str, np.ndarray]:
        """
        Predicts calibrated hazard risk probabilities for each horizon.

        Args:
            X: 2D array of shape (N, num_features) or 1D array of shape (num_features,)

        Returns:
            Dictionary with keys 'risk_6h', 'risk_12h', 'risk_24h' mapping to 1D arrays of probabilities.
        """
        if not self.is_trained:
            raise RuntimeError("Model is not trained. Call fit() or load() before predict_proba().")

        if X.ndim == 1:
            X = X.reshape(1, -1)

        results = {}
        for h in self.horizons:
            est = self.estimators[h]
            probas = est.predict_proba(X)
            # Probability of positive hazard class (column 1)
            results[f'risk_{h}h'] = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

        return results

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> Dict[str, np.ndarray]:
        """Binary classification predictions based on threshold."""
        probas = self.predict_proba(X)
        return {k: (v >= threshold).astype(int) for k, v in probas.items()}

    def get_feature_importances(self) -> Dict[str, float]:
        """Returns sorted feature importances."""
        return dict(sorted(self.feature_importances_.items(), key=lambda item: item[1], reverse=True))

    def save(self, filepath: Optional[Path] = None) -> Path:
        """Serializes the trained model artifact to disk."""
        target_path = filepath or MODEL_FILE
        target_path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            'version': self.version,
            'algorithm': self.algorithm,
            'feature_names': self.feature_names,
            'horizons': self.horizons,
            'estimators': self.estimators,
            'feature_importances': self.feature_importances_,
            'is_trained': self.is_trained,
        }
        joblib.dump(payload, target_path)
        logger.info("Saved OceanHazardModel artifact to %s", target_path)
        return target_path

    @classmethod
    def load(cls, filepath: Optional[Path] = None) -> "OceanHazardModel":
        """Loads a serialized OceanHazardModel from disk."""
        target_path = filepath or MODEL_FILE
        if not target_path.exists():
            raise FileNotFoundError(f"Model artifact not found at {target_path}")

        payload = joblib.load(target_path)
        model = cls(feature_names=payload.get('feature_names', ALL_FEATURES))
        model.version = payload.get('version', MODEL_VERSION)
        model.algorithm = payload.get('algorithm', MODEL_ALGORITHM)
        model.horizons = payload.get('horizons', PREDICTION_HORIZONS)
        model.estimators = payload['estimators']
        model.feature_importances_ = payload.get('feature_importances', {})
        model.is_trained = payload.get('is_trained', True)
        return model
