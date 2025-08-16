// CREATE FILE: api/bridge.js

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.BRIDGE_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Service URLs (can be overridden by environment variables)
const SERVICES = {
  pricing: process.env.PRICING_SERVICE_URL || 'http://localhost:8001',
  routing: process.env.ROUTING_SERVICE_URL || 'http://localhost:8002', 
  matching: process.env.MATCHING_SERVICE_URL || 'http://localhost:8003',
  escrow: process.env.ESCROW_SERVICE_URL || 'http://localhost:8004',
  rag: process.env.RAG_SERVICE_URL || 'http://localhost:8005'
};

// Docker Compose service names (used when running in containers)
if (process.env.DOCKER_ENV === 'true') {
  SERVICES.pricing = 'http://pricing_service:8001';
  SERVICES.routing = 'http://routing_service:8002';
  SERVICES.matching = 'http://matching_service:8003';
  SERVICES.escrow = 'http://escrow_service:8004';
  SERVICES.rag = 'http://rag_agent:8005';
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, services: SERVICES });
});

// Generic proxy function
async function proxyRequest(serviceUrl, path, method = 'GET', data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${serviceUrl}${path}`,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      timeout: 30000
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.data = data;
    }

    const response = await axios(config);
    return {
      success: true,
      data: response.data,
      status: response.status
    };
  } catch (error) {
    console.error(`Proxy error for ${serviceUrl}${path}:`, error.message);
    
    if (error.response) {
      return {
        success: false,
        error: error.response.data,
        status: error.response.status
      };
    } else if (error.request) {
      return {
        success: false,
        error: `Service unavailable: ${serviceUrl}`,
        status: 503
      };
    } else {
      return {
        success: false,
        error: error.message,
        status: 500
      };
    }
  }
}

// Pricing service endpoints
app.post('/api/pricing/calculate', async (req, res) => {
  const result = await proxyRequest(SERVICES.pricing, '/price', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.get('/api/pricing/config', async (req, res) => {
  const result = await proxyRequest(SERVICES.pricing, '/config', 'GET');
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

// Routing service endpoints
app.post('/api/routing/batch', async (req, res) => {
  const result = await proxyRequest(SERVICES.routing, '/batch', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.post('/api/routing/optimize', async (req, res) => {
  const result = await proxyRequest(SERVICES.routing, '/route', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

// Matching service endpoints
app.post('/api/matching/assign', async (req, res) => {
  const result = await proxyRequest(SERVICES.matching, '/assign', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.post('/api/matching/simulate_acceptance', async (req, res) => {
  const result = await proxyRequest(SERVICES.matching, '/simulate_acceptance', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

// Escrow service endpoints
app.post('/api/escrow/hold', async (req, res) => {
  const result = await proxyRequest(SERVICES.escrow, '/hold_funds', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.post('/api/escrow/release', async (req, res) => {
  const result = await proxyRequest(SERVICES.escrow, '/release_funds', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.post('/api/escrow/dispute', async (req, res) => {
  const result = await proxyRequest(SERVICES.escrow, '/dispute', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.get('/api/escrow/:escrowId', async (req, res) => {
  const result = await proxyRequest(SERVICES.escrow, `/escrow/${req.params.escrowId}`, 'GET');
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

// RAG service endpoints
app.post('/api/rag/query', async (req, res) => {
  const result = await proxyRequest(SERVICES.rag, '/query', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.post('/api/rag/ingest', async (req, res) => {
  const result = await proxyRequest(SERVICES.rag, '/ingest', 'POST', req.body);
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

app.get('/api/rag/stats', async (req, res) => {
  const result = await proxyRequest(SERVICES.rag, '/stats', 'GET');
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

// Service health checks
app.get('/api/health/:service', async (req, res) => {
  const service = req.params.service;
  if (!SERVICES[service]) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  const result = await proxyRequest(SERVICES[service], '/health', 'GET');
  res.status(result.status).json(result.success ? result.data : { error: result.error });
});

// List all services
app.get('/api/services', (req, res) => {
  res.json({
    services: SERVICES,
    docker_mode: process.env.DOCKER_ENV === 'true',
    bridge_version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Bridge error:', err);
  res.status(500).json({ error: 'Internal bridge error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`INC API Bridge running on port ${PORT}`);
  console.log('Services configured:');
  Object.entries(SERVICES).forEach(([name, url]) => {
    console.log(`  ${name}: ${url}`);
  });
  
  if (process.env.DOCKER_ENV === 'true') {
    console.log('Running in Docker Compose mode');
  }
});

module.exports = app;