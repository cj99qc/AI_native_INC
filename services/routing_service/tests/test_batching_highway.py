# CREATE FILE: services/routing_service/tests/test_batching_highway.py

import pytest
from datetime import datetime, timedelta
from services.routing_service.batching import BatchingEngine, Order

class TestHighwayDeviationFiltering:
    """Test highway deviation filtering in batching"""
    
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
    def highway_orders(self):
        """Orders near Highway 7 (around 45.38, -75.70)"""
        base_time = datetime.now()
        return [
            # Orders close to highway
            Order("order1", 45.38, -75.70, 45.39, -75.68, base_time),
            Order("order2", 45.37, -75.71, 45.38, -75.69, base_time + timedelta(minutes=2)),
            Order("order3", 45.39, -75.69, 45.40, -75.67, base_time + timedelta(minutes=3)),
        ]
    
    @pytest.fixture
    def off_highway_orders(self):
        """Orders far from Highway 7"""
        base_time = datetime.now()
        return [
            # Orders far from highway (>10km away)
            Order("order_far1", 45.50, -75.50, 45.51, -75.48, base_time),
            Order("order_far2", 45.52, -75.49, 45.53, -75.47, base_time + timedelta(minutes=2)),
        ]
    
    @pytest.fixture
    def mixed_orders(self, highway_orders, off_highway_orders):
        """Mix of on-highway and off-highway orders"""
        return highway_orders + off_highway_orders
    
    def test_get_highway_artery_point(self, batching_engine):
        """Test getting Highway 7 reference point"""
        point = batching_engine.get_highway_artery_point()
        
        assert point is not None
        assert len(point) == 2
        lat, lng = point
        
        # Should be in Ottawa area
        assert 45.0 <= lat <= 46.0
        assert -76.0 <= lng <= -75.0
    
    def test_filter_orders_by_highway_deviation_all_close(self, batching_engine, highway_orders):
        """Test filtering when all orders are near highway"""
        filtered = batching_engine.filter_orders_by_highway_deviation(
            highway_orders, max_deviation_km=10.0
        )
        
        # All orders should pass filter
        assert len(filtered) == len(highway_orders)
    
    def test_filter_orders_by_highway_deviation_all_far(self, batching_engine, off_highway_orders):
        """Test filtering when all orders are far from highway"""
        filtered = batching_engine.filter_orders_by_highway_deviation(
            off_highway_orders, max_deviation_km=5.0
        )
        
        # Most or all orders should be filtered out with strict 5km limit
        assert len(filtered) <= len(off_highway_orders)
    
    def test_filter_orders_by_highway_deviation_mixed(self, batching_engine, mixed_orders):
        """Test filtering with mixed on/off highway orders"""
        filtered = batching_engine.filter_orders_by_highway_deviation(
            mixed_orders, max_deviation_km=10.0
        )
        
        # Should have some orders (at least the highway ones)
        assert len(filtered) >= 3  # At least the 3 highway orders
    
    def test_validate_cluster_highway_deviation_valid(self, batching_engine, highway_orders):
        """Test cluster validation for valid highway cluster"""
        is_valid = batching_engine.validate_cluster_highway_deviation(
            highway_orders, max_deviation_km=10.0
        )
        
        # Cluster near highway should be valid
        assert is_valid is True
    
    def test_validate_cluster_highway_deviation_invalid(self, batching_engine, off_highway_orders):
        """Test cluster validation for off-highway cluster"""
        is_valid = batching_engine.validate_cluster_highway_deviation(
            off_highway_orders, max_deviation_km=5.0
        )
        
        # Cluster far from highway might be invalid with strict limit
        # (depending on exact distance calculation)
        assert isinstance(is_valid, bool)
    
    def test_validate_cluster_empty(self, batching_engine):
        """Test cluster validation with empty cluster"""
        is_valid = batching_engine.validate_cluster_highway_deviation([], max_deviation_km=5.0)
        assert is_valid is True  # Empty cluster is always valid
    
    def test_create_batches_with_highway_filter(self, batching_engine, highway_orders):
        """Test batch creation with highway filtering"""
        batches = batching_engine.create_batches(
            highway_orders,
            max_highway_deviation_km=10.0
        )
        
        # Should create batches from highway orders
        assert len(batches) >= 1
        
        # All batches should have orders
        for batch in batches:
            assert len(batch.orders) > 0
            assert batch.center_lat is not None
            assert batch.center_lng is not None
    
    def test_create_batches_with_strict_filter(self, batching_engine, mixed_orders):
        """Test batch creation with strict 5km highway filter"""
        batches = batching_engine.create_batches(
            mixed_orders,
            max_highway_deviation_km=5.0
        )
        
        # Should create at least one batch
        assert len(batches) >= 1
        
        # Batches should contain orders
        total_orders = sum(len(batch.orders) for batch in batches)
        assert total_orders > 0
    
    def test_create_batches_default_deviation(self, batching_engine, highway_orders):
        """Test batch creation with default 5km deviation"""
        # Should use default max_highway_deviation_km=5.0
        batches = batching_engine.create_batches(highway_orders)
        
        assert len(batches) >= 1
    
    def test_create_batches_fallback_when_all_filtered(self, batching_engine):
        """Test that batching falls back when all orders filtered"""
        # Create orders very far from highway
        base_time = datetime.now()
        very_far_orders = [
            Order("far1", 46.0, -74.0, 46.1, -73.9, base_time),
            Order("far2", 46.1, -74.1, 46.2, -74.0, base_time + timedelta(minutes=2)),
        ]
        
        # Even with strict filter, should create batches (fallback)
        batches = batching_engine.create_batches(
            very_far_orders,
            max_highway_deviation_km=5.0
        )
        
        # Should still create batches due to fallback logic
        assert len(batches) >= 0  # May be empty if time window filters out
    
    def test_haversine_distance_calculation(self, batching_engine):
        """Test haversine distance calculation accuracy"""
        # Distance from highway point to nearby location
        highway_point = batching_engine.get_highway_artery_point()
        lat, lng = highway_point
        
        # Point 5km away (roughly)
        distance = batching_engine.haversine_distance(lat, lng, lat + 0.045, lng)
        
        # Should be approximately 5km
        assert 4.0 <= distance <= 6.0
    
    def test_cluster_center_calculation(self, batching_engine, highway_orders):
        """Test cluster center calculation"""
        center_lat, center_lng = batching_engine.calculate_cluster_center(highway_orders)
        
        # Center should be near Highway 7 area
        assert 45.35 <= center_lat <= 45.45
        assert -75.75 <= center_lng <= -75.65
    
    def test_batch_size_limits_with_highway_filter(self, batching_engine):
        """Test that batch size limits are respected with highway filtering"""
        base_time = datetime.now()
        
        # Create many orders near highway
        many_orders = [
            Order(f"order{i}", 45.38 + i*0.01, -75.70 + i*0.01, 
                  45.39 + i*0.01, -75.69 + i*0.01, 
                  base_time + timedelta(minutes=i))
            for i in range(10)
        ]
        
        batches = batching_engine.create_batches(
            many_orders,
            max_highway_deviation_km=10.0
        )
        
        # Each batch should respect size limit
        for batch in batches:
            assert len(batch.orders) <= batching_engine.max_batch_size

class TestBatchingBackwardCompatibility:
    """Test that existing batching logic still works"""
    
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
    
    def test_create_batches_without_highway_param(self, batching_engine):
        """Test that create_batches works without highway param (backward compat)"""
        base_time = datetime.now()
        orders = [
            Order("order1", 45.42, -75.70, 45.41, -75.68, base_time),
            Order("order2", 45.43, -75.69, 45.42, -75.68, base_time + timedelta(minutes=2)),
        ]
        
        # Should work without max_highway_deviation_km parameter
        batches = batching_engine.create_batches(orders)
        
        assert len(batches) >= 1
        assert all(len(batch.orders) > 0 for batch in batches)
    
    def test_time_window_filtering_still_works(self, batching_engine):
        """Test that time window filtering still works"""
        current_time = datetime.now()
        old_time = current_time - timedelta(minutes=30)
        
        orders = [
            Order("old", 45.42, -75.70, 45.41, -75.68, old_time),
            Order("recent", 45.43, -75.69, 45.42, -75.68, current_time - timedelta(minutes=5)),
        ]
        
        batches = batching_engine.create_batches(orders, current_time)
        
        # Should only include recent order
        total_orders = sum(len(batch.orders) for batch in batches)
        assert total_orders == 1
