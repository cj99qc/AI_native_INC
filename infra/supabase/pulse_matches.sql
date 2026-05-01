-- Pulse Matches: Pre-computed driver-to-order matches (The Pulse)
-- This table stores autonomous, anticipatory matches found by the background worker

CREATE TABLE IF NOT EXISTS pulse_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    match_score DECIMAL(5, 4) NOT NULL, -- 0.0000 to 1.0000
    distance_km DECIMAL(10, 2) NOT NULL,
    artery_score DECIMAL(5, 4), -- Highway 7 proximity score
    trajectory_score DECIMAL(5, 4), -- Moving toward pickup score
    capacity_utilization DECIMAL(5, 4),
    estimated_acceptance_probability DECIMAL(5, 4),
    match_details JSONB, -- Full DriverScore details
    is_active BOOLEAN DEFAULT true, -- False if driver/batch no longer available
    suggested_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Matches expire after X minutes
    notified BOOLEAN DEFAULT false, -- Whether driver has been notified
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for fast lookup
CREATE INDEX IF NOT EXISTS idx_pulse_matches_driver_id ON pulse_matches (driver_id);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_batch_id ON pulse_matches (batch_id);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_score ON pulse_matches (match_score DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_active ON pulse_matches (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pulse_matches_expires_at ON pulse_matches (expires_at);
CREATE INDEX IF NOT EXISTS idx_pulse_matches_notified ON pulse_matches (notified) WHERE notified = false;

-- Row Level Security
ALTER TABLE pulse_matches ENABLE ROW LEVEL SECURITY;

-- Drivers can see their own pulse matches
CREATE POLICY "Drivers can view own pulse matches" ON pulse_matches FOR SELECT USING (
    EXISTS (SELECT 1 FROM drivers WHERE drivers.id = pulse_matches.driver_id AND drivers.user_id = auth.uid())
);

-- Service role can manage all pulse matches
CREATE POLICY "Service can manage pulse matches" ON pulse_matches FOR ALL USING (
    auth.jwt()->>'role' = 'service_role'
);

-- Create a function to clean up expired matches
CREATE OR REPLACE FUNCTION cleanup_expired_pulse_matches()
RETURNS void AS $$
BEGIN
    DELETE FROM pulse_matches
    WHERE expires_at < NOW() OR is_active = false;
END;
$$ LANGUAGE plpgsql;

-- Optionally create a cron job to clean up expired matches (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-pulse-matches', '*/5 * * * *', 'SELECT cleanup_expired_pulse_matches()');
