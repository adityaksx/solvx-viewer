"""
SolvX — ML Model Training Pipeline
==================================
Runs the end-to-end training workflow:
1. Builds aligned chronological dataset from historical NetCDF ocean and atmospheric data
2. Trains multi-horizon OceanHazardModel using Gradient Boosted Trees
3. Evaluates predictions on the held-out test period
4. Serializes the trained model and test metadata for production serving
(Plan.md Section 5, 7, 8, 9, 30)
"""

import json
import logging
import datetime
from pathlib import Path
from typing import Dict, Any

from .config import MODEL_FILE, METADATA_FILE, MODEL_VERSION, MODEL_ALGORITHM
from .dataset_builder import DatasetBuilder
from .model import OceanHazardModel
from .evaluation import evaluate_model

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("solvx.train")


def run_training(stride: int = 3) -> Dict[str, Any]:
    """
    Executes reproducible ML training and persists model artifacts.

    Args:
        stride: Spatial subsampling stride for dataset extraction.

    Returns:
        Metadata dictionary summarizing training and test performance.
    """
    logger.info("=" * 60)
    logger.info("SolvX Ocean Hazard Risk Model — Starting Training Workflow")
    logger.info("=" * 60)

    # 1. Build chronological dataset
    logger.info("1/4: Building chronological dataset from NetCDF ocean models...")
    builder = DatasetBuilder(stride=stride)
    X_train, y_train, X_val, y_val, X_test, y_test, dataset_meta = builder.build_dataset()

    logger.info(
        "Dataset extracted: Train=%d samples (%s), Val=%d samples (%s), Test=%d samples (%s)",
        len(X_train), dataset_meta['train_period'],
        len(X_val), dataset_meta['val_period'],
        len(X_test), dataset_meta['test_period']
    )

    # 2. Train OceanHazardModel
    logger.info("2/4: Training multi-horizon Gradient Boosted Trees model...")
    model = OceanHazardModel(feature_names=dataset_meta['features'])
    model.fit(X_train, y_train, X_val, y_val)

    # 3. Evaluate model on unseen test split
    logger.info("3/4: Evaluating model on chronological test split...")
    eval_report = evaluate_model(model, X_test, y_test, horizons=dataset_meta['horizons'])

    logger.info(
        "Evaluation summary: Mean F1=%.4f, Mean ROC-AUC=%s, Mean PR-AUC=%s, Mean Brier=%.4f",
        eval_report['overall']['mean_f1'],
        str(eval_report['overall']['mean_roc_auc']),
        str(eval_report['overall']['mean_pr_auc']),
        eval_report['overall']['mean_brier_score']
    )

    # 4. Save model artifact and metadata
    logger.info("4/4: Persisting model artifact and validation metadata...")
    model.save(MODEL_FILE)

    metadata = {
        'model_name': 'Ocean Hazard Risk Model',
        'version': MODEL_VERSION,
        'algorithm': MODEL_ALGORITHM,
        'status': 'Trained and Active',
        'trained_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'dataset_summary': dataset_meta,
        'test_metrics': eval_report,
        'feature_importances': model.get_feature_importances(),
        'input_features': dataset_meta['features'],
    }

    METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(METADATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    logger.info("Saved model metadata to %s", METADATA_FILE)
    logger.info("Training complete! Model is ready for deployment.")
    return metadata


if __name__ == '__main__':
    run_training()
