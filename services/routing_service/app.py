# CREATE FILE: services/routing_service/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import json
import os
from .batching import BatchingEngine, Order, Batch
from .routing import RoutingEngine, Route

app = FastAPI(title="Routing Service", version="1.0.0")

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