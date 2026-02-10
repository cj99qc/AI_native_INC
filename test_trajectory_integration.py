#!/usr/bin/env python3
"""
Integration test script for trajectory-based matching

This script tests the full workflow:
1. Create batches with highway deviation filtering
2. Match drivers using trajectory-based scoring
"""

import sys
import os
import json
from datetime import datetime, timedelta

# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, project_root)

from services.routing_service.batching import BatchingEngine, Order
from services.matching_service.app import MatchingEngine, Driver, DriverStatus, BatchData

def test_integration():
    """Test complete trajectory matching workflow"""
    
    print("=" * 70)
    print("TRAJECTORY MATCHING INTEGRATION TEST")
    print("=" * 70)
    
    # Initialize engines
    config = {"seed": 42, "max_batch_size_orders": 8, "batch_window_minutes": 15}
    batching_engine = BatchingEngine(config)
    matching_engine = MatchingEngine(config)
    
    # Create orders near Highway 7
    print("\n1. Creating orders near Highway 7...")
    base_time = datetime.now()
    orders = [
        Order("order1", 45.38, -75.70, 45.39, -75.68, base_time),
        Order("order2", 45.37, -75.71, 45.38, -75.69, base_time + timedelta(minutes=2)),
        Order("order3", 45.39, -75.69, 45.40, -75.67, base_time + timedelta(minutes=3)),
        Order("order4", 45.36, -75.72, 45.37, -75.70, base_time + timedelta(minutes=5)),
        Order("order5", 45.40, -75.68, 45.41, -75.66, base_time + timedelta(minutes=7)),
    ]
    print(f"   Created {len(orders)} orders")
    
    # Create batches with highway deviation filtering
    print("\n2. Creating batches with 5km highway deviation limit...")
    batches = batching_engine.create_batches(
        orders,
        current_time=base_time,
        max_highway_deviation_km=5.0
    )
    print(f"   Created {len(batches)} batch(es)")
    
    for i, batch in enumerate(batches):
        print(f"   Batch {i+1}: {len(batch.orders)} orders, center at ({batch.center_lat:.4f}, {batch.center_lng:.4f})")
    
    if not batches:
        print("   ⚠️  No batches created - orders may be outside time window or too far from highway")
        return
    
    # Create drivers with trajectory data
    print("\n3. Creating drivers with trajectory information...")
    drivers = [
        Driver(
            id="driver_moving_toward",
            lat=45.36,
            lng=-75.72,
            rating=4.8,
            vehicle_capacity=6,
            is_active=True,
            current_orders=1,
            max_concurrent_orders=8,
            previous_location=DriverStatus(
                lat=45.35,  # Moving north-east (toward pickup)
                lng=-75.73,
                timestamp=base_time - timedelta(minutes=5)
            )
        ),
        Driver(
            id="driver_moving_away",
            lat=45.36,
            lng=-75.72,
            rating=4.9,
            vehicle_capacity=8,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=10,
            previous_location=DriverStatus(
                lat=45.37,  # Moving south-west (away from pickup)
                lng=-75.71,
                timestamp=base_time - timedelta(minutes=5)
            )
        ),
        Driver(
            id="driver_stationary",
            lat=45.38,
            lng=-75.70,
            rating=5.0,
            vehicle_capacity=6,
            is_active=True,
            current_orders=2,
            max_concurrent_orders=8,
            previous_location=DriverStatus(
                lat=45.38,  # Same position (stationary)
                lng=-75.70,
                timestamp=base_time - timedelta(minutes=10)
            )
        ),
        Driver(
            id="driver_no_trajectory",
            lat=45.37,
            lng=-75.71,
            rating=4.7,
            vehicle_capacity=4,
            is_active=True,
            current_orders=0,
            max_concurrent_orders=6,
            previous_location=None  # No trajectory data
        ),
    ]
    print(f"   Created {len(drivers)} drivers")
    
    # Match drivers to first batch
    print("\n4. Matching drivers to batch using trajectory-based scoring...")
    batch = batches[0]
    batch_data = BatchData(
        id=batch.id,
        center_lat=batch.center_lat,
        center_lng=batch.center_lng,
        total_orders=len(batch.orders),
        estimated_duration_minutes=45,
        priority=5
    )
    
    # Find best drivers
    candidates = matching_engine.find_best_drivers(
        batch_data,
        drivers,
        max_distance=50.0
    )
    
    print(f"\n   Matched {len(candidates)} driver candidates:")
    print(f"   {'Rank':<6} {'Driver ID':<25} {'Score':<8} {'Distance':<10} {'Trajectory':<12} {'Artery':<10}")
    print(f"   {'-'*6} {'-'*25} {'-'*8} {'-'*10} {'-'*12} {'-'*10}")
    
    for rank, candidate in enumerate(candidates[:5], 1):
        trajectory = f"{candidate.trajectory_score:.3f}" if candidate.trajectory_score is not None else "N/A"
        artery = f"{candidate.artery_score:.3f}" if candidate.artery_score is not None else "N/A"
        print(f"   {rank:<6} {candidate.driver_id:<25} {candidate.score:<8.3f} {candidate.distance_km:<10.2f} {trajectory:<12} {artery:<10}")
    
    # Analyze results
    print("\n5. Analysis:")
    if candidates:
        best = candidates[0]
        print(f"   ✓ Best match: {best.driver_id}")
        print(f"     - Overall score: {best.score:.3f}")
        print(f"     - Distance: {best.distance_km:.2f} km")
        print(f"     - Trajectory score: {best.trajectory_score:.3f}" if best.trajectory_score else "     - Trajectory score: N/A")
        print(f"     - Artery proximity score: {best.artery_score:.3f}" if best.artery_score else "     - Artery proximity score: N/A")
        print(f"     - Capacity utilization: {best.capacity_utilization:.1%}")
        
        # Check if trajectory made a difference
        moving_toward = next((c for c in candidates if c.driver_id == "driver_moving_toward"), None)
        moving_away = next((c for c in candidates if c.driver_id == "driver_moving_away"), None)
        
        if moving_toward and moving_away:
            print(f"\n   Trajectory Impact:")
            print(f"     - Driver moving toward pickup: score={moving_toward.score:.3f}")
            print(f"     - Driver moving away from pickup: score={moving_away.score:.3f}")
            if moving_toward.score > moving_away.score:
                print(f"     ✓ Trajectory correctly prioritized driver moving toward pickup")
            else:
                print(f"     ⚠️  Other factors outweighed trajectory advantage")
    
    print("\n" + "=" * 70)
    print("INTEGRATION TEST COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    try:
        test_integration()
    except Exception as e:
        print(f"\n❌ Integration test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
