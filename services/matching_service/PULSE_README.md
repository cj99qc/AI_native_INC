# The Pulse: Autonomous Driver-Order Matching

## Overview

**The Pulse** is a background worker that embodies The Artery Project's core principle: **We do not wait for user input; we anticipate.**

Instead of waiting for API requests to match drivers to orders, The Pulse continuously scans for active drivers ("Pulses on the highway") and pending orders, pre-computing optimal matches and storing them for instant retrieval.

## How It Works

### 1. Continuous Scanning

The Pulse runs every `scan_interval_seconds` (default: 30 seconds) and:

1. **Fetches active drivers** - Queries the database for drivers with status `available` or `en_route`
2. **Fetches pending batches** - Queries for batches with status `pending` that need drivers
3. **Computes matches** - Uses the full matching engine (trajectory, artery proximity, capacity, rating, etc.)
4. **Stores results** - Saves pre-computed matches to the `pulse_matches` table
5. **Cleans up** - Removes expired matches

### 2. Match Scoring

Each match includes:
- **Match score** (0.0 to 1.0) - Composite score from all factors
- **Distance** - Haversine distance from driver to batch center
- **Artery score** - Highway 7 proximity bonus
- **Trajectory score** - Is driver moving toward the pickup?
- **Capacity utilization** - How well does this batch fit the driver's capacity?
- **Acceptance probability** - Predicted likelihood driver accepts

### 3. Instant Retrieval

Instead of waiting 100-500ms for matching computation, results are retrieved instantly:

```bash
GET /pulse/matches?driver_id=<uuid>&min_score=0.5
```

Returns pre-computed matches in < 10ms.

## Configuration

Edit `config/defaults.json`:

```json
{
  "pulse": {
    "scan_interval_seconds": 30,      // How often to scan for matches
    "match_expiry_minutes": 15,       // When matches become stale
    "max_distance_km": 50.0,          // Maximum driver-to-batch distance
    "min_match_score": 0.3            // Minimum score to store a match
  }
}
```

## API Endpoints

### Get Pulse Matches

```http
GET /pulse/matches
```

**Query Parameters:**
- `driver_id` (optional) - Filter by specific driver
- `batch_id` (optional) - Filter by specific batch
- `min_score` (optional, default: 0.0) - Minimum match score
- `limit` (optional, default: 10) - Max number of results

**Response:**
```json
{
  "matches": [
    {
      "id": "uuid",
      "driver_id": "uuid",
      "batch_id": "uuid",
      "match_score": 0.85,
      "distance_km": 4.2,
      "artery_score": 0.9,
      "trajectory_score": 0.8,
      "capacity_utilization": 0.75,
      "estimated_acceptance_probability": 0.88,
      "suggested_at": "2025-01-15T10:30:00Z",
      "expires_at": "2025-01-15T10:45:00Z"
    }
  ],
  "count": 1,
  "message": "Found 1 pulse matches - decisions made easy"
}
```

### Get Pulse Status

```http
GET /pulse/status
```

**Response:**
```json
{
  "running": true,
  "scan_interval_seconds": 30,
  "match_expiry_minutes": 15,
  "total_matches": 142,
  "active_matches": 37,
  "last_match_time": "2025-01-15T10:30:15Z",
  "message": "The Pulse is alive - anticipating matches continuously"
}
```

## Database Schema

The `pulse_matches` table stores pre-computed matches:

```sql
CREATE TABLE pulse_matches (
    id UUID PRIMARY KEY,
    driver_id UUID REFERENCES drivers(id),
    batch_id UUID REFERENCES batches(id),
    match_score DECIMAL(5, 4),
    distance_km DECIMAL(10, 2),
    artery_score DECIMAL(5, 4),
    trajectory_score DECIMAL(5, 4),
    capacity_utilization DECIMAL(5, 4),
    estimated_acceptance_probability DECIMAL(5, 4),
    match_details JSONB,
    is_active BOOLEAN DEFAULT true,
    suggested_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    notified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ
);
```

## InC Psychology: UI Integration

When building UI, follow "Decision Made Easy" principles:

**✓ Good:**
```
"We found your best match: Sarah (4.9★) - 3.2km away, 92% acceptance chance"
[Accept Match] [See Alternatives]
```

**✗ Avoid:**
```
"Please select a driver from the list below (showing 1-50 of 127)"
```

## Deployment

### Local Development

The Pulse starts automatically when you run the matching service:

```bash
cd services/matching_service
DATABASE_URL=postgresql://... python -m uvicorn app:app --port 8003
```

Look for the startup message:
```
🩸 The Pulse is alive - autonomous matching enabled
```

### Docker

The Pulse runs automatically in the Docker Compose stack:

```bash
docker-compose up matching_service
```

### Production

Set environment variables:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
PORT=8003
```

The Pulse will start automatically on service startup.

## Monitoring

### Check Pulse Status

```bash
curl http://localhost:8003/pulse/status
```

### View Recent Matches

```bash
curl "http://localhost:8003/pulse/matches?limit=5"
```

### Logs

Look for Pulse heartbeat logs:
```
💓 Pulse cycle complete - 23 matches ready
⚡ Found 8 active drivers (Pulses)
📦 Found 12 pending batches
🎯 Computed 23 pulse matches
💾 Stored 23 pulse matches (expires at 2025-01-15T10:45:00Z)
```

## The Artery Principles

The Pulse embodies:

1. **Anticipate, don't wait** - Matches are pre-computed before anyone asks
2. **The Pulse** - Keeps logistics flowing through continuous matching
3. **Seamless decoupling** - Background worker, not blocking requests
4. **Geospatial first** - Uses PostGIS for artery proximity and trajectory
5. **Decision Made Easy** - Presents best match, not overwhelming lists

Every Pulse cycle strengthens The Artery. 🩸⚡
