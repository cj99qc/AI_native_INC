"""
The Pulse: Background worker for autonomous driver-order matching

This worker continuously scans for active drivers and pending orders,
pre-computing matches and storing them for instant retrieval.

We do not wait for user input; we anticipate.
"""

import asyncio
import os
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor

# Import shared models from app - safe because pulse_worker is only ever
# imported inside startup_event, by which point app.py is fully loaded.
from app import BatchData, Driver, DriverStatus, MatchingEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PulseWorker:
    """
    The Pulse - Continuous background matching engine

    Scans for "Pulses" (drivers on the highway) and pre-matches them
    to pending orders autonomously.
    """

    def __init__(self, config: Dict[str, Any], matching_engine: MatchingEngine):
        self.config = config
        pulse_config = config.get("pulse", {})
        self.scan_interval_seconds = pulse_config.get("scan_interval_seconds", 30)
        self.match_expiry_minutes = pulse_config.get("match_expiry_minutes", 15)
        self.max_distance_km = pulse_config.get("max_distance_km", 50.0)
        self.min_match_score = pulse_config.get("min_match_score", 0.3)
        self.running = False
        self.matching_engine = matching_engine

        logger.info(f"🩸 Pulse Worker initialized - scan interval: {self.scan_interval_seconds}s")

    def get_db_connection(self):
        """Get database connection"""
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise Exception("DATABASE_URL not set")

        return psycopg2.connect(db_url, cursor_factory=RealDictCursor)

    def fetch_active_drivers(self, conn) -> List[Dict[str, Any]]:
        """
        Fetch active drivers who are available or en_route
        These are our "Pulses" - trucks on the highway
        """
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    d.id,
                    d.latitude as lat,
                    d.longitude as lng,
                    d.rating,
                    d.vehicle_capacity,
                    d.is_active,
                    COALESCE(COUNT(b.id), 0) as current_orders,
                    8 as max_concurrent_orders,
                    ds.status,
                    ds.latitude as prev_lat,
                    ds.longitude as prev_lng,
                    ds.updated_at as prev_timestamp
                FROM drivers d
                LEFT JOIN batches b ON b.driver_id = d.id
                    AND b.status IN ('assigned', 'in_progress')
                LEFT JOIN LATERAL (
                    SELECT latitude, longitude, updated_at, status
                    FROM driver_status
                    WHERE driver_id = d.id
                    ORDER BY updated_at DESC
                    LIMIT 1
                ) ds ON true
                WHERE d.is_active = true
                    AND d.latitude IS NOT NULL
                    AND d.longitude IS NOT NULL
                    AND (ds.status IN ('available', 'en_route') OR ds.status IS NULL)
                GROUP BY d.id, d.latitude, d.longitude, d.rating, d.vehicle_capacity,
                         d.is_active, ds.status, ds.latitude, ds.longitude, ds.updated_at
            """)

            drivers = cur.fetchall()
            logger.info(f"⚡ Found {len(drivers)} active drivers (Pulses)")
            return [dict(driver) for driver in drivers]

    def fetch_pending_batches(self, conn) -> List[Dict[str, Any]]:
        """
        Fetch pending batches that need drivers
        These are opportunities waiting for The Pulse
        """
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    b.id,
                    b.total_orders,
                    b.estimated_duration_minutes,
                    b.estimated_distance_km,
                    AVG(bi.pickup_latitude) as center_lat,
                    AVG(bi.pickup_longitude) as center_lng,
                    1 as priority
                FROM batches b
                INNER JOIN batch_items bi ON bi.batch_id = b.id
                WHERE b.status = 'pending'
                    AND b.driver_id IS NULL
                GROUP BY b.id, b.total_orders, b.estimated_duration_minutes, b.estimated_distance_km
            """)

            batches = cur.fetchall()
            logger.info(f"📦 Found {len(batches)} pending batches")
            return [dict(batch) for batch in batches]

    def compute_matches(self, drivers: List[Dict], batches: List[Dict]) -> List[Dict]:
        """
        Compute matches between drivers and batches
        Returns list of match objects ready for database insertion
        """
        matches = []

        for batch in batches:
            batch_data = BatchData(
                id=str(batch['id']),
                center_lat=float(batch['center_lat']),
                center_lng=float(batch['center_lng']),
                total_orders=int(batch['total_orders']),
                estimated_duration_minutes=int(batch.get('estimated_duration_minutes', 30)),
                priority=int(batch.get('priority', 1))
            )

            # Convert drivers to Driver models
            driver_models = []
            for driver in drivers:
                prev_location = None
                if driver.get('prev_lat') and driver.get('prev_lng') and driver.get('prev_timestamp'):
                    prev_location = DriverStatus(
                        lat=float(driver['prev_lat']),
                        lng=float(driver['prev_lng']),
                        timestamp=driver['prev_timestamp']
                    )

                driver_model = Driver(
                    id=str(driver['id']),
                    lat=float(driver['lat']),
                    lng=float(driver['lng']),
                    rating=float(driver.get('rating', 5.0)),
                    vehicle_capacity=int(driver.get('vehicle_capacity', 4)),
                    is_active=bool(driver.get('is_active', True)),
                    current_orders=int(driver.get('current_orders', 0)),
                    max_concurrent_orders=int(driver.get('max_concurrent_orders', 8)),
                    previous_location=prev_location
                )
                driver_models.append(driver_model)

            # Find best drivers for this batch
            scored_drivers = self.matching_engine.find_best_drivers(
                batch_data,
                driver_models,
                self.max_distance_km
            )

            # Store top matches that meet minimum score threshold
            for scored_driver in scored_drivers:
                if scored_driver.score >= self.min_match_score:
                    # Calculate acceptance probability
                    acceptance_factors = self.matching_engine.predict_acceptance_probability(
                        scored_driver.driver_id,
                        scored_driver.distance_km,
                        batch_data.estimated_duration_minutes,
                        30.0  # Base payout estimate
                    )

                    match = {
                        'driver_id': scored_driver.driver_id,
                        'batch_id': str(batch['id']),
                        'match_score': float(scored_driver.score),
                        'distance_km': float(scored_driver.distance_km),
                        'artery_score': float(scored_driver.artery_score) if scored_driver.artery_score else None,
                        'trajectory_score': float(scored_driver.trajectory_score) if scored_driver.trajectory_score else None,
                        'capacity_utilization': float(scored_driver.capacity_utilization),
                        'estimated_acceptance_probability': float(acceptance_factors['acceptance_probability']),
                        'match_details': json.dumps({
                            'driver_id': scored_driver.driver_id,
                            'score': scored_driver.score,
                            'distance_km': scored_driver.distance_km,
                            'rating': scored_driver.rating,
                            'availability_factor': scored_driver.availability_factor,
                            'artery_score': scored_driver.artery_score,
                            'trajectory_score': scored_driver.trajectory_score
                        })
                    }
                    matches.append(match)

        logger.info(f"🎯 Computed {len(matches)} pulse matches")
        return matches

    def store_matches(self, conn, matches: List[Dict]):
        """
        Store matches in pulse_matches table
        Deactivates old matches for same driver/batch pairs
        """
        if not matches:
            return

        expires_at = datetime.now() + timedelta(minutes=self.match_expiry_minutes)

        with conn.cursor() as cur:
            # Deactivate existing matches for these driver/batch pairs
            for match in matches:
                cur.execute("""
                    UPDATE pulse_matches
                    SET is_active = false
                    WHERE driver_id = %s AND batch_id = %s AND is_active = true
                """, (match['driver_id'], match['batch_id']))

            # Insert new matches
            for match in matches:
                cur.execute("""
                    INSERT INTO pulse_matches (
                        driver_id, batch_id, match_score, distance_km,
                        artery_score, trajectory_score, capacity_utilization,
                        estimated_acceptance_probability, match_details,
                        expires_at, is_active, notified
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, false
                    )
                """, (
                    match['driver_id'],
                    match['batch_id'],
                    match['match_score'],
                    match['distance_km'],
                    match['artery_score'],
                    match['trajectory_score'],
                    match['capacity_utilization'],
                    match['estimated_acceptance_probability'],
                    match['match_details'],
                    expires_at
                ))

            conn.commit()
            logger.info(f"💾 Stored {len(matches)} pulse matches (expires at {expires_at})")

    def cleanup_expired_matches(self, conn):
        """Remove expired or inactive matches"""
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM pulse_matches
                WHERE expires_at < NOW() OR is_active = false
            """)
            deleted = cur.rowcount
            conn.commit()

            if deleted > 0:
                logger.info(f"🧹 Cleaned up {deleted} expired pulse matches")

    async def pulse_scan_cycle(self):
        """Single scan cycle - The Pulse heartbeat"""
        conn = None
        try:
            conn = self.get_db_connection()

            # 1. Fetch active drivers (Pulses on the highway)
            drivers = self.fetch_active_drivers(conn)

            # 2. Fetch pending batches (opportunities)
            batches = self.fetch_pending_batches(conn)

            if not drivers or not batches:
                logger.info("⏸️  No drivers or batches to match - waiting for next pulse")
                return

            # 3. Compute matches autonomously
            matches = self.compute_matches(drivers, batches)

            # 4. Store matches for instant retrieval
            self.store_matches(conn, matches)

            # 5. Cleanup expired matches
            self.cleanup_expired_matches(conn)

            logger.info(f"💓 Pulse cycle complete - {len(matches)} matches ready")

        except Exception as e:
            logger.error(f"❌ Pulse scan cycle failed: {str(e)}", exc_info=True)
        finally:
            if conn:
                conn.close()

    async def start(self):
        """Start The Pulse - continuous background matching"""
        self.running = True
        logger.info(f"🩸 The Pulse is alive - scanning every {self.scan_interval_seconds}s")

        while self.running:
            await self.pulse_scan_cycle()
            await asyncio.sleep(self.scan_interval_seconds)

    def stop(self):
        """Stop The Pulse"""
        self.running = False
        logger.info("🛑 The Pulse has stopped")


# Global pulse worker instance
pulse_worker: Optional[PulseWorker] = None

def init_pulse_worker(config: Dict[str, Any], matching_engine: MatchingEngine):
    """Initialize the global pulse worker"""
    global pulse_worker
    pulse_worker = PulseWorker(config, matching_engine)
    return pulse_worker

def get_pulse_worker() -> Optional[PulseWorker]:
    """Get the global pulse worker instance"""
    return pulse_worker
