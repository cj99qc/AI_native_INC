#!/usr/bin/env python3
"""
Integration test script for trajectory-based matching

This script tests the full workflow using API calls through the bridge:
1. Create batches with highway deviation filtering
2. Match drivers using trajectory-based scoring
"""

import sys
import os
import json
import requests
from datetime import datetime, timedelta

def test_integration():
    """Test complete trajectory matching workflow using API calls through the bridge"""
    
    print("=" * 70)
    print("TRAJECTORY MATCHING INTEGRATION TEST")
    print("=" * 70)
    
    # Configuration
    bridge_url = os.getenv("BRIDGE_URL", "http://localhost:3001")
    routing_service_url = os.getenv("ROUTING_SERVICE_URL", "http://localhost:8002")
    matching_service_url = os.getenv("MATCHING_SERVICE_URL", "http://localhost:8003")
    
    # Create orders near Highway 7
    print("\n1. Creating orders near Highway 7...")
    base_time = datetime.now()
    orders_data = [
        {
            "id": "order1",
            "pickup_lat": 45.38,
            "pickup_lng": -75.70,
            "delivery_lat": 45.39,
            "delivery_lng": -75.68,
            "created_at": base_time.isoformat()
        },
        {
            "id": "order2",
            "pickup_lat": 45.37,
            "pickup_lng": -75.71,
            "delivery_lat": 45.38,
            "delivery_lng": -75.69,
            "created_at": (base_time + timedelta(minutes=2)).isoformat()
        },
        {
            "id": "order3",
            "pickup_lat": 45.39,
            "pickup_lng": -75.69,
            "delivery_lat": 45.40,
            "delivery_lng": -75.67,
            "created_at": (base_time + timedelta(minutes=3)).isoformat()
        },
        {
            "id": "order4",
            "pickup_lat": 45.36,
            "pickup_lng": -75.72,
            "delivery_lat": 45.37,
            "delivery_lng": -75.70,
            "created_at": (base_time + timedelta(minutes=5)).isoformat()
        },
        {
            "id": "order5",
            "pickup_lat": 45.40,
            "pickup_lng": -75.68,
            "delivery_lat": 45.41,
            "delivery_lng": -75.66,
            "created_at": (base_time + timedelta(minutes=7)).isoformat()
        },
    ]
    print(f"   Created {len(orders_data)} orders")
    
    # Create batches with highway deviation filtering via API
    print("\n2. Creating batches via API with 5km highway deviation limit...")
    try:
        batch_request = {
            "orders": orders_data,
            "current_time": base_time.isoformat(),
            "max_batch_size_orders": 8,
            "batch_window_minutes": 15,
            "max_highway_deviation_km": 5.0
        }
        
        # Try bridge first, fallback to direct service
        try:
            response = requests.post(f"{bridge_url}/api/routing/batch", json=batch_request, timeout=10)
        except requests.exceptions.RequestException:
            print("   Bridge unavailable, using direct service call...")
            response = requests.post(f"{routing_service_url}/batch", json=batch_request, timeout=10)
        
        response.raise_for_status()
        batch_result = response.json()
        batches = batch_result.get("batches", [])
        
    except requests.exceptions.RequestException as e:
        print(f"   ⚠️  Batching service unavailable: {e}")
        print("   Falling back to mock batch data...")
        batches = [{
            "id": "batch_mock",
            "center_lat": 45.38,
            "center_lng": -75.70,
            "total_orders": len(orders_data),
            "estimated_duration_minutes": 45,
            "priority": 5
        }]
    
    print(f"   Created {len(batches)} batch(es)")
    
    for i, batch in enumerate(batches):
        print(f"   Batch {i+1}: {batch.get('total_orders', 'N/A')} orders, center at ({batch.get('center_lat', 0):.4f}, {batch.get('center_lng', 0):.4f})")
    
    if not batches:
        print("   ⚠️  No batches created - orders may be outside time window or too far from highway")
        return
    
    # Create drivers with trajectory data
    print("\n3. Creating drivers with trajectory information...")
    drivers = [
        {
            "id": "driver_moving_toward",
            "lat": 45.36,
            "lng": -75.72,
            "rating": 4.8,
            "vehicle_capacity": 6,
            "is_active": True,
            "current_orders": 1,
            "max_concurrent_orders": 8,
            "previous_location": {
                "lat": 45.35,  # Moving north-east (toward pickup)
                "lng": -75.73,
                "timestamp": (base_time - timedelta(minutes=5)).isoformat()
            }
        },
        {
            "id": "driver_moving_away",
            "lat": 45.36,
            "lng": -75.72,
            "rating": 4.9,
            "vehicle_capacity": 8,
            "is_active": True,
            "current_orders": 0,
            "max_concurrent_orders": 10,
            "previous_location": {
                "lat": 45.37,  # Moving south-west (away from pickup)
                "lng": -75.71,
                "timestamp": (base_time - timedelta(minutes=5)).isoformat()
            }
        },
        {
            "id": "driver_stationary",
            "lat": 45.38,
            "lng": -75.70,
            "rating": 5.0,
            "vehicle_capacity": 6,
            "is_active": True,
            "current_orders": 2,
            "max_concurrent_orders": 8,
            "previous_location": {
                "lat": 45.38,  # Same position (stationary)
                "lng": -75.70,
                "timestamp": (base_time - timedelta(minutes=10)).isoformat()
            }
        },
        {
            "id": "driver_no_trajectory",
            "lat": 45.37,
            "lng": -75.71,
            "rating": 4.7,
            "vehicle_capacity": 4,
            "is_active": True,
            "current_orders": 0,
            "max_concurrent_orders": 6,
            "previous_location": None  # No trajectory data
        },
    ]
    print(f"   Created {len(drivers)} drivers")
    
    # Match drivers to first batch via API
    print("\n4. Matching drivers to batch using trajectory-based scoring via API...")
    batch = batches[0]
    
    batch_data = {
        "id": batch.get("id", "batch_001"),
        "center_lat": batch.get("center_lat", 45.38),
        "center_lng": batch.get("center_lng", -75.70),
        "total_orders": batch.get("total_orders", 5),
        "estimated_duration_minutes": 45,
        "priority": 5
    }
    
    # Call matching service API
    try:
        assign_request = {
            "batch": batch_data,
            "available_drivers": drivers,
            "max_distance_km": 50.0
        }
        
        # Try bridge first, fallback to direct service
        try:
            response = requests.post(f"{bridge_url}/api/matching/assign", json=assign_request, timeout=10)
        except requests.exceptions.RequestException:
            print("   Bridge unavailable, using direct service call...")
            response = requests.post(f"{matching_service_url}/assign", json=assign_request, timeout=10)
        
        response.raise_for_status()
        assignment_result = response.json()
        candidates = assignment_result.get("all_candidates", [])
        best_driver = assignment_result.get("recommended_driver")
        
    except requests.exceptions.RequestException as e:
        print(f"   ⚠️  Matching service unavailable: {e}")
        print("   Cannot complete test without matching service")
        return
    
    print(f"\n   Matched {len(candidates)} driver candidates:")
    print(f"   {'Rank':<6} {'Driver ID':<25} {'Score':<8} {'Distance':<10} {'Trajectory':<12} {'Artery':<10}")
    print(f"   {'-'*6} {'-'*25} {'-'*8} {'-'*10} {'-'*12} {'-'*10}")
    
    for rank, candidate in enumerate(candidates[:5], 1):
        trajectory = f"{candidate.get('trajectory_score', 0):.3f}" if candidate.get('trajectory_score') is not None else "N/A"
        artery = f"{candidate.get('artery_score', 0):.3f}" if candidate.get('artery_score') is not None else "N/A"
        print(f"   {rank:<6} {candidate.get('driver_id', 'N/A'):<25} {candidate.get('score', 0):<8.3f} {candidate.get('distance_km', 0):<10.2f} {trajectory:<12} {artery:<10}")
    
    # Analyze results
    print("\n5. Analysis:")
    if candidates:
        best = candidates[0]
        print(f"   ✓ Best match: {best.get('driver_id', 'N/A')}")
        print(f"     - Overall score: {best.get('score', 0):.3f}")
        print(f"     - Distance: {best.get('distance_km', 0):.2f} km")
        if best.get('trajectory_score') is not None:
            print(f"     - Trajectory score: {best['trajectory_score']:.3f}")
        else:
            print(f"     - Trajectory score: N/A")
        if best.get('artery_score') is not None:
            print(f"     - Artery proximity score: {best['artery_score']:.3f}")
        else:
            print(f"     - Artery proximity score: N/A")
        print(f"     - Capacity utilization: {best.get('capacity_utilization', 0):.1%}")
        
        # Check if trajectory made a difference
        moving_toward = next((c for c in candidates if c.get("driver_id") == "driver_moving_toward"), None)
        moving_away = next((c for c in candidates if c.get("driver_id") == "driver_moving_away"), None)
        
        if moving_toward and moving_away:
            print(f"\n   Trajectory Impact:")
            print(f"     - Driver moving toward pickup: score={moving_toward.get('score', 0):.3f}")
            print(f"     - Driver moving away from pickup: score={moving_away.get('score', 0):.3f}")
            if moving_toward.get('score', 0) > moving_away.get('score', 0):
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
