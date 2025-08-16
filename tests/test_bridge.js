# CREATE FILE: tests/test_bridge.js

const request = require('supertest');
const app = require('../api/bridge');

describe('API Bridge', () => {
  describe('Health Checks', () => {
    test('Bridge health check', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('services');
    });
    
    test('Services list', async () => {
      const response = await request(app)
        .get('/api/services')
        .expect(200);
      
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('pricing');
      expect(response.body.services).toHaveProperty('routing');
      expect(response.body.services).toHaveProperty('matching');
      expect(response.body.services).toHaveProperty('escrow');
      expect(response.body.services).toHaveProperty('rag');
    });
  });
  
  describe('Service Proxying', () => {
    // These tests would require actual services running
    // For now, we'll just test the endpoint structure
    
    test('Pricing endpoint exists', async () => {
      // This will likely return 503 (service unavailable) unless services are running
      const response = await request(app)
        .post('/api/pricing/calculate')
        .send({
          order_total: 40.0,
          distance_km: 5.0
        });
      
      // Should be 503 if service is not running, or 200/400 if it is
      expect([200, 400, 503]).toContain(response.status);
    });
    
    test('Routing endpoint exists', async () => {
      const response = await request(app)
        .post('/api/routing/batch')
        .send({
          orders: []
        });
      
      expect([200, 400, 503]).toContain(response.status);
    });
    
    test('Invalid service returns 404', async () => {
      const response = await request(app)
        .get('/api/health/nonexistent')
        .expect(404);
      
      expect(response.body).toHaveProperty('error', 'Service not found');
    });
  });
  
  describe('Error Handling', () => {
    test('Invalid JSON in request body', async () => {
      const response = await request(app)
        .post('/api/pricing/calculate')
        .send('invalid json')
        .set('Content-Type', 'application/json');
      
      expect([400, 503]).toContain(response.status);
    });
  });
});