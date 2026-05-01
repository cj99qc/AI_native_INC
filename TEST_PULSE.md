# Testing The Pulse - Step by Step

## Prerequisites

1. PostgreSQL running with PostGIS extension
2. Database `inc_logistics` exists
3. Base tables from `infra/supabase/new_tables.sql` are created

## Step 1: Apply Pulse Database Migration

```bash
# Navigate to project root
cd D:\Delivery_app\main\AI_native_INC

# Apply the pulse_matches table migration
psql -h localhost -U postgres -d inc_logistics -f infra/supabase/pulse_matches.sql
```

**Expected output:**
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
...
ALTER TABLE
CREATE POLICY
CREATE FUNCTION
```

## Step 2: Verify Database Setup

```bash
# Check if pulse_matches table exists
psql -h localhost -U postgres -d inc_logistics -c "\d pulse_matches"
```

**Expected output:** Table structure with columns like id, driver_id, batch_id, match_score, etc.

## Step 3: Set Environment Variables

```bash
# Set database URL (adjust credentials as needed)
export DATABASE_URL=postgresql://inc_user:inc_password@localhost:5432/inc_logistics

# Or on Windows:
set DATABASE_URL=postgresql://inc_user:inc_password@localhost:5432/inc_logistics
```

## Step 4: Start the Matching Service

```bash
cd services/matching_service

# Install dependencies (if not already done)
pip install -r requirements.txt

# Start the service
python -m uvicorn app:app --host 0.0.0.0 --port 8003 --reload
```

**Look for this startup message:**
```
🩸 The Pulse is alive - autonomous matching enabled
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

## Step 5: Check Health

Open a new terminal:

```bash
curl http://localhost:8003/health
```

**Expected:**
```json
{"ok": true}
```

## Step 6: Check Pulse Status

```bash
curl http://localhost:8003/pulse/status
```

**Expected:**
```json
{
  "running": true,
  "scan_interval_seconds": 30,
  "match_expiry_minutes": 15,
  "total_matches": 0,
  "active_matches": 0,
  "last_match_time": null,
  "message": "The Pulse is alive - anticipating matches continuously"
}
```

## Step 7: Insert Test Data

Let's create some test drivers and batches:

```bash
psql -h localhost -U postgres -d inc_logistics
```

```sql
-- Insert test drivers
INSERT INTO drivers (id, license_number, vehicle_type, vehicle_capacity, rating, is_active, latitude, longitude, current_location)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'TEST-001', 'car', 4, 4.8, true, 45.42, -75.70, ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326)),
  ('22222222-2222-2222-2222-222222222222', 'TEST-002', 'van', 8, 4.9, true, 45.41, -75.68, ST_SetSRID(ST_MakePoint(-75.68, 45.41), 4326)),
  ('33333333-3333-3333-3333-333333333333', 'TEST-003', 'truck', 12, 5.0, true, 45.40, -75.72, ST_SetSRID(ST_MakePoint(-75.72, 45.40), 4326));

-- Insert driver status (available)
INSERT INTO driver_status (driver_id, status, latitude, longitude, location)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'available', 45.42, -75.70, ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326)),
  ('22222222-2222-2222-2222-222222222222', 'available', 45.41, -75.68, ST_SetSRID(ST_MakePoint(-75.68, 45.41), 4326)),
  ('33333333-3333-3333-3333-333333333333', 'en_route', 45.40, -75.72, ST_SetSRID(ST_MakePoint(-75.72, 45.40), 4326));

-- Insert test batches
INSERT INTO batches (id, status, total_orders, estimated_duration_minutes, estimated_distance_km)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending', 3, 45, 12.5),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'pending', 2, 30, 8.0);

-- Insert batch items (orders)
INSERT INTO batch_items (batch_id, order_id, sequence_number, pickup_latitude, pickup_longitude, pickup_location, delivery_latitude, delivery_longitude, delivery_location)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 1, 45.43, -75.69, ST_SetSRID(ST_MakePoint(-75.69, 45.43), 4326), 45.44, -75.67, ST_SetSRID(ST_MakePoint(-75.67, 45.44), 4326)),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-2', 2, 45.43, -75.68, ST_SetSRID(ST_MakePoint(-75.68, 45.43), 4326), 45.45, -75.66, ST_SetSRID(ST_MakePoint(-75.66, 45.45), 4326)),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'order-3', 1, 45.41, -75.71, ST_SetSRID(ST_MakePoint(-75.71, 45.41), 4326), 45.42, -75.70, ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326));
```

Exit psql: `\q`

## Step 8: Wait for Pulse Cycle

The Pulse scans every 30 seconds. Wait about 30-40 seconds and watch the matching service logs.

**Look for these logs:**
```
⚡ Found 3 active drivers (Pulses)
📦 Found 2 pending batches
🎯 Computed X pulse matches
💾 Stored X pulse matches (expires at ...)
💓 Pulse cycle complete - X matches ready
```

## Step 9: Check Pulse Matches

```bash
curl "http://localhost:8003/pulse/matches?limit=10"
```

**Expected:**
```json
{
  "matches": [
    {
      "id": "some-uuid",
      "driver_id": "11111111-1111-1111-1111-111111111111",
      "batch_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "match_score": 0.75,
      "distance_km": 2.3,
      "artery_score": 0.5,
      "trajectory_score": 0.5,
      "capacity_utilization": 0.75,
      "estimated_acceptance_probability": 0.85,
      "suggested_at": "2026-02-18T...",
      "expires_at": "2026-02-18T..."
    }
  ],
  "count": 1,
  "message": "Found X pulse matches - decisions made easy"
}
```

## Step 10: Query Specific Driver Matches

```bash
curl "http://localhost:8003/pulse/matches?driver_id=11111111-1111-1111-1111-111111111111"
```

**Expected:** Matches for that specific driver

## Step 11: Check Database

```bash
psql -h localhost -U postgres -d inc_logistics -c "SELECT driver_id, batch_id, match_score, distance_km FROM pulse_matches WHERE is_active = true;"
```

**Expected:** Table showing stored matches

## Step 12: Check Pulse Status Again

```bash
curl http://localhost:8003/pulse/status
```

**Expected:**
```json
{
  "running": true,
  "scan_interval_seconds": 30,
  "match_expiry_minutes": 15,
  "total_matches": 6,
  "active_matches": 6,
  "last_match_time": "2026-02-18T...",
  "message": "The Pulse is alive - anticipating matches continuously"
}
```

## Troubleshooting

### Pulse didn't start

**Check logs for:**
```
⚠️  DATABASE_URL not set - Pulse worker will not start
```

**Solution:** Set DATABASE_URL environment variable

### No matches generated

**Possible reasons:**
1. No active drivers with status 'available' or 'en_route'
2. No pending batches
3. Drivers too far from batches (> 50km by default)
4. Match scores below minimum threshold (0.3 by default)

**Check:**
```bash
# Check drivers
psql -h localhost -U postgres -d inc_logistics -c "SELECT id, is_active, latitude, longitude FROM drivers WHERE is_active = true;"

# Check driver status
psql -h localhost -U postgres -d inc_logistics -c "SELECT driver_id, status FROM driver_status;"

# Check batches
psql -h localhost -U postgres -d inc_logistics -c "SELECT id, status, total_orders FROM batches WHERE status = 'pending';"
```

### Import errors

**If you see:**
```
ModuleNotFoundError: No module named 'pulse_worker'
```

**Solution:** Make sure you're running from the `services/matching_service` directory

### Database connection errors

**Check:**
1. PostgreSQL is running: `pg_isready`
2. Database exists: `psql -l | grep inc_logistics`
3. PostGIS extension enabled: `psql -d inc_logistics -c "SELECT PostGIS_version();"`

## Success Criteria

✅ Matching service starts with "The Pulse is alive" message
✅ `/pulse/status` returns `"running": true`
✅ Pulse cycle logs appear every 30 seconds
✅ `/pulse/matches` returns pre-computed matches
✅ Database has records in `pulse_matches` table
✅ No errors in service logs

## Clean Up Test Data

```bash
psql -h localhost -U postgres -d inc_logistics
```

```sql
-- Clean up test data
DELETE FROM pulse_matches WHERE driver_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

DELETE FROM batch_items WHERE batch_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

DELETE FROM batches WHERE id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

DELETE FROM driver_status WHERE driver_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

DELETE FROM drivers WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);
```

Exit: `\q`

---

**Report back with results!** 🩸⚡
