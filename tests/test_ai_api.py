"""
SolvX — Stage 6 AI Assistant API Tests
======================================
Tests for:
- AI service status endpoint
- Scientific explanation grounding & deterministic fallback
- Natural language to 3D visualization command parsing
- Command schema validation & arbitrary action rejection
- Mocked Gemini API execution
"""

import json
from unittest.mock import patch, MagicMock
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from backend.main import app
from backend.models.ai import VisualizationCommand, AIQueryResponse, NLCommandResponse
from backend.services.ai_service import build_analysis_context

client = TestClient(app)


class TestAIStatus:
    def test_ai_status(self):
        """GET /api/ai/status returns valid status structure."""
        resp = client.get('/api/ai/status')
        assert resp.status_code == 200
        data = resp.json()
        assert 'available' in data
        assert isinstance(data['available'], bool)
        assert 'model' in data
        assert 'message' in data


class TestAnalysisContext:
    def test_build_analysis_context_contains_no_raw_grids(self):
        """Context must contain only structured summary metrics, no raw numpy arrays or NetCDFs."""
        ctx = build_analysis_context(variable='temperature', method='zscore')
        assert 'model_accuracy' in ctx
        assert 'observation_coverage' in ctx
        assert 'data_gaps' in ctx
        assert 'anomaly_count' in ctx
        assert 'top_anomalies' in ctx
        assert isinstance(ctx['top_anomalies'], list)
        # Verify JSON serializability (no complex/raw numpy types)
        dumped = json.dumps(ctx)
        assert len(dumped) > 50


class TestAIExplain:
    def test_explain_fallback_grounded(self):
        """POST /api/ai/explain returns scientifically grounded response even without API key."""
        resp = client.post('/api/ai/explain', json={
            'question': 'Where does the model disagree most with Argo floats?',
            'variable': 'temperature',
            'method': 'zscore'
        })
        assert resp.status_code == 200
        data = resp.json()
        assert 'explanation' in data
        assert len(data['explanation']) > 20
        assert 'data_sources' in data
        assert len(data['data_sources']) >= 1
        assert 'confidence' in data

    def test_query_alias(self):
        """POST /api/ai/query is an alias to /api/ai/explain per plan.md specification."""
        resp = client.post('/api/ai/query', json={
            'question': 'What is the overall model accuracy?',
            'variable': 'temperature'
        })
        assert resp.status_code == 200
        data = resp.json()
        assert 'explanation' in data

    @patch('backend.services.ai_service.genai.Client')
    def test_explain_mocked_gemini(self, mock_client_cls):
        """Simulate live Gemini response with structured output."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        mock_response = MagicMock()
        mock_response.text = json.dumps({
            'question': 'Explain temperature bias',
            'explanation': 'The numerical model displays a positive sea surface temperature bias of +0.42 °C.',
            'confidence': 'high',
            'data_sources': ['Copernicus Marine NEMO', 'WMO Argo Floats'],
            'command': {
                'action': 'FOCUS_REGION',
                'lat': 18.5,
                'lon': 88.2,
                'depth': 0.0,
                'variable': 'temperature',
                'layer': 'anomaly'
            },
            'disclaimer': 'Grounded in computed oceanographic analysis.'
        })
        mock_client.models.generate_content.return_value = mock_response

        resp = client.post(
            '/api/ai/explain',
            json={'question': 'Explain temperature bias', 'variable': 'temperature'},
            headers={'X-Gemini-Key': 'mock-api-key-12345'}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert '+0.42 °C' in data['explanation']
        assert data['command']['action'] == 'FOCUS_REGION'
        assert data['command']['lat'] == pytest.approx(18.5)


class TestNLCommand:
    def test_nl_command_set_depth(self):
        """Rule-based parsing translates 'set depth 150m' to SET_DEPTH action."""
        resp = client.post('/api/ai/command', json={'text': 'set depth to 150m', 'variable': 'temperature'})
        assert resp.status_code == 200
        data = resp.json()
        assert data['parsed_command']['action'] == 'SET_DEPTH'
        assert data['parsed_command']['depth'] == pytest.approx(150.0)

    def test_nl_command_set_variable(self):
        """Rule-based parsing translates 'show salinity' to SET_VARIABLE action."""
        resp = client.post('/api/ai/command', json={'text': 'show salinity', 'variable': 'temperature'})
        assert resp.status_code == 200
        data = resp.json()
        assert data['parsed_command']['action'] == 'SET_VARIABLE'
        assert data['parsed_command']['variable'] == 'salinity'

    def test_nl_command_focus_region(self):
        """Rule-based parsing translates 'focus on 18.5, 88.2' to FOCUS_REGION action."""
        resp = client.post('/api/ai/command', json={'text': 'focus on 18.5, 88.2 at 100m depth', 'variable': 'temperature'})
        assert resp.status_code == 200
        data = resp.json()
        assert data['parsed_command']['action'] == 'FOCUS_REGION'
        assert data['parsed_command']['lat'] == pytest.approx(18.5)
        assert data['parsed_command']['lon'] == pytest.approx(88.2)
        assert data['parsed_command']['depth'] == pytest.approx(100.0)

    @patch('backend.services.ai_service.genai.Client')
    def test_nl_command_mocked_gemini(self, mock_client_cls):
        """Test complex instruction translation with mocked Gemini."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        mock_response = MagicMock()
        mock_response.text = json.dumps({
            'action': 'VERTICAL_SLICE',
            'start_lat': 16.5,
            'start_lon': 84.5,
            'end_lat': 21.0,
            'end_lon': 91.0,
            'variable': 'temperature'
        })
        mock_client.models.generate_content.return_value = mock_response

        resp = client.post(
            '/api/ai/command',
            json={'text': 'create vertical transect from southwest to northeast', 'variable': 'temperature'},
            headers={'X-Gemini-Key': 'mock-api-key-12345'}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data['parsed_command']['action'] == 'VERTICAL_SLICE'
        assert data['parsed_command']['start_lat'] == pytest.approx(16.5)

    def test_visualization_command_rejects_arbitrary_action(self):
        """VisualizationCommand must reject arbitrary actions (plan.md line 705)."""
        with pytest.raises(ValidationError):
            VisualizationCommand(action="DELETE_ALL_DATA")

        with pytest.raises(ValidationError):
            VisualizationCommand(action="EXECUTE_SCRIPT")
