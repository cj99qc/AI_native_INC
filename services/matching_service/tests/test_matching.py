# CREATE FILE: services/matching_service/tests/test_matching.py

import pytest
import math
from datetime import datetime, timedelta
from services.matching_service.app import (
    MatchingEngine, Driver, DriverStatus, BatchData, DriverScore
)

class TestTrajectoryMatching:
    """Test trajectory-based driver matching"""
    
    @pytest.fixture
    def config(self):
        return {"seed": 42}
    
    @pytest.fixture
    def matching_engine(self, config):
        return MatchingEngine(config)
    
    @pytest.fixture
    def sample_batch(self):
        """Create a sample batch near Highway 7"""
        return BatchData(
            id="batch_001",
            center_lat=45.38,  # Near Highway 7
            center_lng=-75.70,
            total_orders=3,
            estimated_duration_minutes=45,
            priority=5
        )
    
    def test_haversine_distance(self, matching_engine):
        """Test haversine distance calculation"""
        # Distance between two points in Ottawa area (roughly 5km apart)
        distance = matching_engine.haversine_distance(45.38, -75.70, 45.42, -75.68)
        assert 4.0 <= distance <= 6.0  # Should be around 5km
    
    def test_trajectory_score_moving_toward(self, matching_engine):
        """Test trajectory score when driver is moving toward pickup"""
        # Driver moving north-east toward pickup
        driver = Driver(
            id="driver_001",
            lat=45.36,
            lng=-75.72,
            rating=4.8,
            vehicle_capacity=4,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=6,
            previous_location=DriverStatus(
                lat=45.35,  # Was south
                lng=-75.73,  # Was west
                timestamp=datetime.now() - timedelta(minutes=5)
            )
        )
        
        # Pickup is northeast of current position
        pickup_lat, pickup_lng = 45.38, -75.70
        
        score = matching_engine.calculate_trajectory_score(driver, pickup_lat, pickup_lng)
        
        # Should have a high score (moving toward pickup)
        assert score > 0.6, f"Expected high trajectory score but got {score}"
    
    def test_trajectory_score_moving_away(self, matching_engine):
        """Test trajectory score when driver is moving away from pickup"""
        # Driver moving south-west away from pickup
        driver = Driver(
            id="driver_002",
            lat=45.36,
            lng=-75.72,
            rating=4.8,
            vehicle_capacity=4,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=6,
            previous_location=DriverStatus(
                lat=45.37,  # Was north (closer to pickup)
                lng=-75.71,  # Was east (closer to pickup)
                timestamp=datetime.now() - timedelta(minutes=5)
            )
        )
        
        # Pickup is northeast of current position
        pickup_lat, pickup_lng = 45.38, -75.70
        
        score = matching_engine.calculate_trajectory_score(driver, pickup_lat, pickup_lng)
        
        # Should have a low score (moving away from pickup)
        assert score < 0.4, f"Expected low trajectory score but got {score}"
    
    def test_trajectory_score_no_previous_location(self, matching_engine):
        """Test trajectory score when no previous location available"""
        driver = Driver(
            id="driver_003",
            lat=45.36,
            lng=-75.72,
            rating=4.8,
            vehicle_capacity=4,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=6,
            previous_location=None  # No trajectory data
        )
        
        score = matching_engine.calculate_trajectory_score(driver, 45.38, -75.70)
        
        # Should return neutral score
        assert score == 0.5
    
    def test_trajectory_score_stationary_driver(self, matching_engine):
        """Test trajectory score when driver is stationary"""
        driver = Driver(
            id="driver_004",
            lat=45.36,
            lng=-75.72,
            rating=4.8,
            vehicle_capacity=4,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=6,
            previous_location=DriverStatus(
                lat=45.36,  # Same position
                lng=-75.72,  # Same position
                timestamp=datetime.now() - timedelta(minutes=5)
            )
        )
        
        score = matching_engine.calculate_trajectory_score(driver, 45.38, -75.70)
        
        # Should return neutral score for stationary driver
        assert score == 0.5
    
    def test_artery_proximity_score_both_near_highway(self, matching_engine):
        """Test artery score when both driver and pickup are near Highway 7"""
        # This test will work without PostGIS (returns fallback score)
        driver_lat, driver_lng = 45.38, -75.70  # Near Highway 7 center
        pickup_lat, pickup_lng = 45.39, -75.68  # Also near Highway 7
        
        score = matching_engine.calculate_artery_proximity_score(
            driver_lat, driver_lng, pickup_lat, pickup_lng
        )
        
        # Should return a score (0.5 fallback if no PostGIS, or calculated score)
        assert 0.3 <= score <= 1.0
    
    def test_composite_score_with_trajectory(self, matching_engine, sample_batch):
        """Test composite score calculation with trajectory data"""
        driver = Driver(
            id="driver_005",
            lat=45.37,
            lng=-75.71,
            rating=4.9,
            vehicle_capacity=6,
            is_active=True,
            current_orders=2,
            max_concurrent_orders=8,
            previous_location=DriverStatus(
                lat=45.36,
                lng=-75.72,
                timestamp=datetime.now() - timedelta(minutes=5)
            )
        )
        
        distance = matching_engine.haversine_distance(
            driver.lat, driver.lng,
            sample_batch.center_lat, sample_batch.center_lng
        )
        
        score = matching_engine.calculate_composite_score(
            driver, sample_batch, distance, max_distance=50.0
        )
        
        assert isinstance(score, DriverScore)
        assert score.driver_id == "driver_005"
        assert 0.0 <= score.score <= 1.0
        assert score.artery_score is not None
        assert score.trajectory_score is not None
        assert 0.0 <= score.artery_score <= 1.0
        assert 0.0 <= score.trajectory_score <= 1.0
    
    def test_capacity_score(self, matching_engine, sample_batch):
        """Test capacity scoring logic"""
        # Driver with available capacity
        driver = Driver(
            id="driver_006",
            lat=45.38,
            lng=-75.70,
            rating=4.8,
            vehicle_capacity=6,
            is_active=True,
            current_orders=2,
            max_concurrent_orders=8
        )
        
        score = matching_engine.calculate_capacity_score(driver, sample_batch)
        assert score > 0.0, "Driver should have capacity for batch"
    
    def test_capacity_score_full_driver(self, matching_engine, sample_batch):
        """Test capacity scoring for fully loaded driver"""
        # Driver at max capacity
        driver = Driver(
            id="driver_007",
            lat=45.38,
            lng=-75.70,
            rating=4.8,
            vehicle_capacity=6,
            is_active=True,
            current_orders=8,
            max_concurrent_orders=8
        )
        
        score = matching_engine.calculate_capacity_score(driver, sample_batch)
        assert score == 0.0, "Full driver should have zero capacity score"
    
    def test_distance_score_within_range(self, matching_engine):
        """Test distance scoring within acceptable range"""
        score = matching_engine.calculate_distance_score(10.0, 50.0)
        assert score > 0.0
        
        # Closer distance should have higher score
        close_score = matching_engine.calculate_distance_score(5.0, 50.0)
        far_score = matching_engine.calculate_distance_score(40.0, 50.0)
        assert close_score > far_score
    
    def test_distance_score_beyond_range(self, matching_engine):
        """Test distance scoring beyond maximum range"""
        score = matching_engine.calculate_distance_score(60.0, 50.0)
        assert score == 0.0, "Distance beyond max should have zero score"
    
    def test_rating_score(self, matching_engine):
        """Test rating score calculation"""
        assert matching_engine.calculate_rating_score(5.0) == 1.0
        assert matching_engine.calculate_rating_score(4.0) == 0.8
        assert matching_engine.calculate_rating_score(2.5) == 0.5
    
    def test_availability_score(self, matching_engine):
        """Test availability scoring"""
        # Inactive driver
        inactive_driver = Driver(
            id="driver_008",
            lat=45.38,
            lng=-75.70,
            rating=4.8,
            vehicle_capacity=6,
            is_active=False,
            current_orders=0,
            max_concurrent_orders=8
        )
        assert matching_engine.calculate_availability_score(inactive_driver) == 0.0
        
        # Active driver with no load
        active_driver = Driver(
            id="driver_009",
            lat=45.38,
            lng=-75.70,
            rating=4.8,
            vehicle_capacity=6,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=8
        )
        assert matching_engine.calculate_availability_score(active_driver) == 1.0
        
        # Active driver with partial load
        busy_driver = Driver(
            id="driver_010",
            lat=45.38,
            lng=-75.70,
            rating=4.8,
            vehicle_capacity=6,
            is_active=True,
            current_orders=4,
            max_concurrent_orders=8
        )
        score = matching_engine.calculate_availability_score(busy_driver)
        assert 0.0 < score < 1.0

class TestMatchingIntegration:
    """Integration tests for complete matching workflow"""
    
    @pytest.fixture
    def config(self):
        return {"seed": 42}
    
    @pytest.fixture
    def matching_engine(self, config):
        return MatchingEngine(config)
    
    def test_find_best_drivers(self, matching_engine):
        """Test finding and ranking best drivers"""
        batch = BatchData(
            id="batch_integration",
            center_lat=45.38,
            center_lng=-75.70,
            total_orders=2,
            estimated_duration_minutes=30,
            priority=5
        )
        
        drivers = [
            Driver(
                id="driver_close",
                lat=45.38,
                lng=-75.70,  # Very close
                rating=4.5,
                vehicle_capacity=4,
                is_active=True,
                current_orders=0,
                max_concurrent_orders=6,
                previous_location=DriverStatus(
                    lat=45.37,
                    lng=-75.71,
                    timestamp=datetime.now() - timedelta(minutes=5)
                )
            ),
            Driver(
                id="driver_far",
                lat=45.50,
                lng=-75.50,  # Far away
                rating=5.0,
                vehicle_capacity=8,
                is_active=True,
                current_orders=0,
                max_concurrent_orders=10
            ),
            Driver(
                id="driver_inactive",
                lat=45.38,
                lng=-75.70,
                rating=4.8,
                vehicle_capacity=6,
                is_active=False,  # Inactive
                current_orders=0,
                max_concurrent_orders=8
            )
        ]
        
        results = matching_engine.find_best_drivers(batch, drivers, max_distance=50.0)
        
        # Should have results
        assert len(results) > 0
        
        # Results should be sorted by score
        for i in range(len(results) - 1):
            assert results[i].score >= results[i+1].score
        
        # Inactive driver should have zero score
        inactive_result = next((r for r in results if r.driver_id == "driver_inactive"), None)
        if inactive_result:
            assert inactive_result.score == 0.0
