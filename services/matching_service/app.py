# CREATE FILE: services/matching_service/app.py

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import json
import os
import math
import random

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    POSTGIS_AVAILABLE = True
except ImportError:
    POSTGIS_AVAILABLE = False

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

# The Pulse worker
pulse_worker_task = None

# Database connection helper
def get_db_connection():
    """Get database connection if available"""
    if not POSTGIS_AVAILABLE:
        return None
    
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return None
    
    try:
        return psycopg2.connect(db_url, cursor_factory=RealDictCursor)
    except Exception:
        return None

class DriverStatus(BaseModel):
    """Previous driver location for trajectory calculation"""
    lat: float
    lng: float
    timestamp: datetime

class Driver(BaseModel):
    id: str
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    rating: float = Field(5.0, ge=0, le=5)
    vehicle_capacity: int = Field(4, ge=1, le=20)
    is_active: bool = True
    current_orders: int = Field(0, ge=0)
    max_concurrent_orders: int = Field(8, ge=1)
    previous_location: Optional[DriverStatus] = None  # For trajectory calculation

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
    artery_score: Optional[float] = None  # Highway 7 proximity score
    trajectory_score: Optional[float] = None  # Moving toward pickup score

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
    
    # Constants for trajectory and movement detection
    MOVEMENT_EPSILON = 0.0001  # Threshold for detecting stationary drivers (degrees)
    TRAJECTORY_NEUTRAL_SCORE = 0.5  # Score when no trajectory data available
    ARTERY_FALLBACK_SCORE = 0.5  # Score when PostGIS unavailable
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self._highway_geometry_cache = None  # Cache for Highway 7 geometry
    
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
    
    def get_artery_position_fraction(self, lat: float, lng: float) -> Optional[float]:
        """
        Calculate position on Highway 7 artery using PostGIS ST_LineLocatePoint
        Returns a fraction (0.0 to 1.0) representing position along the artery
        """
        conn = get_db_connection()
        if not conn:
            return None
        
        try:
            with conn.cursor() as cur:
                # Get the Highway 7 artery and calculate line locate point
                cur.execute("""
                    SELECT ST_LineLocatePoint(
                        route_geometry::geometry,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326)
                    ) as fraction
                    FROM highway_arteries
                    WHERE name = 'Highway 7'
                    LIMIT 1
                """, (lng, lat))
                
                result = cur.fetchone()
                if result:
                    return float(result['fraction'])
                return None
        except Exception:
            return None
        finally:
            conn.close()
    
    def calculate_artery_proximity_score(self, driver_lat: float, driver_lng: float,
                                        pickup_lat: float, pickup_lng: float) -> float:
        """
        Calculate score based on proximity to Highway 7 artery
        Higher score if both driver and pickup are near the artery
        """
        driver_fraction = self.get_artery_position_fraction(driver_lat, driver_lng)
        pickup_fraction = self.get_artery_position_fraction(pickup_lat, pickup_lng)
        
        if driver_fraction is None or pickup_fraction is None:
            # Fallback to neutral score if PostGIS unavailable
            return self.ARTERY_FALLBACK_SCORE
        
        # Score based on how close driver and pickup are along the artery
        # Closer positions = higher score
        distance_along_artery = abs(driver_fraction - pickup_fraction)
        
        # If they're close along the artery (within 20% of total length), high score
        if distance_along_artery < 0.2:
            return 1.0
        elif distance_along_artery < 0.4:
            return 0.8
        elif distance_along_artery < 0.6:
            return 0.5
        else:
            return 0.3
    
    def calculate_trajectory_score(self, driver: Driver, pickup_lat: float, pickup_lng: float) -> float:
        """
        Calculate score based on driver's trajectory toward the pickup
        Uses last two driver_status points to determine direction of movement
        """
        if not driver.previous_location:
            # No trajectory data available
            return self.TRAJECTORY_NEUTRAL_SCORE
        
        # Calculate vector from previous to current location (driver's movement)
        prev_lat = driver.previous_location.lat
        prev_lng = driver.previous_location.lng
        
        # Driver's movement vector
        movement_lat = driver.lat - prev_lat
        movement_lng = driver.lng - prev_lng
        
        # Vector from current location to pickup
        to_pickup_lat = pickup_lat - driver.lat
        to_pickup_lng = pickup_lng - driver.lng
        
        # Calculate dot product to determine alignment
        # If movement aligns with direction to pickup, score is higher
        dot_product = (movement_lat * to_pickup_lat + movement_lng * to_pickup_lng)
        
        # Normalize by magnitudes
        movement_magnitude = math.sqrt(movement_lat**2 + movement_lng**2)
        to_pickup_magnitude = math.sqrt(to_pickup_lat**2 + to_pickup_lng**2)
        
        if movement_magnitude < self.MOVEMENT_EPSILON or to_pickup_magnitude < self.MOVEMENT_EPSILON:
            # Driver is stationary or at pickup location
            return self.TRAJECTORY_NEUTRAL_SCORE
        
        # Cosine similarity: -1 (opposite) to 1 (same direction)
        cosine_sim = dot_product / (movement_magnitude * to_pickup_magnitude)
        
        # Map to 0-1 score: moving toward = 1.0, perpendicular = 0.5, away = 0.0
        trajectory_score = (cosine_sim + 1.0) / 2.0
        
        return trajectory_score
    
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
        """Calculate composite matching score with trajectory matching"""
        
        # Individual component scores
        distance_score = self.calculate_distance_score(distance_km, max_distance)
        capacity_score = self.calculate_capacity_score(driver, batch)
        rating_score = self.calculate_rating_score(driver.rating)
        availability_score = self.calculate_availability_score(driver)
        incentive_score = self.calculate_incentive_score(driver, batch)
        
        # NEW: Trajectory-based scores
        artery_score = self.calculate_artery_proximity_score(
            driver.lat, driver.lng, batch.center_lat, batch.center_lng
        )
        trajectory_score = self.calculate_trajectory_score(
            driver, batch.center_lat, batch.center_lng
        )
        
        # Updated weighted composite score with trajectory matching
        weights = {
            'distance': 0.20,      # Reduced from 0.35 - still important but not primary
            'capacity': 0.20,      # Reduced from 0.25
            'rating': 0.10,        # Reduced from 0.15
            'availability': 0.10,  # Reduced from 0.15
            'incentive': 0.05,     # Reduced from 0.10
            'artery': 0.20,        # NEW: Highway 7 proximity
            'trajectory': 0.15     # NEW: Moving toward pickup
        }
        
        composite_score = (
            distance_score * weights['distance'] +
            capacity_score * weights['capacity'] +
            rating_score * weights['rating'] +
            availability_score * weights['availability'] +
            incentive_score * weights['incentive'] +
            artery_score * weights['artery'] +
            trajectory_score * weights['trajectory']
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
            availability_factor=availability_score,
            artery_score=artery_score,
            trajectory_score=trajectory_score
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

# ============================================================================
# SERVICE DISCOVERY: GET /availability
# Completely decoupled from The Pulse — queries service_providers table only.
# No interaction with pulse_worker or the driver-matching pipeline.
# ============================================================================

class ServiceOffering(BaseModel):
    id: str
    display_name: str
    description: Optional[str]
    price_strategy: str
    base_price_cents: Optional[int]
    hourly_rate_cents: Optional[int]

class ServiceProviderResult(BaseModel):
    id: str
    name: str
    service_type: Optional[str]  # Deprecated, kept for backwards compat
    description: Optional[str]
    contact_info: Optional[Dict[str, Any]]
    distance_km: float
    services: List[ServiceOffering] = []  # New: services offered by this provider

class ServiceRecommendation(BaseModel):
    id: str
    name: str
    service_type: Optional[str]
    distance_km: float
    message: str

class AvailabilityResponse(BaseModel):
    providers: List[ServiceProviderResult]
    count: int
    message: str
    recommendation: Optional[ServiceRecommendation]

@app.get("/availability", response_model=AvailabilityResponse)
async def get_availability(
    service: Optional[str] = Query(None, description="Service slug (new)"),
    service_type: Optional[str] = Query(None, description="Deprecated: service_type (old)"),
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(20.0, ge=0.1, le=500.0),
):
    """
    Find active service providers near a location using PostGIS ST_DWithin.

    Supports new service_slug parameter and legacy service_type for backwards compat.
    Returns providers with their offered services, pricing, and distance.

    If no providers are found within radius_km, a recommendation field returns
    the nearest active provider outside the radius (InC Psychology: never
    return an empty list without a next step).
    """
    # Backwards compatibility: service_type param is an alias for service slug
    search_service = service or service_type
    if not search_service:
        raise HTTPException(
            status_code=400,
            detail="Must provide either 'service' or 'service_type' parameter"
        )

    conn = get_db_connection()
    if not conn:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable"
        )

    try:
        radius_m = radius_km * 1000  # ST_DWithin uses metres for GEOGRAPHY

        with conn.cursor() as cur:
            # Single query with JSON aggregation: returns each matching provider
            # along with all their offerings for this service slug. Replaces the
            # previous DISTINCT + N+1 fetch loop.
            cur.execute("""
                SELECT
                    sp.id::text                  AS id,
                    sp.name                      AS name,
                    sp.service_type              AS service_type,
                    sp.description               AS description,
                    sp.contact_info              AS contact_info,
                    ST_Distance(
                        sp.location,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                    ) / 1000.0                   AS distance_km,
                    jsonb_agg(
                        jsonb_build_object(
                            'id',                ps.id::text,
                            'display_name',      ps.display_name,
                            'description',       ps.description,
                            'price_strategy',    ps.price_strategy,
                            'base_price_cents',  ps.base_price_cents,
                            'hourly_rate_cents', ps.hourly_rate_cents
                        ) ORDER BY ps.display_name
                    ) FILTER (WHERE ps.id IS NOT NULL) AS services
                FROM service_providers sp
                INNER JOIN provider_services ps
                    ON ps.provider_id = sp.id
                   AND ps.is_active = true
                   AND ps.service_slug = %s
                WHERE sp.is_active = true
                  AND ST_DWithin(
                        sp.location,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                        %s
                  )
                GROUP BY sp.id
                ORDER BY distance_km ASC
            """, (lng, lat, search_service, lng, lat, radius_m))

            provider_rows = cur.fetchall()

        providers = [
            ServiceProviderResult(
                id=row["id"],
                name=row["name"],
                service_type=row.get("service_type"),
                description=row.get("description"),
                contact_info=row.get("contact_info"),
                distance_km=round(float(row["distance_km"]), 2),
                services=[ServiceOffering(**s) for s in (row.get("services") or [])],
            )
            for row in provider_rows
        ]

        # InC Psychology: never leave the user with nothing to act on
        recommendation = None
        if not providers:
            with conn.cursor() as cur:
                # Search the new junction table — this is the system of record.
                # Falls back to deprecated service_type if no provider_services
                # row exists yet (legacy data not yet migrated).
                cur.execute("""
                    SELECT
                        sp.id::text,
                        sp.name,
                        sp.service_type,
                        ST_Distance(
                            sp.location,
                            ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                        ) / 1000.0 AS distance_km
                    FROM service_providers sp
                    LEFT JOIN provider_services ps
                        ON ps.provider_id = sp.id
                       AND ps.is_active = true
                       AND ps.service_slug = %s
                    WHERE sp.is_active = true
                      AND (ps.id IS NOT NULL OR sp.service_type = %s)
                    ORDER BY distance_km ASC
                    LIMIT 1
                """, (lng, lat, search_service, search_service))
                nearest = cur.fetchone()

            if nearest:
                dist = round(float(nearest["distance_km"]), 1)
                recommendation = ServiceRecommendation(
                    id=nearest["id"],
                    name=nearest["name"],
                    service_type=nearest["service_type"],
                    distance_km=dist,
                    message=f"{nearest['name']} is {dist}km away — closest available"
                )
                message = (
                    f"No providers within {radius_km}km — "
                    f"here's your nearest option"
                )
            else:
                message = f"No {search_service} providers available right now"
        else:
            count = len(providers)
            message = (
                f"{count} provider{'s' if count != 1 else ''} near you — ready to help"
            )

        return AvailabilityResponse(
            providers=providers,
            count=len(providers),
            message=message,
            recommendation=recommendation,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Availability search failed: {str(e)}"
        )
    finally:
        conn.close()


# ============================================================================
# THE PULSE: Autonomous Background Matching
# ============================================================================

class PulseMatch(BaseModel):
    """Pre-computed match from The Pulse"""
    id: str
    driver_id: str
    batch_id: str
    match_score: float
    distance_km: float
    artery_score: Optional[float]
    trajectory_score: Optional[float]
    capacity_utilization: float
    estimated_acceptance_probability: float
    suggested_at: datetime
    expires_at: Optional[datetime]

class PulseMatchesResponse(BaseModel):
    """Response containing pulse matches"""
    matches: List[PulseMatch]
    count: int
    message: str

@app.on_event("startup")
async def startup_event():
    """Start The Pulse background worker on service startup"""
    global pulse_worker_task

    # Only start if DATABASE_URL is configured
    if not os.getenv("DATABASE_URL"):
        print("⚠️  DATABASE_URL not set - Pulse worker will not start")
        return

    try:
        from pulse_worker import init_pulse_worker
        import asyncio

        worker = init_pulse_worker(config, matching_engine)
        pulse_worker_task = asyncio.create_task(worker.start())
        print("🩸 The Pulse is alive - autonomous matching enabled")
    except Exception as e:
        print(f"⚠️  Could not start Pulse worker: {str(e)}")

@app.on_event("shutdown")
async def shutdown_event():
    """Stop The Pulse background worker on service shutdown"""
    global pulse_worker_task

    if pulse_worker_task:
        try:
            from pulse_worker import get_pulse_worker
            worker = get_pulse_worker()
            if worker:
                worker.stop()
            pulse_worker_task.cancel()
            print("🛑 The Pulse has stopped")
        except Exception as e:
            print(f"⚠️  Error stopping Pulse worker: {str(e)}")

@app.get("/pulse/matches", response_model=PulseMatchesResponse)
async def get_pulse_matches(
    driver_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    min_score: float = 0.0,
    limit: int = 10
):
    """
    Get pre-computed pulse matches (The Pulse - anticipatory matching)

    Returns matches that have been autonomously computed by the background worker.
    No need to wait for matching - results are instant!

    Query params:
    - driver_id: Filter by specific driver
    - batch_id: Filter by specific batch
    - min_score: Minimum match score (0.0 to 1.0)
    - limit: Maximum number of matches to return
    """
    try:
        conn = get_db_connection()
        if not conn:
            raise HTTPException(
                status_code=503,
                detail="Database connection unavailable"
            )

        with conn.cursor() as cur:
            # Build query based on filters
            query = """
                SELECT
                    id, driver_id, batch_id, match_score, distance_km,
                    artery_score, trajectory_score, capacity_utilization,
                    estimated_acceptance_probability, suggested_at, expires_at
                FROM pulse_matches
                WHERE is_active = true
                    AND expires_at > NOW()
                    AND match_score >= %s
            """
            params = [min_score]

            if driver_id:
                query += " AND driver_id = %s"
                params.append(driver_id)

            if batch_id:
                query += " AND batch_id = %s"
                params.append(batch_id)

            query += " ORDER BY match_score DESC LIMIT %s"
            params.append(limit)

            cur.execute(query, params)
            results = cur.fetchall()

            matches = [
                PulseMatch(
                    id=str(row['id']),
                    driver_id=str(row['driver_id']),
                    batch_id=str(row['batch_id']),
                    match_score=float(row['match_score']),
                    distance_km=float(row['distance_km']),
                    artery_score=float(row['artery_score']) if row['artery_score'] else None,
                    trajectory_score=float(row['trajectory_score']) if row['trajectory_score'] else None,
                    capacity_utilization=float(row['capacity_utilization']),
                    estimated_acceptance_probability=float(row['estimated_acceptance_probability']),
                    suggested_at=row['suggested_at'],
                    expires_at=row['expires_at']
                )
                for row in results
            ]

            conn.close()

            return PulseMatchesResponse(
                matches=matches,
                count=len(matches),
                message=f"Found {len(matches)} pulse matches - decisions made easy"
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch pulse matches: {str(e)}")

@app.get("/pulse/status")
async def get_pulse_status():
    """
    Get The Pulse worker status

    Returns information about the background matching worker
    """
    from pulse_worker import get_pulse_worker

    worker = get_pulse_worker()

    if not worker:
        return {
            "running": False,
            "message": "Pulse worker not initialized"
        }

    try:
        conn = get_db_connection()
        if conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) as total_matches,
                        COUNT(*) FILTER (WHERE is_active = true) as active_matches,
                        MAX(suggested_at) as last_match_time
                    FROM pulse_matches
                """)
                stats = cur.fetchone()
                conn.close()

                return {
                    "running": worker.running,
                    "scan_interval_seconds": worker.scan_interval_seconds,
                    "match_expiry_minutes": worker.match_expiry_minutes,
                    "total_matches": stats['total_matches'] if stats else 0,
                    "active_matches": stats['active_matches'] if stats else 0,
                    "last_match_time": stats['last_match_time'] if stats else None,
                    "message": "The Pulse is alive - anticipating matches continuously"
                }
        else:
            return {
                "running": worker.running,
                "message": "Database connection unavailable"
            }
    except Exception as e:
        return {
            "running": worker.running if worker else False,
            "error": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port)