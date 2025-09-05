# CREATE FILE: services/routing_service/solver.py

import os
import sys
import math
import json
import time
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta

# Add utils to path for logging
sys.path.append(os.path.join(os.path.dirname(__file__), '../../'))
from utils.logging import get_logger

# Conditional OR-Tools import
try:
    from ortools.constraint_solver import routing_enums_pb2
    from ortools.constraint_solver import pywrapcp
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False

# Conditional travel time providers
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


@dataclass
class Location:
    """Represents a geographic location"""
    lat: float
    lng: float
    id: str = ""
    
    def distance_to(self, other: 'Location') -> float:
        """Calculate haversine distance in kilometers"""
        R = 6371  # Earth's radius in km
        
        lat1_rad = math.radians(self.lat)
        lat2_rad = math.radians(other.lat)
        delta_lat = math.radians(other.lat - self.lat)
        delta_lng = math.radians(other.lng - self.lng)
        
        a = (math.sin(delta_lat / 2) ** 2 + 
             math.cos(lat1_rad) * math.cos(lat2_rad) * 
             math.sin(delta_lng / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c


@dataclass
class Stop:
    """Represents a stop in a route"""
    id: str
    location: Location
    stop_type: str  # 'pickup', 'delivery', 'depot'
    order_id: Optional[str] = None
    service_time: int = 300  # seconds
    time_window: Optional[Tuple[int, int]] = None  # (earliest, latest) in seconds from start
    priority: int = 1


@dataclass
class Vehicle:
    """Represents a delivery vehicle"""
    id: str
    start_location: Location
    end_location: Optional[Location] = None
    capacity: int = 10
    max_duration: int = 28800  # 8 hours in seconds
    vehicle_type: str = 'car'


@dataclass
class RouteResult:
    """Result of route optimization"""
    vehicle_id: str
    stops: List[Dict[str, Any]]
    total_distance_km: float
    total_duration_minutes: int
    load_sequence: List[int]
    arrival_times: List[int]
    optimization_score: float


class TravelTimeProvider:
    """Abstract base class for travel time providers"""
    
    def get_travel_time(self, from_loc: Location, to_loc: Location) -> Tuple[int, float]:
        """
        Get travel time and distance between two locations.
        
        Returns:
            Tuple of (travel_time_seconds, distance_km)
        """
        raise NotImplementedError
    
    def get_travel_matrix(self, locations: List[Location]) -> Tuple[List[List[int]], List[List[float]]]:
        """
        Get travel time and distance matrices for all location pairs.
        
        Returns:
            Tuple of (time_matrix, distance_matrix)
        """
        raise NotImplementedError


class MockTravelTimeProvider(TravelTimeProvider):
    """Mock travel time provider for local development"""
    
    def __init__(self, avg_speed_kmh: float = 40.0):
        self.avg_speed_kmh = avg_speed_kmh
        self.logger = get_logger("mock_travel_time")
    
    def get_travel_time(self, from_loc: Location, to_loc: Location) -> Tuple[int, float]:
        """Calculate travel time based on distance and average speed"""
        distance_km = from_loc.distance_to(to_loc)
        travel_time_hours = distance_km / self.avg_speed_kmh
        travel_time_seconds = int(travel_time_hours * 3600)
        
        # Add some urban delay simulation
        if distance_km < 2:  # Short distances have proportionally more delay
            travel_time_seconds = int(travel_time_seconds * 1.5)
        
        return travel_time_seconds, distance_km
    
    def get_travel_matrix(self, locations: List[Location]) -> Tuple[List[List[int]], List[List[float]]]:
        """Generate travel time and distance matrices"""
        n = len(locations)
        time_matrix = [[0] * n for _ in range(n)]
        distance_matrix = [[0.0] * n for _ in range(n)]
        
        for i in range(n):
            for j in range(n):
                if i != j:
                    travel_time, distance = self.get_travel_time(locations[i], locations[j])
                    time_matrix[i][j] = travel_time
                    distance_matrix[i][j] = distance
        
        return time_matrix, distance_matrix


class GraphHopperProvider(TravelTimeProvider):
    """GraphHopper travel time provider"""
    
    def __init__(self, api_key: str = None, base_url: str = "https://graphhopper.com/api/1"):
        self.api_key = api_key
        self.base_url = base_url
        self.logger = get_logger("graphhopper_provider")
        
        if not REQUESTS_AVAILABLE:
            raise ImportError("requests library required for GraphHopper provider")
    
    def get_travel_matrix(self, locations: List[Location]) -> Tuple[List[List[int]], List[List[float]]]:
        """Use GraphHopper Matrix API"""
        if not self.api_key:
            self.logger.warning("No GraphHopper API key, falling back to mock")
            mock_provider = MockTravelTimeProvider()
            return mock_provider.get_travel_matrix(locations)
        
        try:
            # Prepare request
            points = [[loc.lng, loc.lat] for loc in locations]  # GraphHopper uses lng,lat
            
            payload = {
                "points": points,
                "out_arrays": ["times", "distances"],
                "vehicle": "car"
            }
            
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            # Make API request
            response = requests.post(
                f"{self.base_url}/matrix",
                json=payload,
                headers=headers,
                timeout=30
            )
            
            if response.status_code != 200:
                raise Exception(f"GraphHopper API error: {response.status_code}")
            
            data = response.json()
            
            # Convert to our format (seconds and km)
            time_matrix = data["times"]  # Already in seconds
            distance_matrix = [[d / 1000.0 for d in row] for row in data["distances"]]  # Convert m to km
            
            self.logger.info("GraphHopper matrix retrieved", 
                           locations_count=len(locations),
                           api_response_time=response.elapsed.total_seconds())
            
            return time_matrix, distance_matrix
            
        except Exception as e:
            self.logger.error("GraphHopper API failed, falling back to mock", error=e)
            mock_provider = MockTravelTimeProvider()
            return mock_provider.get_travel_matrix(locations)
    
    def get_travel_time(self, from_loc: Location, to_loc: Location) -> Tuple[int, float]:
        """Get single travel time (uses matrix for consistency)"""
        time_matrix, distance_matrix = self.get_travel_matrix([from_loc, to_loc])
        return time_matrix[0][1], distance_matrix[0][1]


class OSRMProvider(TravelTimeProvider):
    """OSRM travel time provider"""
    
    def __init__(self, base_url: str = "http://router.project-osrm.org"):
        self.base_url = base_url
        self.logger = get_logger("osrm_provider")
        
        if not REQUESTS_AVAILABLE:
            raise ImportError("requests library required for OSRM provider")
    
    def get_travel_matrix(self, locations: List[Location]) -> Tuple[List[List[int]], List[List[float]]]:
        """Use OSRM Table API"""
        try:
            # Prepare coordinates
            coordinates = ";".join([f"{loc.lng},{loc.lat}" for loc in locations])
            
            # Make API request
            url = f"{self.base_url}/table/v1/driving/{coordinates}"
            response = requests.get(url, timeout=30)
            
            if response.status_code != 200:
                raise Exception(f"OSRM API error: {response.status_code}")
            
            data = response.json()
            
            if data["code"] != "Ok":
                raise Exception(f"OSRM error: {data.get('message', 'Unknown error')}")
            
            # Convert to our format
            time_matrix = [[int(duration) for duration in row] for row in data["durations"]]
            distance_matrix = [[d / 1000.0 for d in row] for row in data["distances"]]  # Convert m to km
            
            self.logger.info("OSRM matrix retrieved", 
                           locations_count=len(locations),
                           api_response_time=response.elapsed.total_seconds())
            
            return time_matrix, distance_matrix
            
        except Exception as e:
            self.logger.error("OSRM API failed, falling back to mock", error=e)
            mock_provider = MockTravelTimeProvider()
            return mock_provider.get_travel_matrix(locations)
    
    def get_travel_time(self, from_loc: Location, to_loc: Location) -> Tuple[int, float]:
        """Get single travel time"""
        time_matrix, distance_matrix = self.get_travel_matrix([from_loc, to_loc])
        return time_matrix[0][1], distance_matrix[0][1]


class ORToolsSolver:
    """OR-Tools based VRP solver with multiple constraints"""
    
    def __init__(self, travel_provider: TravelTimeProvider = None, config: Dict[str, Any] = None):
        self.travel_provider = travel_provider or MockTravelTimeProvider()
        self.config = config or {}
        self.logger = get_logger("ortools_solver")
        
        # OR-Tools configuration
        self.search_time_limit = self.config.get("search_time_limit_seconds", 30)
        self.solution_limit = self.config.get("solution_limit", 100)
        self.use_guided_local_search = self.config.get("use_guided_local_search", True)
        
        if not ORTOOLS_AVAILABLE:
            self.logger.warning("OR-Tools not available, using fallback solver")
    
    def solve_vrp(self, vehicles: List[Vehicle], stops: List[Stop], 
                  options: Dict[str, Any] = None) -> List[RouteResult]:
        """
        Solve Vehicle Routing Problem with time windows and capacity constraints.
        
        Args:
            vehicles: List of available vehicles
            stops: List of stops to visit (including depot)
            options: Solver options
        
        Returns:
            List of optimized routes, one per vehicle
        """
        options = options or {}
        request_id = options.get("request_id", "vrp_solve")
        
        with self.logger.operation_context("vrp_solve", request_id):
            if not ORTOOLS_AVAILABLE:
                return self._fallback_solver(vehicles, stops, options)
            
            try:
                return self._solve_with_ortools(vehicles, stops, options)
            except Exception as e:
                self.logger.error("OR-Tools solver failed, using fallback", error=e, request_id=request_id)
                return self._fallback_solver(vehicles, stops, options)
    
    def _solve_with_ortools(self, vehicles: List[Vehicle], stops: List[Stop], 
                           options: Dict[str, Any]) -> List[RouteResult]:
        """Solve using OR-Tools"""
        request_id = options.get("request_id", "ortools_solve")
        
        # Prepare data
        locations = [stop.location for stop in stops]
        time_matrix, distance_matrix = self.travel_provider.get_travel_matrix(locations)
        
        # Create the routing index manager
        manager = pywrapcp.RoutingIndexManager(
            len(locations),  # Number of locations
            len(vehicles),   # Number of vehicles
            [0] * len(vehicles),  # Depot indices (all start from depot)
            [0] * len(vehicles)   # End indices (all end at depot)
        )
        
        # Create routing model
        routing = pywrapcp.RoutingModel(manager)
        
        # Create and register transit callback
        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return time_matrix[from_node][to_node]
        
        transit_callback_index = routing.RegisterTransitCallback(time_callback)
        
        # Define cost of each arc
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
        
        # Add time windows constraint
        time_dimension_name = 'Time'
        routing.AddDimension(
            transit_callback_index,
            30 * 60,  # Allow up to 30 minutes of slack
            max(vehicle.max_duration for vehicle in vehicles),  # Maximum time per vehicle
            False,  # Don't force start cumul to zero
            time_dimension_name
        )
        time_dimension = routing.GetDimensionOrDie(time_dimension_name)
        
        # Set time windows for each stop
        for location_idx, stop in enumerate(stops):
            index = manager.NodeToIndex(location_idx)
            if stop.time_window:
                time_dimension.CumulVar(index).SetRange(stop.time_window[0], stop.time_window[1])
        
        # Add capacity constraint if needed
        if any(stop.order_id for stop in stops):  # If we have pickups/deliveries
            def demand_callback(from_index):
                from_node = manager.IndexToNode(from_index)
                stop = stops[from_node]
                # Simple demand model: +1 for pickup, -1 for delivery
                if stop.stop_type == 'pickup':
                    return 1
                elif stop.stop_type == 'delivery':
                    return -1
                return 0
            
            demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
            routing.AddDimensionWithVehicleCapacity(
                demand_callback_index,
                0,  # Null capacity slack
                [vehicle.capacity for vehicle in vehicles],  # Vehicle maximum capacities
                True,  # Start cumul to zero
                'Capacity'
            )
        
        # Add pickup and delivery constraints
        pickup_deliveries = self._group_pickup_deliveries(stops)
        for pickup_idx, delivery_idx in pickup_deliveries:
            pickup_index = manager.NodeToIndex(pickup_idx)
            delivery_index = manager.NodeToIndex(delivery_idx)
            routing.AddPickupAndDelivery(pickup_index, delivery_index)
            routing.solver().Add(
                routing.VehicleVar(pickup_index) == routing.VehicleVar(delivery_index)
            )
            routing.solver().Add(
                time_dimension.CumulVar(pickup_index) <= time_dimension.CumulVar(delivery_index)
            )
        
        # Set search parameters
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.time_limit.seconds = self.search_time_limit
        search_parameters.solution_limit = self.solution_limit
        
        if self.use_guided_local_search:
            search_parameters.first_solution_strategy = (
                routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
            )
            search_parameters.local_search_metaheuristic = (
                routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
            )
        
        # Solve the problem
        self.logger.info("Starting OR-Tools VRP solve", 
                        request_id=request_id,
                        locations=len(locations),
                        vehicles=len(vehicles),
                        time_limit=self.search_time_limit)
        
        solution = routing.SolveWithParameters(search_parameters)
        
        if solution:
            return self._extract_solution(manager, routing, solution, vehicles, stops, 
                                        distance_matrix, time_matrix, request_id)
        else:
            self.logger.warning("OR-Tools found no solution, using fallback", request_id=request_id)
            return self._fallback_solver(vehicles, stops, options)
    
    def _extract_solution(self, manager, routing, solution, vehicles: List[Vehicle], 
                         stops: List[Stop], distance_matrix: List[List[float]], 
                         time_matrix: List[List[int]], request_id: str) -> List[RouteResult]:
        """Extract solution from OR-Tools solver"""
        results = []
        time_dimension = routing.GetDimensionOrDie('Time')
        
        for vehicle_idx, vehicle in enumerate(vehicles):
            route_stops = []
            total_distance = 0
            total_time = 0
            current_time = 0
            arrival_times = []
            
            index = routing.Start(vehicle_idx)
            route_empty = True
            
            while not routing.IsEnd(index):
                node_index = manager.IndexToNode(index)
                stop = stops[node_index]
                
                # Skip depot for route calculation but include in timing
                if node_index != 0:  # Assuming depot is at index 0
                    route_empty = False
                    route_stops.append({
                        "stop_id": stop.id,
                        "order_id": stop.order_id,
                        "stop_type": stop.stop_type,
                        "lat": stop.location.lat,
                        "lng": stop.location.lng,
                        "sequence": len(route_stops),
                        "arrival_time": current_time,
                        "service_time": stop.service_time
                    })
                
                arrival_times.append(current_time)
                
                # Get next index
                previous_index = index
                index = solution.Value(routing.NextVar(index))
                
                if not routing.IsEnd(index):
                    next_node = manager.IndexToNode(index)
                    travel_time = time_matrix[node_index][next_node]
                    travel_distance = distance_matrix[node_index][next_node]
                    
                    total_time += travel_time + stop.service_time
                    total_distance += travel_distance
                    current_time += travel_time + stop.service_time
            
            # Only include non-empty routes
            if not route_empty:
                # Calculate optimization score based on various factors
                optimization_score = self._calculate_optimization_score(
                    route_stops, total_distance, total_time, vehicle
                )
                
                results.append(RouteResult(
                    vehicle_id=vehicle.id,
                    stops=route_stops,
                    total_distance_km=round(total_distance, 2),
                    total_duration_minutes=int(total_time / 60),
                    load_sequence=[],  # Would be populated with actual load tracking
                    arrival_times=arrival_times,
                    optimization_score=optimization_score
                ))
        
        self.logger.info("OR-Tools solution extracted", 
                        request_id=request_id,
                        routes_generated=len(results),
                        total_stops=sum(len(r.stops) for r in results))
        
        return results
    
    def _fallback_solver(self, vehicles: List[Vehicle], stops: List[Stop], 
                        options: Dict[str, Any]) -> List[RouteResult]:
        """Simple fallback solver when OR-Tools is not available"""
        request_id = options.get("request_id", "fallback_solve")
        
        self.logger.info("Using fallback heuristic solver", request_id=request_id)
        
        # Simple nearest neighbor heuristic
        results = []
        depot = next((stop for stop in stops if stop.stop_type == 'depot'), stops[0])
        remaining_stops = [stop for stop in stops if stop.stop_type != 'depot']
        
        for vehicle_idx, vehicle in enumerate(vehicles):
            if not remaining_stops:
                break
            
            route_stops = []
            current_location = depot.location
            total_distance = 0
            total_time = 0
            vehicle_capacity_used = 0
            
            # Simple capacity and time constraints
            while remaining_stops and vehicle_capacity_used < vehicle.capacity:
                # Find nearest unvisited stop
                nearest_stop = None
                nearest_distance = float('inf')
                
                for stop in remaining_stops:
                    distance = current_location.distance_to(stop.location)
                    if distance < nearest_distance:
                        # Check capacity constraint
                        capacity_change = 1 if stop.stop_type == 'pickup' else -1
                        if vehicle_capacity_used + capacity_change <= vehicle.capacity:
                            nearest_distance = distance
                            nearest_stop = stop
                
                if nearest_stop is None:
                    break
                
                # Add stop to route
                travel_time, travel_distance = self.travel_provider.get_travel_time(
                    current_location, nearest_stop.location
                )
                
                total_distance += travel_distance
                total_time += travel_time + nearest_stop.service_time
                
                route_stops.append({
                    "stop_id": nearest_stop.id,
                    "order_id": nearest_stop.order_id,
                    "stop_type": nearest_stop.stop_type,
                    "lat": nearest_stop.location.lat,
                    "lng": nearest_stop.location.lng,
                    "sequence": len(route_stops),
                    "arrival_time": total_time - nearest_stop.service_time,
                    "service_time": nearest_stop.service_time
                })
                
                current_location = nearest_stop.location
                remaining_stops.remove(nearest_stop)
                
                if nearest_stop.stop_type == 'pickup':
                    vehicle_capacity_used += 1
                elif nearest_stop.stop_type == 'delivery':
                    vehicle_capacity_used -= 1
            
            if route_stops:
                optimization_score = self._calculate_optimization_score(
                    route_stops, total_distance, total_time, vehicle
                )
                
                results.append(RouteResult(
                    vehicle_id=vehicle.id,
                    stops=route_stops,
                    total_distance_km=round(total_distance, 2),
                    total_duration_minutes=int(total_time / 60),
                    load_sequence=[],
                    arrival_times=[],
                    optimization_score=optimization_score
                ))
        
        return results
    
    def _group_pickup_deliveries(self, stops: List[Stop]) -> List[Tuple[int, int]]:
        """Group pickup and delivery stops by order_id"""
        pickup_deliveries = []
        order_stops = {}
        
        for idx, stop in enumerate(stops):
            if stop.order_id:
                if stop.order_id not in order_stops:
                    order_stops[stop.order_id] = {}
                order_stops[stop.order_id][stop.stop_type] = idx
        
        for order_id, stop_types in order_stops.items():
            if 'pickup' in stop_types and 'delivery' in stop_types:
                pickup_deliveries.append((stop_types['pickup'], stop_types['delivery']))
        
        return pickup_deliveries
    
    def _calculate_optimization_score(self, route_stops: List[Dict], total_distance: float, 
                                    total_time: int, vehicle: Vehicle) -> float:
        """Calculate optimization score (0-100) based on route efficiency"""
        if not route_stops:
            return 0.0
        
        # Base score factors
        distance_score = max(0, 100 - (total_distance * 2))  # Penalize distance
        time_score = max(0, 100 - (total_time / 3600 * 20))  # Penalize time (hours * 20)
        
        # Capacity utilization score
        capacity_used = len([s for s in route_stops if s['stop_type'] == 'pickup'])
        capacity_score = (capacity_used / vehicle.capacity) * 100 if vehicle.capacity > 0 else 50
        
        # Weighted average
        optimization_score = (distance_score * 0.4 + time_score * 0.4 + capacity_score * 0.2)
        
        return round(min(100, max(0, optimization_score)), 1)


# Factory function to create travel time provider
def create_travel_provider(provider_type: str = None, **kwargs) -> TravelTimeProvider:
    """Create a travel time provider based on configuration"""
    provider_type = provider_type or os.getenv("TRAVEL_TIME_PROVIDER", "mock")
    
    if provider_type == "graphhopper":
        api_key = kwargs.get("api_key") or os.getenv("GRAPHHOPPER_API_KEY")
        return GraphHopperProvider(api_key=api_key)
    elif provider_type == "osrm":
        base_url = kwargs.get("base_url") or os.getenv("OSRM_BASE_URL", "http://router.project-osrm.org")
        return OSRMProvider(base_url=base_url)
    else:
        avg_speed = kwargs.get("avg_speed_kmh", 40.0)
        return MockTravelTimeProvider(avg_speed_kmh=avg_speed)


# Main solver factory
def create_solver(config: Dict[str, Any] = None, travel_provider: TravelTimeProvider = None) -> ORToolsSolver:
    """Create an optimized VRP solver"""
    if travel_provider is None:
        travel_provider = create_travel_provider()
    
    return ORToolsSolver(travel_provider=travel_provider, config=config or {})


if __name__ == "__main__":
    # Example usage
    logger = get_logger("solver_example")
    
    # Create some example locations
    depot = Location(45.4215, -75.6972, "depot")
    pickup1 = Location(45.4235, -75.6985, "pickup1")
    delivery1 = Location(45.4105, -75.6812, "delivery1")
    pickup2 = Location(45.4255, -75.7000, "pickup2")
    delivery2 = Location(45.4000, -75.6800, "delivery2")
    
    # Create stops
    stops = [
        Stop("depot", depot, "depot"),
        Stop("p1", pickup1, "pickup", "order1", service_time=300),
        Stop("d1", delivery1, "delivery", "order1", service_time=180),
        Stop("p2", pickup2, "pickup", "order2", service_time=300),
        Stop("d2", delivery2, "delivery", "order2", service_time=180),
    ]
    
    # Create vehicle
    vehicles = [
        Vehicle("vehicle1", depot, capacity=2)
    ]
    
    # Solve
    solver = create_solver()
    results = solver.solve_vrp(vehicles, stops, {"request_id": "example"})
    
    for result in results:
        logger.info("Route optimized", 
                   vehicle_id=result.vehicle_id,
                   stops=len(result.stops),
                   distance_km=result.total_distance_km,
                   duration_min=result.total_duration_minutes,
                   score=result.optimization_score)