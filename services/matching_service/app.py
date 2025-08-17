# CREATE FILE: services/matching_service/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
import json
import os
import math
import random

app = FastAPI(title="Matching Service", version="1.0.0")

# Load configuration
def load_config():
    config_path = os.path.join(os.path.dirname(__file__), '../../config/defaults.json')
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {"seed": 42}

config = load_config()
random.seed(config.get("seed", 42))

class Driver(BaseModel):
    id: str
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    rating: float = Field(5.0, ge=0, le=5)
    vehicle_capacity: int = Field(4, ge=1, le=20)
    is_active: bool = True
    current_orders: int = Field(0, ge=0)
    max_concurrent_orders: int = Field(8, ge=1)

class BatchData(BaseModel):
    id: str
    center_lat: float = Field(..., ge=-90, le=90)
    center_lng: float = Field(..., ge=-180, le=180)
    total_orders: int = Field(..., ge=1)
    estimated_duration_minutes: int = Field(..., ge=0)
    priority: int = Field(1, ge=1, le=10)

class AssignmentRequest(BaseModel):
    batch: BatchData
    available_drivers: List[Driver]
    max_distance_km: float = Field(50.0, ge=1.0, le=200.0)
    
class DriverScore(BaseModel):
    driver_id: str
    score: float
    distance_km: float
    capacity_utilization: float
    rating: float
    availability_factor: float

class AssignmentResponse(BaseModel):
    recommended_driver: Optional[DriverScore]
    all_candidates: List[DriverScore]
    batch_id: str

class AcceptanceRequest(BaseModel):
    driver_id: str
    batch_id: str
    distance_km: float
    estimated_duration_minutes: int
    base_payout: float

class AcceptanceResponse(BaseModel):
    driver_id: str
    batch_id: str
    acceptance_probability: float
    factors: Dict[str, float]

class MatchingEngine:
    """Driver matching engine with scoring and acceptance prediction"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
    
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
    
    def calculate_distance_score(self, distance_km: float, max_distance: float) -> float:
        """Score based on proximity (closer is better)"""
        if distance_km > max_distance:
            return 0.0
        
        # Exponential decay: closer drivers get much higher scores
        normalized_distance = distance_km / max_distance
        return max(0.0, 1.0 - (normalized_distance ** 1.5))
    
    def calculate_capacity_score(self, driver: Driver, batch: BatchData) -> float:
        """Score based on capacity availability and utilization"""
        available_capacity = driver.max_concurrent_orders - driver.current_orders
        
        if available_capacity <= 0:
            return 0.0
        
        if batch.total_orders > available_capacity:
            return 0.0  # Cannot handle this batch
        
        # Higher score for drivers who can handle the batch with room to spare
        utilization = (driver.current_orders + batch.total_orders) / driver.max_concurrent_orders
        
        # Optimal utilization is around 70-80%
        if utilization <= 0.8:
            return 1.0 - abs(utilization - 0.7) / 0.7
        else:
            # Penalty for over-utilization
            return max(0.0, 1.0 - (utilization - 0.8) / 0.2)
    
    def calculate_rating_score(self, rating: float) -> float:
        """Score based on driver rating (5.0 is perfect)"""
        return rating / 5.0
    
    def calculate_availability_score(self, driver: Driver) -> float:
        """Score based on current availability"""
        if not driver.is_active:
            return 0.0
        
        # Lower current load = higher availability
        load_factor = driver.current_orders / driver.max_concurrent_orders
        return 1.0 - load_factor
    
    def calculate_incentive_score(self, driver: Driver, batch: BatchData) -> float:
        """Calculate incentive factor based on batch characteristics"""
        # Higher score for high-priority batches
        priority_score = batch.priority / 10.0
        
        # Higher score for larger batches (more efficient)
        size_score = min(1.0, batch.total_orders / 5.0)
        
        # Time-based incentive (longer jobs might need incentives)
        if batch.estimated_duration_minutes > 120:  # > 2 hours
            time_penalty = 0.8
        elif batch.estimated_duration_minutes > 60:  # > 1 hour
            time_penalty = 0.9
        else:
            time_penalty = 1.0
        
        return (priority_score * 0.4 + size_score * 0.6) * time_penalty
    
    def calculate_composite_score(self, driver: Driver, batch: BatchData, 
                                distance_km: float, max_distance: float) -> DriverScore:
        """Calculate composite matching score"""
        
        # Individual component scores
        distance_score = self.calculate_distance_score(distance_km, max_distance)
        capacity_score = self.calculate_capacity_score(driver, batch)
        rating_score = self.calculate_rating_score(driver.rating)
        availability_score = self.calculate_availability_score(driver)
        incentive_score = self.calculate_incentive_score(driver, batch)
        
        # Weighted composite score
        weights = {
            'distance': 0.35,    # Proximity is very important
            'capacity': 0.25,    # Can they handle the batch?
            'rating': 0.15,      # Quality of service
            'availability': 0.15, # Current workload
            'incentive': 0.10    # Special circumstances
        }
        
        composite_score = (
            distance_score * weights['distance'] +
            capacity_score * weights['capacity'] +
            rating_score * weights['rating'] +
            availability_score * weights['availability'] +
            incentive_score * weights['incentive']
        )
        
        # If driver cannot handle the batch at all, score is 0
        if capacity_score == 0.0 or not driver.is_active:
            composite_score = 0.0
        
        return DriverScore(
            driver_id=driver.id,
            score=composite_score,
            distance_km=distance_km,
            capacity_utilization=(driver.current_orders + batch.total_orders) / driver.max_concurrent_orders,
            rating=driver.rating,
            availability_factor=availability_score
        )
    
    def find_best_drivers(self, batch: BatchData, drivers: List[Driver], 
                         max_distance: float) -> List[DriverScore]:
        """Find and rank the best drivers for a batch"""
        scored_drivers = []
        
        for driver in drivers:
            distance = self.haversine_distance(
                driver.lat, driver.lng,
                batch.center_lat, batch.center_lng
            )
            
            if distance <= max_distance:
                score = self.calculate_composite_score(driver, batch, distance, max_distance)
                scored_drivers.append(score)
        
        # Sort by score (highest first)
        scored_drivers.sort(key=lambda x: x.score, reverse=True)
        
        return scored_drivers
    
    def predict_acceptance_probability(self, driver_id: str, distance_km: float, 
                                     duration_minutes: int, payout: float) -> Dict[str, float]:
        """Predict probability that driver will accept the batch"""
        
        # Base acceptance rate
        base_rate = 0.75
        
        # Distance factor (closer = more likely to accept)
        if distance_km <= 5:
            distance_factor = 1.0
        elif distance_km <= 15:
            distance_factor = 0.9
        elif distance_km <= 30:
            distance_factor = 0.7
        else:
            distance_factor = 0.5
        
        # Duration factor (shorter jobs preferred)
        if duration_minutes <= 30:
            duration_factor = 1.0
        elif duration_minutes <= 60:
            duration_factor = 0.95
        elif duration_minutes <= 120:
            duration_factor = 0.85
        else:
            duration_factor = 0.7
        
        # Payout factor (higher payout = more likely to accept)
        if payout >= 50:
            payout_factor = 1.0
        elif payout >= 30:
            payout_factor = 0.95
        elif payout >= 20:
            payout_factor = 0.85
        elif payout >= 10:
            payout_factor = 0.7
        else:
            payout_factor = 0.5
        
        # Add some randomness for realism (time-based factors, driver mood, etc.)
        random_factor = random.uniform(0.85, 1.15)
        
        # Calculate final probability
        probability = base_rate * distance_factor * duration_factor * payout_factor * random_factor
        probability = max(0.0, min(1.0, probability))  # Clamp to [0,1]
        
        return {
            "acceptance_probability": probability,
            "base_rate": base_rate,
            "distance_factor": distance_factor,
            "duration_factor": duration_factor,
            "payout_factor": payout_factor,
            "random_factor": random_factor
        }

matching_engine = MatchingEngine(config)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"ok": True}

@app.post("/assign", response_model=AssignmentResponse)
async def assign_driver(request: AssignmentRequest):
    """
    Find the best driver for a batch using multi-factor scoring.
    
    Considers:
    - Proximity to batch center
    - Vehicle capacity and current load
    - Driver rating and availability
    - Batch priority and incentives
    """
    try:
        if not request.available_drivers:
            return AssignmentResponse(
                recommended_driver=None,
                all_candidates=[],
                batch_id=request.batch.id
            )
        
        # Find and rank drivers
        candidates = matching_engine.find_best_drivers(
            request.batch,
            request.available_drivers,
            request.max_distance_km
        )
        
        # Get the best candidate
        best_driver = candidates[0] if candidates and candidates[0].score > 0 else None
        
        return AssignmentResponse(
            recommended_driver=best_driver,
            all_candidates=candidates[:10],  # Return top 10 candidates
            batch_id=request.batch.id
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Driver assignment failed: {str(e)}")

@app.post("/simulate_acceptance", response_model=AcceptanceResponse)
async def simulate_acceptance(request: AcceptanceRequest):
    """
    Simulate driver acceptance probability for a batch.
    
    Predicts likelihood of driver accepting based on:
    - Distance to pickup
    - Job duration
    - Payout amount
    - Random factors (driver preferences, time of day, etc.)
    """
    try:
        factors = matching_engine.predict_acceptance_probability(
            request.driver_id,
            request.distance_km,
            request.estimated_duration_minutes,
            request.base_payout
        )
        
        return AcceptanceResponse(
            driver_id=request.driver_id,
            batch_id=request.batch_id,
            acceptance_probability=factors["acceptance_probability"],
            factors={k: v for k, v in factors.items() if k != "acceptance_probability"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Acceptance simulation failed: {str(e)}")

@app.get("/config")
async def get_matching_config():
    """Get current matching configuration"""
    return config

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port)