# Trajectory-Based Driver Matching

## Overview

The matching service has been refactored to implement **trajectory matching** for driver assignment. Instead of simple radius-based searching using ST_Distance, the system now considers:

1. **Highway 7 Artery Proximity** - Using PostGIS ST_LineLocatePoint
2. **Driver Trajectory** - Movement direction from last two driver_status points
3. **Off-Highway Deviation Limits** - Batches limited to 5km from Highway 7

## Architecture Changes

### Database Schema

Added `highway_arteries` table to track main transportation corridors:

```sql
CREATE TABLE highway_arteries (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    route_geometry GEOGRAPHY(LINESTRING, 4326) NOT NULL,
    description TEXT
);
```

The Highway 7 corridor is represented as a LINESTRING geometry covering the Ottawa region.

### Driver Model Updates

The `Driver` model now includes trajectory data:

```python
class Driver(BaseModel):
    id: str
    lat: float
    lng: float
    # ... other fields
    previous_location: Optional[DriverStatus] = None  # For trajectory calculation
```

### Scoring Algorithm

The composite driver score now uses 7 weighted factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Distance | 20% | Proximity to pickup (reduced from 35%) |
| Capacity | 20% | Available vehicle capacity (reduced from 25%) |
| Rating | 10% | Driver rating (reduced from 15%) |
| Availability | 10% | Current workload (reduced from 15%) |
| Incentive | 5% | Batch priority factors (reduced from 10%) |
| **Artery** | **20%** | **NEW: Proximity to Highway 7** |
| **Trajectory** | **15%** | **NEW: Movement toward pickup** |

## Key Features

### 1. Artery Proximity Scoring

Uses PostGIS `ST_LineLocatePoint` to calculate where the driver and pickup are positioned relative to Highway 7:

```python
def calculate_artery_proximity_score(driver_lat, driver_lng, pickup_lat, pickup_lng):
    # Get fractional position along Highway 7 (0.0 to 1.0)
    driver_fraction = ST_LineLocatePoint(highway_7_line, driver_point)
    pickup_fraction = ST_LineLocatePoint(highway_7_line, pickup_point)
    
    # Score based on proximity along the artery
    distance_along_artery = abs(driver_fraction - pickup_fraction)
    
    # Closer positions = higher score
    if distance_along_artery < 0.2:
        return 1.0  # Very close
    elif distance_along_artery < 0.4:
        return 0.8  # Close
    elif distance_along_artery < 0.6:
        return 0.5  # Medium
    else:
        return 0.3  # Far
```

### 2. Trajectory Matching

Calculates driver movement direction from the last two `driver_status` records:

```python
def calculate_trajectory_score(driver, pickup_lat, pickup_lng):
    # Movement vector (from previous to current location)
    movement_lat = driver.lat - driver.previous_location.lat
    movement_lng = driver.lng - driver.previous_location.lng
    
    # Vector to pickup
    to_pickup_lat = pickup_lat - driver.lat
    to_pickup_lng = pickup_lng - driver.lng
    
    # Cosine similarity: moving toward = 1.0, away = 0.0
    cosine_sim = dot_product / (magnitude1 * magnitude2)
    trajectory_score = (cosine_sim + 1.0) / 2.0
    
    return trajectory_score
```

**Interpretation:**
- Score = 1.0: Driver heading directly toward pickup
- Score = 0.5: Driver moving perpendicular to pickup
- Score = 0.0: Driver moving away from pickup

### 3. Highway Deviation Filtering (Pulse)

The batching engine filters orders to create "Pulses" - order groups near Highway 7:

```python
def create_batches(orders, max_highway_deviation_km=5.0):
    # Filter orders within 5km of Highway 7
    highway_filtered_orders = filter_orders_by_highway_deviation(
        orders, max_highway_deviation_km
    )
    
    # Apply K-means clustering on filtered orders
    clusters = kmeans_clustering(highway_filtered_orders, n_clusters)
    
    # Validate clusters don't deviate too far
    valid_clusters = [
        cluster for cluster in clusters
        if validate_cluster_highway_deviation(cluster, max_highway_deviation_km)
    ]
    
    return create_batch_objects(valid_clusters)
```

## Usage Examples

### Basic Driver Matching

```python
from matching_service.app import MatchingEngine, Driver, DriverStatus, BatchData

engine = MatchingEngine(config)

# Driver with trajectory data
driver = Driver(
    id="driver_001",
    lat=45.36,
    lng=-75.72,
    rating=4.8,
    vehicle_capacity=6,
    is_active=True,
    current_orders=1,
    max_concurrent_orders=8,
    previous_location=DriverStatus(
        lat=45.35,  # Previous position
        lng=-75.73,
        timestamp=datetime.now() - timedelta(minutes=5)
    )
)

batch = BatchData(
    id="batch_001",
    center_lat=45.38,
    center_lng=-75.70,
    total_orders=3,
    estimated_duration_minutes=45,
    priority=5
)

# Find best drivers
candidates = engine.find_best_drivers(batch, [driver], max_distance=50.0)
best = candidates[0]

print(f"Score: {best.score}")
print(f"Trajectory: {best.trajectory_score}")
print(f"Artery: {best.artery_score}")
```

### Creating Highway-Constrained Batches

```python
from routing_service.batching import BatchingEngine, Order

engine = BatchingEngine(config)

# Create batches with 5km highway deviation limit
batches = engine.create_batches(
    orders,
    max_highway_deviation_km=5.0  # Pulse constraint
)
```

## Testing

### Unit Tests

- **Matching Service**: 14 tests covering trajectory and artery scoring
  ```bash
  pytest services/matching_service/tests/test_matching.py -v
  ```

- **Batching Service**: 16 tests covering highway deviation filtering
  ```bash
  pytest services/routing_service/tests/test_batching_highway.py -v
  ```

### Integration Test

Run the complete trajectory matching workflow:
```bash
python test_trajectory_integration.py
```

Expected output:
```
✓ Best match: driver_moving_toward
  - Overall score: 0.855
  - Trajectory score: 0.998
  - Artery proximity score: 0.500
✓ Trajectory correctly prioritized driver moving toward pickup
```

## Performance Considerations

### PostGIS Queries

The artery proximity calculation uses PostGIS functions:

```sql
SELECT ST_LineLocatePoint(
    route_geometry::geometry,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)
) as fraction
FROM highway_arteries
WHERE name = 'Highway 7'
```

**Index Required:**
```sql
CREATE INDEX idx_highway_arteries_geometry 
ON highway_arteries USING GIST (route_geometry);
```

### Fallback Behavior

If PostGIS is unavailable:
- Artery scoring returns neutral 0.5 score
- Batching continues without highway filtering
- System gracefully degrades to distance-based matching

## Configuration

Add to `config/defaults.json`:

```json
{
  "matching": {
    "max_distance_km": 50.0,
    "highway_deviation_km": 5.0,
    "weights": {
      "distance": 0.20,
      "capacity": 0.20,
      "rating": 0.10,
      "availability": 0.10,
      "incentive": 0.05,
      "artery": 0.20,
      "trajectory": 0.15
    }
  }
}
```

## Database Setup

Run the migration to add Highway 7 artery:

```bash
psql -h localhost -U postgres -d inc_logistics \
  -f infra/supabase/new_tables.sql
```

The migration includes:
- `highway_arteries` table creation
- Highway 7 LINESTRING geometry (Ottawa region)
- Spatial index on route_geometry
- RLS policies for public read access

## API Response Changes

The `/assign` endpoint now returns additional trajectory data:

```json
{
  "recommended_driver": {
    "driver_id": "driver_001",
    "score": 0.855,
    "distance_km": 3.64,
    "artery_score": 0.500,      // NEW
    "trajectory_score": 0.998,  // NEW
    "capacity_utilization": 0.75,
    "rating": 4.8,
    "availability_factor": 0.875
  }
}
```

## Migration Notes

### Backward Compatibility

- Existing API endpoints remain unchanged
- `previous_location` field is optional
- Without PostGIS, system uses fallback scoring
- Batching works with or without highway deviation parameter

### Data Requirements

For full functionality:
1. **driver_status table** must track location history
2. **PostgreSQL with PostGIS** extension enabled
3. **Highway 7 geometry** inserted into database

### Monitoring

Key metrics to track:
- Percentage of drivers with trajectory data
- Average artery proximity scores
- Batch acceptance rates by trajectory score
- Highway deviation statistics

## References

- PostGIS ST_LineLocatePoint: https://postgis.net/docs/ST_LineLocatePoint.html
- Original issue: Refactor driver matching logic to use trajectory matching
- Tests: `services/matching_service/tests/test_matching.py`
- Integration: `test_trajectory_integration.py`
