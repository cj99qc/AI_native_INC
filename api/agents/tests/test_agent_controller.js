// CREATE FILE: api/agents/tests/test_agent_controller.js

const request = require('supertest');
const express = require('express');
const agentController = require('../agent_controller');

describe('Agent Controller', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agent', agentController);
    
    // Mock environment variables
    process.env.FEATURE_AGENT_ORCHESTRATION = 'true';
    process.env.AGENT_TIMEOUT_MS = '5000';
    process.env.AGENT_MAX_TOOL_CALLS = '5';
  });

  afterAll(() => {
    delete process.env.FEATURE_AGENT_ORCHESTRATION;
    delete process.env.AGENT_TIMEOUT_MS;
    delete process.env.AGENT_MAX_TOOL_CALLS;
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/agent/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service', 'agent_orchestration');
      expect(response.body).toHaveProperty('enabled', true);
      expect(response.body).toHaveProperty('tools');
      expect(response.body).toHaveProperty('config');
    });
  });

  describe('GET /tools', () => {
    it('should return available tools', async () => {
      const response = await request(app)
        .get('/api/agent/tools')
        .expect(200);

      expect(response.body).toHaveProperty('tools');
      expect(response.body).toHaveProperty('enabled', true);
      expect(response.body.tools).toHaveProperty('pricing');
      expect(response.body.tools).toHaveProperty('routing');
      expect(response.body.tools).toHaveProperty('rag');
      expect(response.body.tools).toHaveProperty('escrow');
    });
  });

  describe('POST /run', () => {
    it('should handle dry run requests', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: 'Calculate delivery cost for $25 order',
          mode: 'sync',
          dry_run: true
        })
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('request_id');
      expect(response.body).toHaveProperty('intent');
      expect(response.body).toHaveProperty('actions');
      expect(response.body).toHaveProperty('final');
      expect(response.body).toHaveProperty('processing_time_ms');
    });

    it('should classify pricing intent correctly', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: 'What is the cost for delivery?',
          dry_run: true
        })
        .expect(200);

      expect(response.body.intent).toBe('pricing');
    });

    it('should classify routing intent correctly', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: 'Optimize route from downtown to university',
          dry_run: true
        })
        .expect(200);

      expect(response.body.intent).toBe('routing');
    });

    it('should classify search intent correctly', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: 'Find information about delivery policies',
          dry_run: true
        })
        .expect(200);

      expect(response.body.intent).toBe('search');
    });

    it('should require prompt parameter', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Missing required field: prompt');
    });

    it('should handle disabled feature flag', async () => {
      // Temporarily disable the feature
      process.env.FEATURE_AGENT_ORCHESTRATION = 'false';

      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: 'Test prompt'
        })
        .expect(501);

      expect(response.body.error).toContain('Agent orchestration is disabled');

      // Re-enable for other tests
      process.env.FEATURE_AGENT_ORCHESTRATION = 'true';
    });

    it('should handle payment intents with confirmation requirement', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: 'Pay for my order',
          dry_run: false // Test real payment action
        })
        .expect(200);

      expect(response.body.intent).toBe('payment');
      
      // Should have an action that requires confirmation
      const escrowActions = response.body.actions.filter(action => action.tool === 'escrow');
      expect(escrowActions.length).toBeGreaterThan(0);
      
      // Check if confirmation is required
      const hasConfirmationRequirement = escrowActions.some(action => 
        action.result && action.result.requires_confirmation
      );
      expect(hasConfirmationRequirement).toBe(true);
    });
  });

  describe('Feature Flag Behavior', () => {
    it('should respect disabled agent orchestration', async () => {
      process.env.FEATURE_AGENT_ORCHESTRATION = 'false';

      const healthResponse = await request(app)
        .get('/api/agent/health')
        .expect(200);

      expect(healthResponse.body.enabled).toBe(false);

      const toolsResponse = await request(app)
        .get('/api/agent/tools')
        .expect(501);

      expect(toolsResponse.body.error).toContain('Agent orchestration is disabled');

      process.env.FEATURE_AGENT_ORCHESTRATION = 'true';
    });
  });

  describe('Intent Classification', () => {
    const testCases = [
      { prompt: 'How much does delivery cost?', expected: 'pricing' },
      { prompt: 'Calculate the price for my order', expected: 'pricing' },
      { prompt: 'Find the best route to downtown', expected: 'routing' },
      { prompt: 'Optimize my delivery route', expected: 'routing' },
      { prompt: 'Search for restaurant information', expected: 'search' },
      { prompt: 'Find details about my order', expected: 'search' },
      { prompt: 'Process payment for order', expected: 'payment' },
      { prompt: 'Release escrow funds', expected: 'payment' },
      { prompt: 'Hello there', expected: 'general' }
    ];

    testCases.forEach(({ prompt, expected }) => {
      it(`should classify "${prompt}" as ${expected}`, async () => {
        const response = await request(app)
          .post('/api/agent/run')
          .send({
            user_id: 'test_user',
            prompt: prompt,
            dry_run: true
          })
          .expect(200);

        expect(response.body.intent).toBe(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON in request body', async () => {
      const response = await request(app)
        .post('/api/agent/run')
        .send('invalid json')
        .expect(400);
    });

    it('should handle very long prompts', async () => {
      const longPrompt = 'A'.repeat(10000);
      
      const response = await request(app)
        .post('/api/agent/run')
        .send({
          user_id: 'test_user',
          prompt: longPrompt,
          dry_run: true
        })
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });
});

describe('Tool Wrappers', () => {
  const pricingTool = require('../tools/pricing');
  const routingTool = require('../tools/routing');
  const ragTool = require('../tools/rag');
  const escrowTool = require('../tools/escrow');

  describe('Pricing Tool', () => {
    it('should have correct name and description', () => {
      expect(pricingTool.name).toBe('pricing');
      expect(pricingTool.description).toContain('pricing');
    });

    it('should list available actions', () => {
      const actions = pricingTool.getAvailableActions();
      expect(actions).toContain('calculate');
      expect(actions).toContain('estimate');
      expect(actions).toContain('bulk_calculate');
    });
  });

  describe('Routing Tool', () => {
    it('should have correct name and description', () => {
      expect(routingTool.name).toBe('routing');
      expect(routingTool.description).toContain('route');
    });

    it('should list available actions', () => {
      const actions = routingTool.getAvailableActions();
      expect(actions).toContain('optimize');
      expect(actions).toContain('batch');
    });
  });

  describe('RAG Tool', () => {
    it('should have correct name and description', () => {
      expect(ragTool.name).toBe('rag');
      expect(ragTool.description).toContain('knowledge');
    });

    it('should list available actions', () => {
      const actions = ragTool.getAvailableActions();
      expect(actions).toContain('query');
      expect(actions).toContain('search');
    });
  });

  describe('Escrow Tool', () => {
    it('should have correct name and description', () => {
      expect(escrowTool.name).toBe('escrow');
      expect(escrowTool.description).toContain('payment');
    });

    it('should list available actions', () => {
      const actions = escrowTool.getAvailableActions();
      expect(actions).toContain('check_status');
      expect(actions).toContain('hold_funds');
      expect(actions).toContain('release_funds');
    });
  });
});