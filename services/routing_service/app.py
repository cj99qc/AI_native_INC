# CREATE FILE: services/routing_service/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import json
import os
import sys

# Add utils to path for logging
sys.path.append(os.path.join(os.path.dirname(__file__), '../../'))
from utils.logging import get_logger

# Import existing modules
from .batching import BatchingEngine, Order, Batch
from .routing import RoutingEngine, Route

# Import new OR-Tools solver
from .solver import create_solver, Location, Stop, Vehicle, create_travel_provider
from .travel_time import create_travel_time_manager

app = FastAPI(title="Routing Service", version="2.0.0")

# Initialize logger
logger = get_logger("routing_service")

# Load configuration
def load_config():
    config_path = os.path.join(os.path.dirname(__file__), '../../config/defaults.json')
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Fallback defaults
        return {
            "max_batch_size_orders": 8,
            "batch_window_minutes": 15,
            "max_detour_pct": 30.0,
            "tsp_2opt_iterations": 100,
            "seed": 42,
            "routing": {
                "use_ortools": True,
                "search_time_limit_seconds": 30,
                "travel_time_provider": "mock",
                "cache_ttl_seconds": 3600
            }
        }

config = load_config()
batching_engine = BatchingEngine(config)
routing_engine = RoutingEngine(config)

# Initialize OR-Tools solver and travel time manager
use_ortools = os.getenv("FEATURE_OR_TOOLS", "false").lower() == "true"
or_config = config.get("routing", {})

if use_ortools:
    try:
        # Create travel time manager
        travel_manager = create_travel_time_manager({
            "providers": [
                {"type": or_config.get("travel_time_provider", "mock")},
                {"type": "mock", "avg_speed_kmh": 40}  # Fallback
            ],
            "cache_ttl_seconds": or_config.get("cache_ttl_seconds", 3600)
        })
        
        # Create OR-Tools solver
        ortools_solver = create_solver(
            config=or_config,
            travel_provider=travel_manager.providers[0]  # Use primary provider
        )
        
        logger.info("OR-Tools solver initialized successfully", 
                   provider=or_config.get("travel_time_provider", "mock"))
    except Exception as e:
        logger.error("Failed to initialize OR-Tools solver, falling back to heuristic", error=e)
        use_ortools = False
        ortools_solver = None
        travel_manager = None
else:
    logger.info("OR-Tools disabled, using heuristic routing only")
    ortools_solver = None
    travel_manager = None

class OrderRequest(BaseModel):
    id: str
    pickup_lat: float = Field(..., ge=-90, le=90)
    pickup_lng: float = Field(..., ge=-180, le=180)
    delivery_lat: float = Field(..., ge=-90, le=90)
    delivery_lng: float = Field(..., ge=-180, le=180)
    created_at: Optional[str] = None
    priority: int = Field(1, ge=1, le=10)
    estimated_prep_time_minutes: int = Field(15, ge=0, le=120)

class BatchRequest(BaseModel):
    orders: List[OrderRequest]
    current_time: Optional[str] = None

class RouteRequest(BaseModel):
    batch_id: str
    orders: List[OrderRequest]
    driver_location: Optional[Dict[str, float]] = None  # {"lat": 45.4215, "lng": -75.6972}
    algorithm: str = Field("auto", regex="^(auto|heuristic|ortools|vrp)$")
    options: Optional[Dict[str, Any]] = None

class BatchResponse(BaseModel):
    batches: List[Dict[str, Any]]
    total_orders: int
    total_batches: int
    avg_batch_size: float

class RouteStopResponse(BaseModel):
    order_id: str
    stop_type: str
    lat: float
    lng: float
    sequence: int
    estimated_arrival_minutes: int

class RouteResponse(BaseModel):
    batch_id: str
    stops: List[RouteStopResponse]
    total_distance_km: float
    estimated_duration_minutes: int
    optimization_algorithm: str
    optimization_score: float
    solver_metadata: Optional[Dict[str, Any]] = None

class HealthResponse(BaseModel):
    status: str
    ortools_available: bool
    travel_time_providers: List[str]
    config: Dict[str, Any]

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Enhanced health check with solver status"""
    with logger.request_context(endpoint="/health", method="GET") as request_id:
        providers = []
        if travel_manager:
            stats = travel_manager.get_stats()
            providers = [p["provider"] for p in stats.get("providers", [])]
        
        return HealthResponse(
            status="healthy",
            ortools_available=use_ortools and ortools_solver is not None,
            travel_time_providers=providers,
            config={
                "feature_ortools_enabled": use_ortools,
                "max_batch_size": config.get("max_batch_size_orders", 8),
                "search_time_limit": or_config.get("search_time_limit_seconds", 30)
            }
        )

@app.post("/route", response_model=RouteResponse)
async def optimize_route(request: RouteRequest):
    """
    Optimize routes for a batch of orders using advanced algorithms.
    
    Supports multiple optimization algorithms:
    - auto: Automatically choose best algorithm
    - heuristic: Fast nearest-neighbor approach
    - ortools: Advanced VRP solver with constraints
    - vrp: Alias for ortools
    
    Considers constraints:
    - Pickup before delivery
    - Vehicle capacity
    - Time windows
    - Distance/time minimization
    """
    with logger.request_context(endpoint="/route", method="POST") as request_id:
        try:
            logger.info("Starting route optimization",
                       request_id=request_id,
                       algorithm=request.algorithm,
                       order_count=len(request.orders))
            
            # Determine which algorithm to use
            algorithm = request.algorithm
            if algorithm == "auto":
                # Choose algorithm based on availability and order count
                if use_ortools and ortools_solver and len(request.orders) >= 3:
                    algorithm = "ortools"
                else:
                    algorithm = "heuristic"
            
            # Handle OR-Tools/VRP routing
            if algorithm in ["ortools", "vrp"] and use_ortools and ortools_solver:
                return await _optimize_with_ortools(request, request_id)
            
            # Fall back to heuristic routing
            return await _optimize_with_heuristic(request, request_id, algorithm)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Route optimization failed", error=e, request_id=request_id)
            raise HTTPException(status_code=500, detail=f"Route optimization failed: {str(e)}")

async def _optimize_with_ortools(request: RouteRequest, request_id: str) -> RouteResponse:
    """Optimize using OR-Tools VRP solver"""
    with logger.operation_context("ortools_optimization", request_id):
        try:
            # Create locations and stops
            locations = []
            stops = []
            
            # Add depot (driver location or default)
            if request.driver_location:
                depot_location = Location(
                    lat=request.driver_location["lat"],
                    lng=request.driver_location["lng"],
                    id="depot"
                )
            else:
                # Use center of orders as depot
                center_lat = sum(o.pickup_lat for o in request.orders) / len(request.orders)
                center_lng = sum(o.pickup_lng for o in request.orders) / len(request.orders)
                depot_location = Location(lat=center_lat, lng=center_lng, id="depot")
            
            locations.append(depot_location)
            stops.append(Stop("depot", depot_location, "depot"))
            
            # Add pickup and delivery stops
            for order in request.orders:
                # Pickup stop
                pickup_location = Location(order.pickup_lat, order.pickup_lng, f"pickup_{order.id}")
                pickup_stop = Stop(
                    f"pickup_{order.id}",
                    pickup_location,
                    "pickup",
                    order_id=order.id,
                    service_time=order.estimated_prep_time_minutes * 60,  # Convert to seconds
                    priority=order.priority
                )
                locations.append(pickup_location)
                stops.append(pickup_stop)
                
                # Delivery stop
                delivery_location = Location(order.delivery_lat, order.delivery_lng, f"delivery_{order.id}")
                delivery_stop = Stop(
                    f"delivery_{order.id}",
                    delivery_location,
                    "delivery",
                    order_id=order.id,
                    service_time=300,  # 5 minutes delivery time
                    priority=order.priority
                )
                locations.append(delivery_location)
                stops.append(delivery_stop)
            
            # Create vehicle
            vehicles = [Vehicle("vehicle_1", depot_location, capacity=len(request.orders))]
            
            # Solve with OR-Tools
            solver_options = {
                "request_id": request_id,
                **(request.options or {})
            }
            
            results = ortools_solver.solve_vrp(vehicles, stops, solver_options)
            
            if not results:
                raise Exception("OR-Tools solver found no solution")
            
            route_result = results[0]  # Take first vehicle route
            
            # Convert to API response format
            stops_response = []
            for stop_data in route_result.stops:
                stops_response.append(RouteStopResponse(
                    order_id=stop_data["order_id"],
                    stop_type=stop_data["stop_type"],
                    lat=stop_data["lat"],
                    lng=stop_data["lng"],
                    sequence=stop_data["sequence"],
                    estimated_arrival_minutes=stop_data.get("arrival_time", 0) // 60
                ))
            
            logger.info("OR-Tools optimization completed",
                       request_id=request_id,
                       stops_generated=len(stops_response),
                       total_distance=route_result.total_distance_km,
                       optimization_score=route_result.optimization_score)
            
            return RouteResponse(
                batch_id=request.batch_id,
                stops=stops_response,
                total_distance_km=route_result.total_distance_km,
                estimated_duration_minutes=route_result.total_duration_minutes,
                optimization_algorithm="ortools",
                optimization_score=route_result.optimization_score,
                solver_metadata={
                    "solver_version": "ortools",
                    "travel_provider": ortools_solver.travel_provider.__class__.__name__,
                    "constraints_used": ["pickup_delivery", "capacity", "time_windows"]
                }
            )
            
        except Exception as e:
            logger.warning("OR-Tools optimization failed, falling back to heuristic", 
                          error=e, request_id=request_id)
            # Fall back to heuristic
            return await _optimize_with_heuristic(request, request_id, "heuristic_fallback")

async def _optimize_with_heuristic(request: RouteRequest, request_id: str, algorithm: str) -> RouteResponse:
    """Optimize using existing heuristic solver"""
    with logger.operation_context("heuristic_optimization", request_id):
        # Convert request orders to Order objects
        orders = []
        for order_req in request.orders:
            orders.append(Order(
                id=order_req.id,
                pickup_lat=order_req.pickup_lat,
                pickup_lng=order_req.pickup_lng,
                delivery_lat=order_req.delivery_lat,
                delivery_lng=order_req.delivery_lng,
                created_at=datetime.now(),
                priority=order_req.priority,
                estimated_prep_time_minutes=order_req.estimated_prep_time_minutes
            ))
        
        # Create batch
        if not orders:
            raise HTTPException(status_code=400, detail="At least one order is required")
        
        # Calculate batch center
        center_lat = sum(o.pickup_lat for o in orders) / len(orders)
        center_lng = sum(o.pickup_lng for o in orders) / len(orders)
        
        batch = Batch(
            id=request.batch_id,
            orders=orders,
            center_lat=center_lat,
            center_lng=center_lng,
            created_at=datetime.now()
        )
        
        # Extract driver location
        driver_location = None
        if request.driver_location:
            driver_location = (
                request.driver_location["lat"],
                request.driver_location["lng"]
            )
        
        # Optimize route using existing engine
        route = routing_engine.optimize_route(batch, driver_location, "heuristic")
        
        # Convert to response format
        stops_response = []
        for stop in route.stops:
            stops_response.append(RouteStopResponse(
                order_id=stop.order_id,
                stop_type=stop.stop_type,
                lat=stop.lat,
                lng=stop.lng,
                sequence=stop.sequence,
                estimated_arrival_minutes=stop.estimated_arrival_minutes
            ))
        
        logger.info("Heuristic optimization completed",
                   request_id=request_id,
                   stops_generated=len(stops_response),
                   total_distance=route.total_distance_km,
                   optimization_score=route.optimization_score)
        
        return RouteResponse(
            batch_id=route.batch_id,
            stops=stops_response,
            total_distance_km=route.total_distance_km,
            estimated_duration_minutes=route.estimated_duration_minutes,
            optimization_algorithm=algorithm,
            optimization_score=route.optimization_score,
            solver_metadata={
                "solver_version": "heuristic",
                "algorithm_used": route.optimization_algorithm
            }
        )

@app.get("/config")
async def get_routing_config():
    """Get current routing configuration"""
    with logger.request_context(endpoint="/config", method="GET") as request_id:
        config_response = {
            **config,
            "ortools_enabled": use_ortools,
            "available_algorithms": ["auto", "heuristic"]
        }
        
        if use_ortools:
            config_response["available_algorithms"].extend(["ortools", "vrp"])
            if travel_manager:
                config_response["travel_time_stats"] = travel_manager.get_stats()
        
        return config_response

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8002"))
    logger.info("Starting routing service", port=port, ortools_enabled=use_ortools)
    uvicorn.run(app, host="0.0.0.0", port=port)
    config_path = os.path.join(os.path.dirname(__file__), '../../config/defaults.json')
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Fallback defaults
        return {
            "max_batch_size_orders": 8,
            "batch_window_minutes": 15,
            "max_detour_pct": 30.0,
            "tsp_2opt_iterations": 100,
            "seed": 42
        }

config = load_config()
batching_engine = BatchingEngine(config)
routing_engine = RoutingEngine(config)

class OrderRequest(BaseModel):
    id: str
    pickup_lat: float = Field(..., ge=-90, le=90)
    pickup_lng: float = Field(..., ge=-180, le=180)
    delivery_lat: float = Field(..., ge=-90, le=90)
    delivery_lng: float = Field(..., ge=-180, le=180)
    created_at: Optional[str] = None
    priority: int = Field(1, ge=1, le=10)
    estimated_prep_time_minutes: int = Field(15, ge=0, le=120)

class BatchRequest(BaseModel):
    orders: List[OrderRequest]
    current_time: Optional[str] = None

class RouteRequest(BaseModel):
    batch_id: str
    orders: List[OrderRequest]
    driver_location: Optional[Dict[str, float]] = None  # {"lat": 45.4215, "lng": -75.6972}
    algorithm: str = Field("heuristic", regex="^(heuristic|vrp)$")

class BatchResponse(BaseModel):
    batches: List[Dict[str, Any]]
    total_orders: int
    total_batches: int
    avg_batch_size: float

class RouteStopResponse(BaseModel):
    order_id: str
    stop_type: str
    lat: float
    lng: float
    sequence: int
    estimated_arrival_minutes: int

class RouteResponse(BaseModel):
    batch_id: str
    stops: List[RouteStopResponse]
    total_distance_km: float
    estimated_duration_minutes: int
    optimization_algorithm: str
    optimization_score: float

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}

@app.post("/batch", response_model=BatchResponse)
async def create_batches(request: BatchRequest):
    """
    Create batches from a list of orders using clustering and time windows.
    
    This endpoint groups orders into efficient batches considering:
    - Geographic proximity
    - Time windows
    - Maximum batch sizes
    - Order priorities
    """
    try:
        # Parse current time
        current_time = None
        if request.current_time:
            try:
                current_time = datetime.fromisoformat(request.current_time.replace('Z', '+00:00'))
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid current_time format. Use ISO 8601.")
        
        # Convert request orders to Order objects
        orders = []
        for order_req in request.orders:
            created_at = current_time or datetime.now()
            if order_req.created_at:
                try:
                    created_at = datetime.fromisoformat(order_req.created_at.replace('Z', '+00:00'))
                except ValueError:
                    pass  # Use current_time as fallback
            
            orders.append(Order(
                id=order_req.id,
                pickup_lat=order_req.pickup_lat,
                pickup_lng=order_req.pickup_lng,
                delivery_lat=order_req.delivery_lat,
                delivery_lng=order_req.delivery_lng,
                created_at=created_at,
                priority=order_req.priority,
                estimated_prep_time_minutes=order_req.estimated_prep_time_minutes
            ))
        
        # Create batches
        batches = batching_engine.create_batches(orders, current_time)
        
        # Convert to response format
        batch_dicts = []
        for batch in batches:
            # Estimate duration
            duration = batching_engine.estimate_batch_duration(batch)
            
            batch_dict = {
                "id": batch.id,
                "order_ids": [order.id for order in batch.orders],
                "center_lat": batch.center_lat,
                "center_lng": batch.center_lng,
                "total_orders": len(batch.orders),
                "estimated_duration_minutes": duration,
                "created_at": batch.created_at.isoformat()
            }
            batch_dicts.append(batch_dict)
        
        avg_batch_size = sum(len(b.orders) for b in batches) / len(batches) if batches else 0
        
        return BatchResponse(
            batches=batch_dicts,
            total_orders=len(orders),
            total_batches=len(batches),
            avg_batch_size=round(avg_batch_size, 2)
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batching failed: {str(e)}")

@app.post("/route", response_model=RouteResponse)
async def optimize_route(request: RouteRequest):
    """
    Optimize route for a batch of orders.
    
    This endpoint creates an optimal delivery route considering:
    - Pickup before delivery constraints
    - Distance minimization
    - Driver location
    - Traffic and time estimates
    """
    try:
        # Convert request orders to Order objects
        orders = []
        for order_req in request.orders:
            orders.append(Order(
                id=order_req.id,
                pickup_lat=order_req.pickup_lat,
                pickup_lng=order_req.pickup_lng,
                delivery_lat=order_req.delivery_lat,
                delivery_lng=order_req.delivery_lng,
                created_at=datetime.now(),
                priority=order_req.priority,
                estimated_prep_time_minutes=order_req.estimated_prep_time_minutes
            ))
        
        # Create batch
        if not orders:
            raise HTTPException(status_code=400, detail="At least one order is required")
        
        # Calculate batch center
        center_lat = sum(o.pickup_lat for o in orders) / len(orders)
        center_lng = sum(o.pickup_lng for o in orders) / len(orders)
        
        batch = Batch(
            id=request.batch_id,
            orders=orders,
            center_lat=center_lat,
            center_lng=center_lng,
            created_at=datetime.now()
        )
        
        # Extract driver location
        driver_location = None
        if request.driver_location:
            driver_location = (
                request.driver_location["lat"],
                request.driver_location["lng"]
            )
        
        # Optimize route
        route = routing_engine.optimize_route(batch, driver_location, request.algorithm)
        
        # Convert to response format
        stops_response = []
        for stop in route.stops:
            stops_response.append(RouteStopResponse(
                order_id=stop.order_id,
                stop_type=stop.stop_type,
                lat=stop.lat,
                lng=stop.lng,
                sequence=stop.sequence,
                estimated_arrival_minutes=stop.estimated_arrival_minutes
            ))
        
        return RouteResponse(
            batch_id=route.batch_id,
            stops=stops_response,
            total_distance_km=route.total_distance_km,
            estimated_duration_minutes=route.estimated_duration_minutes,
            optimization_algorithm=route.optimization_algorithm,
            optimization_score=route.optimization_score
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Route optimization failed: {str(e)}")

@app.get("/config")
async def get_routing_config():
    """Get current routing configuration"""
    return config

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run(app, host="0.0.0.0", port=port)