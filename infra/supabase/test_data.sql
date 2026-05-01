-- ============================================================================
-- TEST DATA FOR THE PULSE
-- ============================================================================
-- Insert this in Supabase SQL Editor to test The Pulse autonomous matching
-- ============================================================================

-- Clean up any existing test data first
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

-- ============================================================================
-- INSERT TEST DRIVERS
-- ============================================================================

INSERT INTO drivers (id, license_number, vehicle_type, vehicle_capacity, rating, is_active, latitude, longitude, current_location, total_deliveries, total_earnings_cents)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'TEST-DRIVER-001',
    'car',
    4,
    4.8,
    true,
    45.42,
    -75.70,
    ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326),
    150,
    45000
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'TEST-DRIVER-002',
    'van',
    8,
    4.9,
    true,
    45.41,
    -75.68,
    ST_SetSRID(ST_MakePoint(-75.68, 45.41), 4326),
    230,
    68000
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'TEST-DRIVER-003',
    'truck',
    12,
    5.0,
    true,
    45.40,
    -75.72,
    ST_SetSRID(ST_MakePoint(-75.72, 45.40), 4326),
    310,
    92000
  );

-- ============================================================================
-- INSERT DRIVER STATUS (Available for matching)
-- ============================================================================

INSERT INTO driver_status (driver_id, status, latitude, longitude, location, speed_kmh, heading_degrees)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'available',
    45.42,
    -75.70,
    ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326),
    0,
    0
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'available',
    45.41,
    -75.68,
    ST_SetSRID(ST_MakePoint(-75.68, 45.41), 4326),
    0,
    0
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'en_route',
    45.40,
    -75.72,
    ST_SetSRID(ST_MakePoint(-75.72, 45.40), 4326),
    45,
    90
  );

-- ============================================================================
-- INSERT TEST BATCHES (Pending - need drivers)
-- ============================================================================

INSERT INTO batches (id, batch_number, status, total_orders, estimated_duration_minutes, estimated_distance_km)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'BATCH-TEST-001',
    'pending',
    3,
    45,
    12.5
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'BATCH-TEST-002',
    'pending',
    2,
    30,
    8.0
  );

-- ============================================================================
-- INSERT BATCH ITEMS (Order locations)
-- ============================================================================

INSERT INTO batch_items (
  batch_id,
  order_id,
  sequence_number,
  pickup_latitude,
  pickup_longitude,
  pickup_location,
  pickup_address,
  delivery_latitude,
  delivery_longitude,
  delivery_location,
  delivery_address
)
VALUES
  -- Batch 1 Orders
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'order-test-001',
    1,
    45.43,
    -75.69,
    ST_SetSRID(ST_MakePoint(-75.69, 45.43), 4326),
    '123 Main St, Ottawa',
    45.44,
    -75.67,
    ST_SetSRID(ST_MakePoint(-75.67, 45.44), 4326),
    '456 Oak Ave, Ottawa'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'order-test-002',
    2,
    45.43,
    -75.68,
    ST_SetSRID(ST_MakePoint(-75.68, 45.43), 4326),
    '789 Pine St, Ottawa',
    45.45,
    -75.66,
    ST_SetSRID(ST_MakePoint(-75.66, 45.45), 4326),
    '321 Elm St, Ottawa'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'order-test-003',
    3,
    45.42,
    -75.70,
    ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326),
    '555 Maple Rd, Ottawa',
    45.41,
    -75.71,
    ST_SetSRID(ST_MakePoint(-75.71, 45.41), 4326),
    '777 Cedar Ln, Ottawa'
  ),
  -- Batch 2 Orders
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'order-test-004',
    1,
    45.41,
    -75.71,
    ST_SetSRID(ST_MakePoint(-75.71, 45.41), 4326),
    '111 Birch St, Ottawa',
    45.42,
    -75.70,
    ST_SetSRID(ST_MakePoint(-75.70, 45.42), 4326),
    '222 Spruce Ave, Ottawa'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'order-test-005',
    2,
    45.40,
    -75.72,
    ST_SetSRID(ST_MakePoint(-75.72, 45.40), 4326),
    '333 Willow Dr, Ottawa',
    45.39,
    -75.73,
    ST_SetSRID(ST_MakePoint(-75.73, 45.39), 4326),
    '444 Ash Blvd, Ottawa'
  );

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check drivers
SELECT
  id,
  license_number,
  vehicle_type,
  rating,
  is_active,
  latitude,
  longitude
FROM drivers
WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

-- Check driver status
SELECT
  driver_id,
  status,
  latitude,
  longitude
FROM driver_status
WHERE driver_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

-- Check batches
SELECT
  id,
  batch_number,
  status,
  total_orders,
  estimated_duration_minutes,
  estimated_distance_km
FROM batches
WHERE id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

-- Check batch items
SELECT
  batch_id,
  order_id,
  sequence_number,
  pickup_address,
  delivery_address
FROM batch_items
WHERE batch_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
)
ORDER BY batch_id, sequence_number;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'TEST DATA INSERTED SUCCESSFULLY';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Drivers: 3 (all active and available)';
  RAISE NOTICE 'Batches: 2 (both pending)';
  RAISE NOTICE 'Orders: 5 (across 2 batches)';
  RAISE NOTICE '';
  RAISE NOTICE 'The Pulse will scan in ~30 seconds and create matches!';
  RAISE NOTICE '';
  RAISE NOTICE 'Check matches: SELECT * FROM pulse_matches WHERE is_active = true;';
  RAISE NOTICE '============================================================================';
END $$;
