# Development Testing Checklist

## Prerequisites Status

### ✅ Completed
- [x] Master schema created
- [x] Pulse worker code ready
- [x] Matching service endpoints ready

### 🔄 To Complete

- [ ] Set Supabase DATABASE_URL
- [ ] Start matching service (The Pulse)
- [ ] Insert test data
- [ ] Verify pulse matches
- [ ] Test all endpoints

## Step-by-Step Testing

### 1. Set Database URL

You need your Supabase database connection string. Get it from:

**Supabase Dashboard → Settings → Database → Connection String**

Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`

Then set it:

**Windows PowerShell:**
```powershell
$env:DATABASE_URL="your-connection-string-here"
```

**Windows CMD:**
```cmd
set DATABASE_URL=your-connection-string-here
```

**Git Bash:**
```bash
export DATABASE_URL="your-connection-string-here"
```

### 2. Verify Database Connection

```bash
cd services/matching_service
python -c "import psycopg2; import os; conn = psycopg2.connect(os.getenv('DATABASE_URL')); print('✅ Database connected!'); conn.close()"
```

**Expected:** `✅ Database connected!`

### 3. Start Matching Service

```bash
cd services/matching_service
python -m uvicorn app:app --host 0.0.0.0 --port 8003 --reload
```

**Look for these startup messages:**
```
🩸 The Pulse is alive - autonomous matching enabled
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8003
```

### 4. Test Health Endpoint

Open a **new terminal**:

```bash
curl http://localhost:8003/health
```

**Expected:**
```json
{"ok": true}
```

### 5. Test Pulse Status

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

### 6. Insert Test Data

Use Supabase SQL Editor or psql:

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
INSERT INTO batches (id, batch_number, status, total_orders, estimated_duration_minutes, estimated_distance_km)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BATCH-001', 'pending', 3, 45, 12.5),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BATCH-002', 'pending', 2, 30, 8.0);

-- Insert batch items (order locations)
INSERT INTO batch_items (batch_id, order_id, sequence_number, pickup_latitude, pickup_longitude, pickup_location, delivery_latitude, delivery_longitude, delivery_location)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 1, 45.43, -75.69, ST_SetSRID(ST_MakePoint(-75.69, 45.43), 4326), 45.44, -75.67, ST_SetSRID(ST_MakePoint(-75.67, 45.44), 4326)),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-2', 2, 45.43, -75.68, ST_SetSRID(ST_MakePoint(-75.68, 45.43), 4326), 45.45, -75.66, ST_SetSRID(ST_MakePoint(-75.66, 45.45), 4326)),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-3', 3, 45.42, -75.70, ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326), 45.41, -75.71, ST_SetSRID(ST_MakePoint(-75.71, 45.41), 4326)),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'order-4', 1, 45.41, -75.71, ST_SetSRID(ST_MakePoint(-75.71, 45.41), 4326), 45.42, -75.70, ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326)),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'order-5', 2, 45.40, -75.72, ST_SetSRID(ST_MakePoint(-75.72, 45.40), 4326), 45.39, -75.73, ST_SetSRID(ST_MakePoint(-75.73, 45.39), 4326));
```

### 7. Wait for Pulse Cycle

**Watch the matching service logs** for about 30-40 seconds. You should see:

```
⚡ Found 3 active drivers (Pulses)
📦 Found 2 pending batches
🎯 Computed X pulse matches
💾 Stored X pulse matches (expires at ...)
💓 Pulse cycle complete - X matches ready
```

### 8. Retrieve Pulse Matches

```bash
curl "http://localhost:8003/pulse/matches?limit=10"
```

**Expected:**
```json
{
  "matches": [
    {
      "id": "...",
      "driver_id": "11111111-1111-1111-1111-111111111111",
      "batch_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "match_score": 0.7534,
      "distance_km": 2.3,
      "artery_score": 0.5,
      "trajectory_score": 0.5,
      "capacity_utilization": 0.75,
      "estimated_acceptance_probability": 0.85,
      "suggested_at": "2026-02-18T...",
      "expires_at": "2026-02-18T..."
    }
  ],
  "count": 6,
  "message": "Found 6 pulse matches - decisions made easy"
}
```

### 9. Test Driver-Specific Matches

```bash
curl "http://localhost:8003/pulse/matches?driver_id=11111111-1111-1111-1111-111111111111"
```

**Expected:** Matches for that specific driver

### 10. Test Batch-Specific Matches

```bash
curl "http://localhost:8003/pulse/matches?batch_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
```

**Expected:** All drivers matched to that batch

### 11. Test Config Endpoint

```bash
curl http://localhost:8003/config
```

**Expected:** Full config including pulse settings

### 12. Test Manual Assignment (Traditional)

```bash
curl -X POST http://localhost:8003/assign \
  -H "Content-Type: application/json" \
  -d '{
    "batch": {
      "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "center_lat": 45.43,
      "center_lng": -75.69,
      "total_orders": 3,
      "estimated_duration_minutes": 45,
      "priority": 1
    },
    "available_drivers": [
      {
        "id": "11111111-1111-1111-1111-111111111111",
        "lat": 45.42,
        "lng": -75.70,
        "rating": 4.8,
        "vehicle_capacity": 4,
        "is_active": true,
        "current_orders": 0,
        "max_concurrent_orders": 8
      }
    ],
    "max_distance_km": 50.0
  }'
```

**Expected:** Matching response with scored drivers

### 13. Verify Database Records

In Supabase SQL Editor:

```sql
-- Check pulse matches
SELECT
  driver_id,
  batch_id,
  match_score,
  distance_km,
  artery_score,
  trajectory_score,
  is_active
FROM pulse_matches
WHERE is_active = true
ORDER BY match_score DESC;

-- Check drivers
SELECT id, license_number, latitude, longitude, is_active
FROM drivers;

-- Check batches
SELECT id, batch_number, status, total_orders
FROM batches;
```

## Success Criteria

✅ Matching service starts with "The Pulse is alive"
✅ `/health` returns `{"ok": true}`
✅ `/pulse/status` shows `"running": true`
✅ Pulse logs appear every 30 seconds
✅ `/pulse/matches` returns pre-computed matches
✅ Database has records in `pulse_matches` table
✅ No errors in logs

## Common Issues

### Issue: "DATABASE_URL not set"
**Solution:** Set the environment variable in your terminal

### Issue: "No matches generated"
**Solution:**
- Verify test data was inserted
- Check drivers have `is_active = true`
- Check driver_status has 'available' or 'en_route'
- Check batches have `status = 'pending'`

### Issue: "Import error: pulse_worker"
**Solution:** Make sure you're in `services/matching_service` directory

### Issue: "Database connection failed"
**Solution:** Verify your Supabase connection string is correct

## Performance Benchmarks

Expected response times:
- `GET /health` - < 5ms
- `GET /pulse/status` - < 50ms
- `GET /pulse/matches` - < 10ms (instant retrieval!)
- `POST /assign` - 100-500ms (traditional matching)

**The Pulse makes matching 10-50x faster!** 🩸⚡

## Next Steps After Testing

1. ✅ Commit all changes
2. 📖 Create function documentation
3. 🚀 Deploy to production
4. 🔔 Add push notifications for pulse matches
5. 📊 Add monitoring dashboard

---

**Ready to test?** Start with Step 1! 🩸
