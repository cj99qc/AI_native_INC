# CREATE FILE: services/simulator/run.py

#!/usr/bin/env python3
"""
INC Logistics Simulator

Generates synthetic orders and drivers, runs the full logistics pipeline 
(batching → routing → matching → pricing → escrow), and outputs KPI metrics.

Usage:
    python -m services.simulator.run --config config/defaults.json
    python -m services.simulator.run --orders 100 --drivers 20
"""

import argparse
import json
import random
import math
import csv
import os
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Tuple
from pathlib import Path

# Import components from other services
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '../..'))

try:
    from services.pricing_service.pricing import PricingEngine
    from services.routing_service.batching import BatchingEngine, Order, Batch
    from services.routing_service.routing import RoutingEngine
except ImportError as e:
    print(f"Warning: Could not import service components: {e}")
    print("Make sure you're running from the repository root")

@dataclass
class SimOrder:
    id: str
    customer_id: str
    vendor_id: str
    pickup_lat: float
    pickup_lng: float
    delivery_lat: float
    delivery_lng: float
    order_value: float
    created_at: datetime
    priority: int = 1

@dataclass
class SimDriver:
    id: str
    lat: float
    lng: float
    rating: float
    capacity: int
    is_active: bool = True
    current_orders: int = 0

@dataclass
class SimResult:
    batch_id: str
    driver_id: str
    order_ids: List[str]
    total_distance_km: float
    estimated_duration_minutes: int
    pricing_breakdown: Dict[str, float]
    completed: bool = False

class LogisticsSimulator:
    """Main simulator class"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.seed = config.get("seed", 42)
        random.seed(self.seed)
        
        # Initialize service engines
        self.pricing_engine = PricingEngine()
        self.batching_engine = BatchingEngine(config)
        self.routing_engine = RoutingEngine(config)
        
        # Ottawa center coordinates
        self.center_lat = config.get("ottawa_center", {}).get("latitude", 45.4215)
        self.center_lng = config.get("ottawa_center", {}).get("longitude", -75.6972)
        
        # Simulation parameters
        self.sim_config = config.get("simulation", {})
        self.order_spawn_radius = self.sim_config.get("order_spawn_radius_km", 15.0)
        self.driver_spawn_radius = self.sim_config.get("driver_spawn_radius_km", 20.0)
        self.avg_order_value = self.sim_config.get("avg_order_value", 40.0)
    
    def generate_random_location(self, center_lat: float, center_lng: float, radius_km: float) -> Tuple[float, float]:
        """Generate random location within radius of center"""
        # Convert km to degrees (approximate)
        lat_range = radius_km / 111.0  # 1 degree lat ≈ 111 km
        lng_range = radius_km / (111.0 * math.cos(math.radians(center_lat)))
        
        # Random point in circle
        angle = random.uniform(0, 2 * math.pi)
        distance = random.uniform(0, 1) ** 0.5  # Square root for uniform distribution
        
        lat_offset = distance * lat_range * math.cos(angle)
        lng_offset = distance * lng_range * math.sin(angle)
        
        return center_lat + lat_offset, center_lng + lng_offset
    
    def generate_orders(self, num_orders: int) -> List[SimOrder]:
        """Generate synthetic orders"""
        orders = []
        base_time = datetime.now()
        
        vendors = [f"vendor_{i}" for i in range(1, 21)]  # 20 vendors
        
        for i in range(num_orders):
            order_id = f"sim_order_{i+1:04d}"
            customer_id = f"customer_{random.randint(1, 500)}"
            vendor_id = random.choice(vendors)
            
            # Generate pickup location (vendor location)
            pickup_lat, pickup_lng = self.generate_random_location(
                self.center_lat, self.center_lng, self.order_spawn_radius
            )
            
            # Generate delivery location (within reasonable distance)
            delivery_radius = random.uniform(2, 12)  # 2-12km from pickup
            delivery_lat, delivery_lng = self.generate_random_location(
                pickup_lat, pickup_lng, delivery_radius
            )
            
            # Generate order value (log-normal distribution)
            order_value = max(10.0, random.lognormvariate(
                math.log(self.avg_order_value), 0.5
            ))
            
            # Generate creation time (spread over time window)
            time_window_hours = self.sim_config.get("time_window_hours", 2.0)
            minutes_offset = random.uniform(0, time_window_hours * 60)
            created_at = base_time + timedelta(minutes=minutes_offset)
            
            # Priority (mostly normal, some high priority)
            priority = 1 if random.random() > 0.2 else random.randint(2, 5)
            
            orders.append(SimOrder(
                id=order_id,
                customer_id=customer_id,
                vendor_id=vendor_id,
                pickup_lat=pickup_lat,
                pickup_lng=pickup_lng,
                delivery_lat=delivery_lat,
                delivery_lng=delivery_lng,
                order_value=order_value,
                created_at=created_at,
                priority=priority
            ))
        
        return orders
    
    def generate_drivers(self, num_drivers: int) -> List[SimDriver]:
        """Generate synthetic drivers"""
        drivers = []
        
        for i in range(num_drivers):
            driver_id = f"sim_driver_{i+1:03d}"
            
            # Random location
            lat, lng = self.generate_random_location(
                self.center_lat, self.center_lng, self.driver_spawn_radius
            )
            
            # Random rating (skewed toward good ratings)
            rating = max(3.0, min(5.0, random.normalvariate(4.3, 0.4)))
            
            # Vehicle capacity
            capacity = random.choice([4, 6, 8, 10])  # Different vehicle sizes
            
            # Active status (90% active)
            is_active = random.random() > 0.1
            
            drivers.append(SimDriver(
                id=driver_id,
                lat=lat,
                lng=lng,
                rating=rating,
                capacity=capacity,
                is_active=is_active
            ))
        
        return drivers
    
    def calculate_distance(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calculate haversine distance"""
        R = 6371  # Earth's radius in km
        
        lat1_rad = math.radians(lat1)
        lng1_rad = math.radians(lng1)
        lat2_rad = math.radians(lat2)
        lng2_rad = math.radians(lng2)
        
        dlat = lat2_rad - lat1_rad
        dlng = lng2_rad - lng1_rad
        
        a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    
    def simple_driver_matching(self, batch: Batch, drivers: List[SimDriver]) -> SimDriver:
        """Simple driver matching based on proximity and availability"""
        available_drivers = [d for d in drivers if d.is_active and d.current_orders == 0]
        
        if not available_drivers:
            return None
        
        # Find closest driver
        best_driver = None
        best_distance = float('inf')
        
        for driver in available_drivers:
            distance = self.calculate_distance(
                driver.lat, driver.lng,
                batch.center_lat, batch.center_lng
            )
            if distance < best_distance:
                best_distance = distance
                best_driver = driver
        
        return best_driver
    
    def run_simulation(self, num_orders: int, num_drivers: int) -> Dict[str, Any]:
        """Run the complete simulation"""
        print(f"Starting simulation with {num_orders} orders and {num_drivers} drivers...")
        
        start_time = datetime.now()
        
        # Generate synthetic data
        print("Generating orders and drivers...")
        orders = self.generate_orders(num_orders)
        drivers = self.generate_drivers(num_drivers)
        
        print(f"Generated {len(orders)} orders and {len(drivers)} drivers")
        
        # Convert to batching engine format
        batching_orders = []
        for order in orders:
            batching_order = Order(
                id=order.id,
                pickup_lat=order.pickup_lat,
                pickup_lng=order.pickup_lng,
                delivery_lat=order.delivery_lat,
                delivery_lng=order.delivery_lng,
                created_at=order.created_at,
                priority=order.priority
            )
            batching_orders.append(batching_order)
        
        # Create batches
        print("Creating batches...")
        batches = self.batching_engine.create_batches(batching_orders)
        print(f"Created {len(batches)} batches")
        
        # Process each batch
        sim_results = []
        total_revenue = 0
        total_driver_payouts = 0
        total_platform_revenue = 0
        driver_assignments = {}
        
        for batch in batches:
            # Find matching driver
            assigned_driver = self.simple_driver_matching(batch, drivers)
            
            if not assigned_driver:
                print(f"No available driver for batch {batch.id}")
                continue
            
            # Mark driver as busy
            assigned_driver.current_orders += len(batch.orders)
            driver_assignments[assigned_driver.id] = driver_assignments.get(assigned_driver.id, 0) + 1
            
            # Optimize route
            driver_location = (assigned_driver.lat, assigned_driver.lng)
            route = self.routing_engine.optimize_route(batch, driver_location)
            
            # Calculate pricing for each order
            batch_pricing = {
                "total_customer_payment": 0,
                "total_driver_payout": 0,
                "total_vendor_payout": 0,
                "total_platform_revenue": 0
            }
            
            for order in batch.orders:
                # Find corresponding sim order for pricing
                sim_order = next(o for o in orders if o.id == order.id)
                
                # Calculate distance from pickup to delivery
                distance = self.calculate_distance(
                    order.pickup_lat, order.pickup_lng,
                    order.delivery_lat, order.delivery_lng
                )
                
                # Get pricing
                pricing = self.pricing_engine.calculate_complete_pricing(
                    sim_order.order_value, distance
                )
                
                batch_pricing["total_customer_payment"] += pricing["totals"]["customer_pays"]
                batch_pricing["total_driver_payout"] += pricing["totals"]["driver_receives"]
                batch_pricing["total_vendor_payout"] += pricing["totals"]["vendor_receives"]
                batch_pricing["total_platform_revenue"] += pricing["totals"]["net_platform_revenue"]
            
            total_revenue += batch_pricing["total_customer_payment"]
            total_driver_payouts += batch_pricing["total_driver_payout"]
            total_platform_revenue += batch_pricing["total_platform_revenue"]
            
            # Create result
            result = SimResult(
                batch_id=batch.id,
                driver_id=assigned_driver.id,
                order_ids=[order.id for order in batch.orders],
                total_distance_km=route.total_distance_km,
                estimated_duration_minutes=route.estimated_duration_minutes,
                pricing_breakdown=batch_pricing,
                completed=True  # Assume all complete in simulation
            )
            sim_results.append(result)
        
        # Calculate KPIs
        end_time = datetime.now()
        simulation_duration = (end_time - start_time).total_seconds()
        
        completed_orders = sum(len(r.order_ids) for r in sim_results)
        active_drivers = sum(1 for d in drivers if d.is_active)
        utilized_drivers = len(driver_assignments)
        
        avg_orders_per_batch = completed_orders / len(sim_results) if sim_results else 0
        avg_delivery_time = sum(r.estimated_duration_minutes for r in sim_results) / len(sim_results) if sim_results else 0
        driver_utilization = (utilized_drivers / active_drivers * 100) if active_drivers > 0 else 0
        completion_rate = (completed_orders / num_orders * 100) if num_orders > 0 else 0
        
        gross_margin_per_order = total_platform_revenue / completed_orders if completed_orders > 0 else 0
        
        kpi_summary = {
            "simulation_duration_seconds": round(simulation_duration, 2),
            "total_orders_generated": num_orders,
            "total_drivers_generated": num_drivers,
            "total_batches_created": len(batches),
            "completed_orders": completed_orders,
            "completion_rate_pct": round(completion_rate, 2),
            "avg_orders_per_batch": round(avg_orders_per_batch, 2),
            "avg_delivery_time_minutes": round(avg_delivery_time, 1),
            "driver_utilization_pct": round(driver_utilization, 2),
            "total_revenue": round(total_revenue, 2),
            "total_driver_payouts": round(total_driver_payouts, 2),
            "total_platform_revenue": round(total_platform_revenue, 2),
            "gross_margin_per_order": round(gross_margin_per_order, 2),
            "platform_margin_pct": round((total_platform_revenue / total_revenue * 100) if total_revenue > 0 else 0, 2)
        }
        
        return {
            "kpi_summary": kpi_summary,
            "orders": orders,
            "drivers": drivers,
            "results": sim_results
        }
    
    def write_kpi_csv(self, simulation_data: Dict[str, Any], output_path: str):
        """Write KPI summary to CSV file"""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        kpis = simulation_data["kpi_summary"]
        
        with open(output_path, 'w', newline='') as csvfile:
            writer = csv.writer(csvfile)
            
            # Write headers
            writer.writerow(['Metric', 'Value', 'Unit'])
            
            # Write KPIs
            writer.writerow(['Total Orders', kpis['total_orders_generated'], 'count'])
            writer.writerow(['Total Drivers', kpis['total_drivers_generated'], 'count'])
            writer.writerow(['Total Batches', kpis['total_batches_created'], 'count'])
            writer.writerow(['Completed Orders', kpis['completed_orders'], 'count'])
            writer.writerow(['Completion Rate', kpis['completion_rate_pct'], '%'])
            writer.writerow(['Avg Orders per Batch', kpis['avg_orders_per_batch'], 'orders'])
            writer.writerow(['Avg Delivery Time', kpis['avg_delivery_time_minutes'], 'minutes'])
            writer.writerow(['Driver Utilization', kpis['driver_utilization_pct'], '%'])
            writer.writerow(['Total Revenue', kpis['total_revenue'], '$'])
            writer.writerow(['Total Driver Payouts', kpis['total_driver_payouts'], '$'])
            writer.writerow(['Total Platform Revenue', kpis['total_platform_revenue'], '$'])
            writer.writerow(['Gross Margin per Order', kpis['gross_margin_per_order'], '$'])
            writer.writerow(['Platform Margin', kpis['platform_margin_pct'], '%'])
            writer.writerow(['Simulation Duration', kpis['simulation_duration_seconds'], 'seconds'])

def main():
    parser = argparse.ArgumentParser(description='INC Logistics Simulator')
    parser.add_argument('--config', type=str, help='Path to config JSON file')
    parser.add_argument('--orders', type=int, help='Number of orders to generate')
    parser.add_argument('--drivers', type=int, help='Number of drivers to generate')
    parser.add_argument('--output', type=str, default='out/kpi_summary.csv', 
                       help='Output path for KPI CSV')
    
    args = parser.parse_args()
    
    # Load configuration
    if args.config and os.path.exists(args.config):
        with open(args.config, 'r') as f:
            config = json.load(f)
    else:
        # Default config
        config = {
            "seed": 42,
            "ottawa_center": {"latitude": 45.4215, "longitude": -75.6972},
            "simulation": {
                "default_orders": 200,
                "default_drivers": 40,
                "order_spawn_radius_km": 15.0,
                "driver_spawn_radius_km": 20.0,
                "avg_order_value": 40.0,
                "time_window_hours": 2.0
            },
            "max_batch_size_orders": 8,
            "batch_window_minutes": 15,
            "max_detour_pct": 30.0,
            "tsp_2opt_iterations": 100
        }
    
    # Use command line args or config defaults
    num_orders = args.orders or config["simulation"]["default_orders"]
    num_drivers = args.drivers or config["simulation"]["default_drivers"]
    
    # Run simulation
    simulator = LogisticsSimulator(config)
    results = simulator.run_simulation(num_orders, num_drivers)
    
    # Write CSV output
    simulator.write_kpi_csv(results, args.output)
    
    # Print summary
    kpis = results["kpi_summary"]
    print("\n" + "="*60)
    print("SIMULATION RESULTS")
    print("="*60)
    print(f"Orders Generated: {kpis['total_orders_generated']}")
    print(f"Drivers Available: {kpis['total_drivers_generated']}")
    print(f"Batches Created: {kpis['total_batches_created']}")
    print(f"Completion Rate: {kpis['completion_rate_pct']:.1f}%")
    print(f"Driver Utilization: {kpis['driver_utilization_pct']:.1f}%")
    print(f"Avg Delivery Time: {kpis['avg_delivery_time_minutes']:.1f} minutes")
    print(f"Gross Margin per Order: ${kpis['gross_margin_per_order']:.2f}")
    print(f"Platform Margin: {kpis['platform_margin_pct']:.1f}%")
    print(f"Total Platform Revenue: ${kpis['total_platform_revenue']:.2f}")
    print(f"\nKPI CSV written to: {args.output}")
    print("="*60)

if __name__ == "__main__":
    main()