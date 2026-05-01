# INC Logistics Platform - Schema Diagram

## Entity Relationship Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         THE ARTERY PROJECT                               │
│                    Database Schema Architecture                          │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│   auth.users     │ (Supabase managed)
│   (Supabase)     │
└────────┬─────────┘
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
┌─────────────────┐                   ┌─────────────────┐
│    profiles     │                   │     vendors     │
├─────────────────┤                   ├─────────────────┤
│ • id (FK)       │                   │ • id            │
│ • email         │                   │ • user_id (FK)  │
│ • full_name     │                   │ • business_name │
│ • role          │                   │ • location 🌍   │
│ • phone         │                   │ • rating        │
└─────────────────┘                   └────────┬────────┘
         │                                      │
         │ (role: driver)                       │
         ▼                                      │
┌─────────────────┐                            │
│     drivers     │                            │
├─────────────────┤                            │
│ • id            │                            │
│ • user_id (FK)  │                            │
│ • current_loc 🌍│◄───────────┐              │
│ • vehicle_type  │             │              │
│ • rating        │             │              │
│ • is_active     │             │              │
└────────┬────────┘             │              │
         │                       │              │
         │                       │              │
         ▼                       │              │
┌─────────────────┐             │              │
│ driver_status   │             │              │
├─────────────────┤             │              │
│ • driver_id (FK)│             │              │
│ • status        │────────┐    │              │
│ • location 🌍   │         │    │              │
│ • speed_kmh     │         │    │              │
│ • heading       │         │    │              │
└─────────────────┘         │    │              │
                            │    │              │
        ┌───────────────────┘    │              │
        │ (trajectory data)      │              │
        │                        │              │
        ▼                        │              ▼
┌─────────────────────────────────────────────────────┐
│                      orders                         │
├─────────────────────────────────────────────────────┤
│ • id                                                │
│ • customer_id (FK) ───┐                            │
│ • vendor_id (FK) ──────┼────────────────────────────┘
│ • assigned_driver_id (FK) ◄───┘
│ • batch_id (FK)
│ • status
│ • pickup_location 🌍
│ • delivery_location 🌍
│ • items (JSONB)
│ • total_cents
└──────────┬──────────────────────────────────────────┘
           │
           │
           ▼
┌─────────────────────────────────────────────────────┐
│                     batches                         │
├─────────────────────────────────────────────────────┤
│ • id                                                │
│ • driver_id (FK) ───────────────────┐              │
│ • status                             │              │
│ • total_orders                       │              │
│ • estimated_distance_km              │              │
└──────────┬───────────────────────────┼──────────────┘
           │                           │
           │                           │
    ┌──────┴──────────┐               │
    │                 │               │
    ▼                 ▼               │
┌──────────┐    ┌──────────┐         │
│batch_    │    │ routes   │         │
│items     │    ├──────────┤         │
├──────────┤    │• batch_id│         │
│•batch_id │    │• driver  │         │
│•order_id │    │• geometry│🌍       │
│•sequence │    │• distance│         │
│•pickup 🌍│    └────┬─────┘         │
│•delivery│🌍       │                │
└──────────┘         │                │
                     ▼                │
              ┌──────────┐            │
              │route_    │            │
              │stops     │            │
              ├──────────┤            │
              │•route_id │            │
              │•stop_type│            │
              │•location │🌍          │
              │•sequence │            │
              └──────────┘            │
                                      │
┌─────────────────────────────────────┼──────────────────────┐
│              THE PULSE              │                       │
│        Autonomous Matching          │                       │
└─────────────────────────────────────┴──────────────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │    pulse_matches        │
                        ├──────────────────────────┤
                        │ • id                     │
                        │ • driver_id (FK) ────────┤
                        │ • batch_id (FK)          │
                        │ • match_score            │
                        │ • trajectory_score       │
                        │ • artery_score           │
                        │ • distance_km            │
                        │ • expires_at             │
                        │ • is_active              │
                        └──────────────────────────┘
                                      ▲
                                      │
                        (Background worker updates
                         every 30 seconds)


┌───────────────────────────────────────────────────────────┐
│             THE HANDSHAKE                                  │
│        Automated Payment Trust                             │
└───────────────────────────────────────────────────────────┘

              ┌──────────────────────────┐
              │   escrow_payments        │
              ├──────────────────────────┤
              │ • id                     │
              │ • order_id (FK)          │
              │ • batch_id (FK)          │
              │ • customer_id (FK)       │
              │ • vendor_id (FK)         │
              │ • driver_id (FK)         │
              │ • amount_total_cents     │
              │ • amount_platform_fee    │
              │ • amount_driver_payout   │
              │ • status                 │
              │   (pending, held,        │
              │    released, disputed)   │
              └──────────────────────────┘


┌───────────────────────────────────────────────────────────┐
│          GEOSPATIAL INFRASTRUCTURE                         │
└───────────────────────────────────────────────────────────┘

              ┌──────────────────────────┐
              │   highway_arteries       │
              ├──────────────────────────┤
              │ • id                     │
              │ • name (e.g., Hwy 7)     │
              │ • route_geometry 🌍      │
              │   (LINESTRING)           │
              │ • description            │
              │ • region                 │
              └──────────────────────────┘
                        ▲
                        │
              (Used for trajectory scoring
               in pulse_matches)


┌───────────────────────────────────────────────────────────┐
│              NOTIFICATIONS & ALERTS                        │
└───────────────────────────────────────────────────────────┘

              ┌──────────────────────────┐
              │    notifications         │
              ├──────────────────────────┤
              │ • id                     │
              │ • user_id (FK)           │
              │ • title                  │
              │ • body                   │
              │ • notification_type      │
              │ • pulse_match_id (FK)    │
              │ • order_id (FK)          │
              │ • is_read                │
              └──────────────────────────┘


┌───────────────────────────────────────────────────────────┐
│               RAG & KNOWLEDGE BASE                         │
└───────────────────────────────────────────────────────────┘

              ┌──────────────────────────┐
              │   embedding_index        │
              ├──────────────────────────┤
              │ • id                     │
              │ • content_type           │
              │ • content_text           │
              │ • embedding (vector)     │
              │ • metadata (JSONB)       │
              └──────────────────────────┘
```

## Key Relationships

### 1. User → Driver Flow
```
auth.users
    └─> profiles (role: 'driver')
         └─> drivers
              ├─> driver_status (real-time tracking)
              ├─> batches (assigned deliveries)
              └─> pulse_matches (suggested opportunities)
```

### 2. Order → Delivery Flow
```
orders (status: pending)
    └─> batches (grouped for efficiency)
         ├─> batch_items (order details)
         ├─> routes (optimized path)
         │    └─> route_stops (pickup/delivery points)
         ├─> pulse_matches (matched to drivers)
         └─> escrow_payments (payment held)
```

### 3. The Pulse Flow (Autonomous)
```
Background Worker (every 30s)
    ├─> Queries: drivers WHERE status IN ('available', 'en_route')
    ├─> Queries: batches WHERE status = 'pending'
    ├─> Computes: match_score using trajectory + artery + capacity
    └─> Inserts: pulse_matches (expires in 15 min)
         └─> Retrieved: GET /pulse/matches (< 10ms)
```

### 4. The Handshake Flow (Payment)
```
Order Placed
    └─> escrow_payments (status: 'pending')
         └─> Stripe charge created
              └─> Payment held (status: 'held')
                   └─> Delivery completed
                        └─> Funds released (status: 'released')
                             ├─> Vendor payout
                             ├─> Driver payout
                             └─> Platform fee
```

## Geospatial Hierarchy 🌍

```
POINT (single location)
    └─> drivers.current_location
    └─> driver_status.location
    └─> orders.pickup_location
    └─> orders.delivery_location
    └─> route_stops.location

LINESTRING (path/route)
    └─> routes.route_geometry
    └─> highway_arteries.route_geometry
```

## Status State Machines

### Order Status
```
pending → confirmed → preparing → ready → assigned →
in_transit → delivered
              ↓
          cancelled
```

### Batch Status
```
pending → assigned → in_progress → completed
            ↓
        cancelled
```

### Escrow Status
```
pending → held → released
           ↓        ↓
       disputed  refunded
```

### Driver Status
```
offline → available → en_route → busy → available
```

## Index Strategy

### High-Performance Queries

**GIST Indices** (Geospatial):
- All `GEOGRAPHY` columns
- Enables: `ST_Distance`, `ST_DWithin`, `ST_LineLocatePoint`

**B-tree Indices** (Lookups):
- All foreign keys
- Status columns
- Timestamp columns (DESC for recent-first)

**Partial Indices** (Filtered):
- `WHERE is_active = true`
- `WHERE is_read = false`
- `WHERE completed = false`

## Security Model

```
┌────────────────────────────────────────┐
│         Row Level Security             │
└────────────────────────────────────────┘

Users        → See own data
Drivers      → See assigned batches + pulse matches
Vendors      → See orders from their store
Customers    → See own orders
Service Role → Full access (background workers)
```

## Data Flow Example

### Complete Order Journey

```
1. Customer places order
   └─> INSERT orders (status: 'pending')
        └─> INSERT escrow_payments (status: 'pending')

2. Routing service creates batch
   └─> INSERT batches (status: 'pending')
        └─> INSERT batch_items (links order to batch)

3. The Pulse (background) matches driver
   └─> INSERT pulse_matches (every 30s)
        └─> Driver sees match via GET /pulse/matches

4. Driver accepts match
   └─> UPDATE batches (status: 'assigned', driver_id: xxx)
        └─> UPDATE orders (status: 'assigned')
             └─> UPDATE escrow_payments (status: 'held')

5. Driver completes delivery
   └─> UPDATE orders (status: 'delivered')
        └─> UPDATE escrow_payments (status: 'released')
             └─> Stripe payout to vendor + driver

6. Automatic cleanup (background)
   └─> DELETE pulse_matches WHERE expires_at < NOW()
```

---

**Legend:**
- 🌍 = PostGIS GEOGRAPHY type
- (FK) = Foreign Key
- ─> = Relationship
- ◄─ = Reverse relationship

**The Artery flows through every table.** 🩸⚡
