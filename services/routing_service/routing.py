# CREATE FILE: services/routing_service/routing.py

import math
import random
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
from .batching import Order, Batch

try:
    import ortools
    from ortools.constraint_solver import routing_enums_pb2
    from ortools.constraint_solver import pywrapcp
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False

@dataclass
class RouteStop:
    order_id: str
    stop_type: str  # 'pickup' or 'delivery'
    lat: float
    lng: float
    sequence: int
    estimated_arrival_minutes: int = 0

@dataclass
class Route:
    batch_id: str
    stops: List[RouteStop]
    total_distance_km: float
    estimated_duration_minutes: int
    optimization_algorithm: str
    optimization_score: float

class RoutingEngine:
    """Routing engine with heuristic and optional OR-Tools optimization"""
    
    def __init__(self, config: Dict[str, Any]):
        self.max_detour_pct = config.get("max_detour_pct", 30.0)
        self.tsp_iterations = config.get("tsp_2opt_iterations", 100)
        self.seed = config.get("seed", 42)
        random.seed(self.seed)
    
    def haversine_distance(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Calculate haversine distance between two points in kilometers"""
        R = 6371  # Earth's radius in kilometers
        
        lat1_rad = math.radians(lat1)
        lng1_rad = math.radians(lng1)
        lat2_rad = math.radians(lat2)
        lng2_rad = math.radians(lng2)
        
        dlat = lat2_rad - lat1_rad
        dlng = lng2_rad - lng1_rad
        
        a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    
    def create_distance_matrix(self, points: List[Tuple[float, float]]) -> List[List[float]]:
        """Create distance matrix from list of coordinate points"""
        n = len(points)
        matrix = [[0.0] * n for _ in range(n)]
        
        for i in range(n):
            for j in range(n):
                if i != j:
                    matrix[i][j] = self.haversine_distance(
                        points[i][0], points[i][1],
                        points[j][0], points[j][1]
                    )
        
        return matrix
    
    def nearest_neighbor_tsp(self, distance_matrix: List[List[float]], 
                           start_index: int = 0) -> Tuple[List[int], float]:
        """Solve TSP using nearest neighbor heuristic"""
        n = len(distance_matrix)
        if n <= 1:
            return list(range(n)), 0.0
        
        unvisited = set(range(n))
        tour = [start_index]
        unvisited.remove(start_index)
        total_distance = 0.0
        
        current = start_index
        while unvisited:
            nearest = min(unvisited, key=lambda x: distance_matrix[current][x])
            total_distance += distance_matrix[current][nearest]
            tour.append(nearest)
            unvisited.remove(nearest)
            current = nearest
        
        # Return to start
        total_distance += distance_matrix[current][start_index]
        tour.append(start_index)
        
        return tour, total_distance
    
    def two_opt_improvement(self, tour: List[int], distance_matrix: List[List[float]]) -> Tuple[List[int], float]:
        """Improve tour using 2-opt local search"""
        best_tour = tour[:]
        best_distance = self.calculate_tour_distance(tour, distance_matrix)
        
        improved = True
        iterations = 0
        
        while improved and iterations < self.tsp_iterations:
            improved = False
            iterations += 1
            
            for i in range(1, len(tour) - 2):
                for j in range(i + 1, len(tour) - 1):
                    # Try 2-opt swap
                    new_tour = tour[:i] + tour[i:j+1][::-1] + tour[j+1:]
                    new_distance = self.calculate_tour_distance(new_tour, distance_matrix)
                    
                    if new_distance < best_distance:
                        best_tour = new_tour[:]
                        best_distance = new_distance
                        tour = new_tour[:]
                        improved = True
        
        return best_tour, best_distance
    
    def calculate_tour_distance(self, tour: List[int], distance_matrix: List[List[float]]) -> float:
        """Calculate total distance of a tour"""
        distance = 0.0
        for i in range(len(tour) - 1):
            distance += distance_matrix[tour[i]][tour[i + 1]]
        return distance
    
    def heuristic_route(self, batch: Batch, driver_location: Optional[Tuple[float, float]] = None) -> Route:
        """Create route using heuristic algorithms"""
        if not batch.orders:
            return Route(
                batch_id=batch.id,
                stops=[],
                total_distance_km=0.0,
                estimated_duration_minutes=0,
                optimization_algorithm="heuristic",
                optimization_score=100.0
            )
        
        # Create list of all stops (pickup + delivery for each order)
        all_stops = []
        points = []
        
        # Add driver start location if provided
        start_idx = 0
        if driver_location:
            points.append(driver_location)
            start_idx = 1
        else:
            # Use center of batch as start point
            points.append((batch.center_lat, batch.center_lng))
            start_idx = 1
        
        # Add pickup points first, then delivery points
        for order in batch.orders:
            # Pickup stop
            pickup_idx = len(points)
            points.append((order.pickup_lat, order.pickup_lng))
            all_stops.append({
                'order_id': order.id,
                'type': 'pickup',
                'index': pickup_idx,
                'lat': order.pickup_lat,
                'lng': order.pickup_lng
            })
        
        for order in batch.orders:
            # Delivery stop
            delivery_idx = len(points)
            points.append((order.delivery_lat, order.delivery_lng))
            all_stops.append({
                'order_id': order.id,
                'type': 'delivery', 
                'index': delivery_idx,
                'lat': order.delivery_lat,
                'lng': order.delivery_lng
            })
        
        # Create distance matrix
        distance_matrix = self.create_distance_matrix(points)
        
        # Solve using nearest neighbor + 2-opt
        tour, total_distance = self.nearest_neighbor_tsp(distance_matrix, 0)  # Start from driver location
        improved_tour, improved_distance = self.two_opt_improvement(tour, distance_matrix)
        
        # Convert tour back to route stops (skip start/end depot)
        route_stops = []
        sequence = 0
        
        # Process tour excluding depot returns
        for i in range(1, len(improved_tour) - 1):  # Skip depot start and end
            point_idx = improved_tour[i]
            
            # Find corresponding stop
            stop = next((s for s in all_stops if s['index'] == point_idx), None)
            if stop:
                route_stops.append(RouteStop(
                    order_id=stop['order_id'],
                    stop_type=stop['type'],
                    lat=stop['lat'],
                    lng=stop['lng'],
                    sequence=sequence
                ))
                sequence += 1
        
        # Ensure pickup before delivery constraint
        route_stops = self.enforce_pickup_before_delivery(route_stops)
        
        # Estimate timing
        estimated_duration = self.estimate_route_duration(route_stops, improved_distance)
        
        # Calculate optimization score (rough heuristic)
        optimization_score = max(50.0, min(100.0, 100.0 - (improved_distance * 2)))
        
        return Route(
            batch_id=batch.id,
            stops=route_stops,
            total_distance_km=improved_distance,
            estimated_duration_minutes=estimated_duration,
            optimization_algorithm="heuristic_2opt",
            optimization_score=optimization_score
        )
    
    def vrp_route(self, batch: Batch, driver_location: Optional[Tuple[float, float]] = None) -> Route:
        """Create route using OR-Tools VRP solver (if available)"""
        if not ORTOOLS_AVAILABLE:
            return self.heuristic_route(batch, driver_location)
        
        try:
            # This would implement OR-Tools VRP
            # For now, fallback to heuristic as OR-Tools setup is complex
            return self.heuristic_route(batch, driver_location)
        except Exception:
            return self.heuristic_route(batch, driver_location)
    
    def enforce_pickup_before_delivery(self, stops: List[RouteStop]) -> List[RouteStop]:
        """Ensure all pickups happen before their corresponding deliveries"""
        # Group by order_id
        order_stops = {}
        for stop in stops:
            if stop.order_id not in order_stops:
                order_stops[stop.order_id] = []
            order_stops[stop.order_id].append(stop)
        
        # Reorder stops to ensure pickup before delivery
        reordered_stops = []
        
        # First pass: add all pickups in original sequence order
        pickup_stops = [s for s in stops if s.stop_type == 'pickup']
        pickup_stops.sort(key=lambda x: x.sequence)
        reordered_stops.extend(pickup_stops)
        
        # Second pass: add deliveries in original sequence order
        delivery_stops = [s for s in stops if s.stop_type == 'delivery']
        delivery_stops.sort(key=lambda x: x.sequence)
        reordered_stops.extend(delivery_stops)
        
        # Update sequence numbers
        for i, stop in enumerate(reordered_stops):
            stop.sequence = i
        
        return reordered_stops
    
    def estimate_route_duration(self, stops: List[RouteStop], total_distance_km: float) -> int:
        """Estimate total route duration including stops"""
        if not stops:
            return 0
        
        # Time estimates
        avg_speed_kmh = 25  # Urban delivery speed
        stop_duration_minutes = 8  # Time per stop
        
        travel_time = int((total_distance_km / avg_speed_kmh) * 60)  # Convert to minutes
        stop_time = len(stops) * stop_duration_minutes
        
        return travel_time + stop_time
    
    def optimize_route(self, batch: Batch, driver_location: Optional[Tuple[float, float]] = None,
                      algorithm: str = "heuristic") -> Route:
        """Main method to optimize route for a batch"""
        if algorithm == "vrp" and ORTOOLS_AVAILABLE:
            return self.vrp_route(batch, driver_location)
        else:
            return self.heuristic_route(batch, driver_location)