# CREATE FILE: services/routing_service/tests/test_routing.py

import pytest
import math
from datetime import datetime, timedelta
from services.routing_service.batching import BatchingEngine, Order, Batch
from services.routing_service.routing import RoutingEngine, RouteStop

class TestBatchingEngine:
    
    @pytest.fixture
    def config(self):
        return {
            "max_batch_size_orders": 4,
            "batch_window_minutes": 15,
            "seed": 42
        }
    
    @pytest.fixture
    def batching_engine(self, config):
        return BatchingEngine(config)
    
    @pytest.fixture
    def sample_orders(self):
        """Create sample orders for Ottawa area"""
        base_time = datetime.now()
        return [
            Order("order1", 45.4215, -75.6972, 45.4105, -75.6812, base_time),  # Downtown Ottawa
            Order("order2", 45.4235, -75.6985, 45.4125, -75.6825, base_time + timedelta(minutes=2)),
            Order("order3", 45.3555, -75.7570, 45.3445, -75.7460, base_time + timedelta(minutes=5)),  # Kanata
            Order("order4", 45.3575, -75.7580, 45.3465, -75.7470, base_time + timedelta(minutes=7)),
            Order("order5", 45.4825, -75.6465, 45.4715, -75.6355, base_time + timedelta(minutes=10))  # Orleans
        ]
    
    def test_haversine_distance(self, batching_engine):
        """Test haversine distance calculation"""
        # Distance between Ottawa City Hall and Parliament Hill (roughly 1km)
        distance = batching_engine.haversine_distance(45.4215, -75.6972, 45.4236, -75.7023)
        assert 0.8 <= distance <= 1.2  # Should be around 1km
    
    def test_create_batches_deterministic(self, batching_engine, sample_orders):
        """Test that batching is deterministic with same seed"""
        batches1 = batching_engine.create_batches(sample_orders[:3])
        batches2 = batching_engine.create_batches(sample_orders[:3])
        
        assert len(batches1) == len(batches2)
        if batches1:
            assert len(batches1[0].orders) == len(batches2[0].orders)
    
    def test_batch_size_limits(self, batching_engine, sample_orders):
        """Test that batches respect size limits"""
        batches = batching_engine.create_batches(sample_orders)
        
        for batch in batches:
            assert len(batch.orders) <= batching_engine.max_batch_size
            assert len(batch.orders) >= 1
    
    def test_time_window_filtering(self, batching_engine):
        """Test that orders outside time window are filtered"""
        base_time = datetime.now()
        old_order = Order("old", 45.4215, -75.6972, 45.4105, -75.6812, 
                         base_time - timedelta(minutes=30))  # Outside window
        recent_order = Order("recent", 45.4235, -75.6985, 45.4125, -75.6825, 
                           base_time - timedelta(minutes=5))  # Within window
        
        orders = [old_order, recent_order]
        batches = batching_engine.create_batches(orders, base_time)
        
        # Should only batch the recent order
        total_orders_in_batches = sum(len(batch.orders) for batch in batches)
        assert total_orders_in_batches == 1
    
    def test_empty_orders(self, batching_engine):
        """Test handling of empty order list"""
        batches = batching_engine.create_batches([])
        assert len(batches) == 0

class TestRoutingEngine:
    
    @pytest.fixture
    def config(self):
        return {
            "max_detour_pct": 30.0,
            "tsp_2opt_iterations": 50,  # Reduced for faster tests
            "seed": 42
        }
    
    @pytest.fixture
    def routing_engine(self, config):
        return RoutingEngine(config)
    
    @pytest.fixture
    def sample_batch(self):
        """Create a sample batch for testing"""
        orders = [
            Order("order1", 45.4215, -75.6972, 45.4105, -75.6812, datetime.now()),
            Order("order2", 45.4235, -75.6985, 45.4125, -75.6825, datetime.now()),
        ]
        return Batch("test_batch", orders, 45.4225, -75.6978, datetime.now())
    
    def test_distance_matrix_creation(self, routing_engine):
        """Test distance matrix creation"""
        points = [(45.4215, -75.6972), (45.4235, -75.6985), (45.4105, -75.6812)]
        matrix = routing_engine.create_distance_matrix(points)
        
        assert len(matrix) == 3
        assert len(matrix[0]) == 3
        assert matrix[0][0] == 0.0  # Distance to self should be 0
        assert matrix[0][1] == matrix[1][0]  # Should be symmetric
        assert matrix[0][1] > 0  # Distance between different points should be > 0
    
    def test_nearest_neighbor_tsp(self, routing_engine):
        """Test TSP solver"""
        # Simple 3-point TSP
        distance_matrix = [
            [0, 10, 20],
            [10, 0, 15],
            [20, 15, 0]
        ]
        
        tour, distance = routing_engine.nearest_neighbor_tsp(distance_matrix, 0)
        
        assert len(tour) == 4  # Should return to start
        assert tour[0] == 0  # Should start at specified index
        assert tour[-1] == 0  # Should end at start
        assert distance > 0
    
    def test_pickup_before_delivery_constraint(self, routing_engine):
        """Test that pickups always happen before deliveries"""
        stops = [
            RouteStop("order1", "delivery", 45.4105, -75.6812, 0),
            RouteStop("order1", "pickup", 45.4215, -75.6972, 1),
            RouteStop("order2", "delivery", 45.4125, -75.6825, 2),
            RouteStop("order2", "pickup", 45.4235, -75.6985, 3),
        ]
        
        reordered = routing_engine.enforce_pickup_before_delivery(stops)
        
        # All pickups should come before all deliveries
        pickup_indices = [i for i, stop in enumerate(reordered) if stop.stop_type == "pickup"]
        delivery_indices = [i for i, stop in enumerate(reordered) if stop.stop_type == "delivery"]
        
        assert max(pickup_indices) < min(delivery_indices)
    
    def test_heuristic_route_basic(self, routing_engine, sample_batch):
        """Test basic heuristic routing"""
        route = routing_engine.heuristic_route(sample_batch)
        
        assert route.batch_id == sample_batch.id
        assert len(route.stops) == 4  # 2 orders × (pickup + delivery)
        assert route.total_distance_km > 0
        assert route.estimated_duration_minutes > 0
        assert route.optimization_algorithm == "heuristic_2opt"
        assert 0 <= route.optimization_score <= 100
        
        # Check that stops are properly sequenced
        for i, stop in enumerate(route.stops):
            assert stop.sequence == i
    
    def test_empty_batch_routing(self, routing_engine):
        """Test routing with empty batch"""
        empty_batch = Batch("empty", [], 0, 0, datetime.now())
        route = routing_engine.heuristic_route(empty_batch)
        
        assert len(route.stops) == 0
        assert route.total_distance_km == 0
        assert route.estimated_duration_minutes == 0
    
    def test_route_with_driver_location(self, routing_engine, sample_batch):
        """Test routing with specific driver location"""
        driver_location = (45.4000, -75.7000)  # Different from batch center
        
        route = routing_engine.heuristic_route(sample_batch, driver_location)
        
        assert len(route.stops) == 4
        assert route.total_distance_km > 0
    
    def test_deterministic_routing(self, routing_engine, sample_batch):
        """Test that routing is deterministic"""
        route1 = routing_engine.heuristic_route(sample_batch)
        route2 = routing_engine.heuristic_route(sample_batch)
        
        assert route1.total_distance_km == route2.total_distance_km
        assert len(route1.stops) == len(route2.stops)
        
        # Stop sequences should be the same
        for i in range(len(route1.stops)):
            assert route1.stops[i].order_id == route2.stops[i].order_id
            assert route1.stops[i].stop_type == route2.stops[i].stop_type

class TestIntegration:
    """Integration tests for batching + routing"""
    
    @pytest.fixture
    def config(self):
        return {
            "max_batch_size_orders": 4,
            "batch_window_minutes": 15,
            "max_detour_pct": 30.0,
            "tsp_2opt_iterations": 50,
            "seed": 42
        }
    
    def test_batch_and_route_workflow(self, config):
        """Test complete workflow from orders to routes"""
        batching_engine = BatchingEngine(config)
        routing_engine = RoutingEngine(config)
        
        # Create sample orders
        orders = [
            Order("order1", 45.4215, -75.6972, 45.4105, -75.6812, datetime.now()),
            Order("order2", 45.4235, -75.6985, 45.4125, -75.6825, datetime.now()),
            Order("order3", 45.3555, -75.7570, 45.3445, -75.7460, datetime.now()),
        ]
        
        # Create batches
        batches = batching_engine.create_batches(orders)
        assert len(batches) >= 1
        
        # Route each batch
        for batch in batches:
            route = routing_engine.optimize_route(batch)
            assert len(route.stops) == len(batch.orders) * 2  # pickup + delivery per order
            assert route.total_distance_km > 0
            
            # Verify pickup-before-delivery constraint
            order_stops = {}
            for stop in route.stops:
                if stop.order_id not in order_stops:
                    order_stops[stop.order_id] = []
                order_stops[stop.order_id].append(stop)
            
            for order_id, stops in order_stops.items():
                pickup_seq = next(s.sequence for s in stops if s.stop_type == "pickup")
                delivery_seq = next(s.sequence for s in stops if s.stop_type == "delivery")
                assert pickup_seq < delivery_seq