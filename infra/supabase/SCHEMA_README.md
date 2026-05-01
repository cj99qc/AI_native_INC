# INC Logistics Platform - Database Schema Guide

## Files

### `master_schema.sql`
Complete database schema for the entire INC Logistics Platform. Includes all tables, indices, RLS policies, and functions.

**Use this for:**
- Fresh database setup
- Complete schema restoration
- Local PostgreSQL installations
- Development environments

## Quick Start

### Option 1: Supabase SQL Editor

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy/paste the entire contents of `master_schema.sql`
5. Click **Run**

**Note:** If you get auth-related errors, Supabase auth tables already exist. That's normal!

### Option 2: Local PostgreSQL

```bash
psql -h localhost -U postgres -d inc_logistics -f infra/supabase/master_schema.sql
```

### Option 3: Docker

```bash
docker exec -i postgres_container psql -U postgres -d inc_logistics < infra/supabase/master_schema.sql
```

## Schema Overview

### Core Tables

| Table | Purpose | Key Features |
|-------|---------|--------------|
| **profiles** | User profiles (extends auth.users) | Role-based access (customer, driver, vendor, admin) |
| **vendors** | Restaurants, stores | PostGIS location, ratings |
| **drivers** | Delivery drivers | PostGIS location, vehicle info, trajectory tracking |
| **driver_status** | Real-time driver status | Trajectory history for matching |
| **orders** | Customer orders | Full order lifecycle, geospatial locations |
| **batches** | Order groupings | For efficient multi-order delivery |
| **batch_items** | Orders within batches | Links orders to batches with sequence |
| **routes** | Optimized paths | PostGIS LINESTRING geometry |
| **route_stops** | Individual stops | Pickup/delivery points with timing |
| **escrow_payments** | Payment management | The Handshake - automated trust |
| **pulse_matches** | Pre-computed matches | The Pulse - autonomous matching |
| **highway_arteries** | Highway geometries | For trajectory scoring |
| **notifications** | Push notifications | Driver/customer alerts |

### The Pulse Tables

**`pulse_matches`** - Autonomous driver-order matching
- Pre-computed matches updated every 30 seconds
- Includes trajectory scores, artery proximity
- Auto-expiry system (15 minutes default)
- Enables instant match retrieval (< 10ms)

### The Handshake Tables

**`escrow_payments`** - Payment state management
- Hold/release funds automatically
- Track platform fees, driver payouts, vendor payouts
- Dispute handling
- Stripe integration

### Geospatial Features

All location fields use **PostGIS GEOGRAPHY types**:
- `drivers.current_location`
- `driver_status.location`
- `orders.pickup_location` / `delivery_location`
- `routes.route_geometry` (LINESTRING)
- `highway_arteries.route_geometry` (LINESTRING)

**Benefits:**
- Accurate distance calculations (Haversine)
- Spatial queries (ST_Distance, ST_DWithin)
- Trajectory matching along highways

## Indices

The schema includes **40+ indices** for performance:
- GIST indices on all GEOGRAPHY columns
- B-tree indices on foreign keys
- Partial indices on boolean flags (`WHERE is_active = true`)
- Descending indices on timestamps for recent-first queries

## Row Level Security (RLS)

All tables have RLS enabled with policies:
- **Users** see their own data
- **Drivers** see assigned batches and pulse matches
- **Vendors** see their orders
- **Service role** has full access (for background workers)

## Functions & Triggers

### Automatic Triggers
- `update_updated_at_column()` - Auto-update timestamps
- `update_batch_order_count()` - Keep batch counts in sync

### Utility Functions
- `cleanup_expired_pulse_matches()` - Remove stale matches

## Sample Data

The schema includes sample highway arteries:
- **Highway 7** - Ottawa region
- **Highway 417** - Queensway corridor

These enable trajectory matching for The Pulse.

## Verification

After applying the schema, verify:

```sql
-- Check table count (should be ~15+ tables)
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public';

-- Check PostGIS is enabled
SELECT PostGIS_version();

-- Check indices (should be 40+)
SELECT COUNT(*) FROM pg_indexes
WHERE schemaname = 'public';

-- Check highway arteries exist
SELECT name, description FROM highway_arteries;
```

## Migration Notes

### From Empty Database
Just run `master_schema.sql` - it creates everything.

### From Existing Schema
If you have existing tables:
1. Backup first: `pg_dump inc_logistics > backup.sql`
2. Drop existing tables or use `CREATE TABLE IF NOT EXISTS`
3. Run master_schema.sql

### Updating Existing
The schema uses `IF NOT EXISTS` so it's safe to re-run. New tables will be created, existing tables will be skipped.

## Troubleshooting

### "relation auth.users does not exist"

**Solution:** This is normal in Supabase. The auth schema is managed separately. RLS policies referencing `auth.uid()` will work correctly.

### "extension postgis already exists"

**Solution:** This is normal and safe. The schema uses `IF NOT EXISTS`.

### Permission denied

**Solution:** Make sure you're using a superuser or role with CREATE privileges:
```sql
GRANT ALL PRIVILEGES ON DATABASE inc_logistics TO your_user;
```

### Foreign key violations during data import

**Solution:** Disable triggers temporarily:
```sql
SET session_replication_role = replica;
-- Import data
SET session_replication_role = DEFAULT;
```

## Next Steps

After applying schema:

1. **Test The Pulse**
   ```bash
   cd services/matching_service
   DATABASE_URL=postgresql://... python -m uvicorn app:app --port 8003
   ```
   Look for: `🩸 The Pulse is alive`

2. **Insert test data** (see `TEST_PULSE.md`)

3. **Verify matches**
   ```bash
   curl http://localhost:8003/pulse/matches
   ```

## Schema Maintenance

### Weekly
```sql
-- Cleanup old pulse matches
SELECT cleanup_expired_pulse_matches();

-- Vacuum analyze for performance
VACUUM ANALYZE;
```

### Monthly
```sql
-- Reindex for query performance
REINDEX DATABASE inc_logistics;
```

## Architecture Alignment

This schema implements **The Artery Project** principles:

✅ **The Pulse** - `pulse_matches` for autonomous matching
✅ **The Handshake** - `escrow_payments` for automated trust
✅ **Geospatial First** - PostGIS GEOGRAPHY on all locations
✅ **Seamless Decoupling** - Clean table boundaries
✅ **Decision Made Easy** - Pre-computed data ready for instant retrieval

---

**The economic artery is ready to flow.** 🩸⚡
