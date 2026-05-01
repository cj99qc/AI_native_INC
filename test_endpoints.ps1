# Test all Pulse endpoints
Write-Host "🧪 Testing INC Matching Service Endpoints" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:8003"

# Test 1: Health
Write-Host "1️⃣  Testing /health..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    if ($response.ok -eq $true) {
        Write-Host "   ✅ Health check passed" -ForegroundColor Green
    }
} catch {
    Write-Host "   ❌ Health check failed" -ForegroundColor Red
    Write-Host "   Make sure the service is running!" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Test 2: Config
Write-Host "2️⃣  Testing /config..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/config" -Method Get
    if ($response.pulse) {
        Write-Host "   ✅ Config loaded (scan_interval: $($response.pulse.scan_interval_seconds)s)" -ForegroundColor Green
    }
} catch {
    Write-Host "   ❌ Config failed" -ForegroundColor Red
}

Write-Host ""

# Test 3: Pulse Status
Write-Host "3️⃣  Testing /pulse/status..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/pulse/status" -Method Get
    if ($response.running -eq $true) {
        Write-Host "   ✅ The Pulse is alive!" -ForegroundColor Green
        Write-Host "      • Scan interval: $($response.scan_interval_seconds)s" -ForegroundColor Gray
        Write-Host "      • Total matches: $($response.total_matches)" -ForegroundColor Gray
        Write-Host "      • Active matches: $($response.active_matches)" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  The Pulse is not running" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Pulse status failed" -ForegroundColor Red
}

Write-Host ""

# Test 4: Pulse Matches
Write-Host "4️⃣  Testing /pulse/matches..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/pulse/matches?limit=5" -Method Get
    Write-Host "   ✅ Found $($response.count) pulse matches" -ForegroundColor Green

    if ($response.count -gt 0) {
        Write-Host ""
        Write-Host "   Top match:" -ForegroundColor Cyan
        $topMatch = $response.matches[0]
        Write-Host "      • Driver: $($topMatch.driver_id.Substring(0,8))..." -ForegroundColor Gray
        Write-Host "      • Batch: $($topMatch.batch_id.Substring(0,8))..." -ForegroundColor Gray
        Write-Host "      • Match Score: $($topMatch.match_score)" -ForegroundColor Gray
        Write-Host "      • Distance: $($topMatch.distance_km) km" -ForegroundColor Gray
        Write-Host "      • Acceptance Probability: $($topMatch.estimated_acceptance_probability)" -ForegroundColor Gray
    } else {
        Write-Host ""
        Write-Host "   ℹ️  No matches yet. Insert test data and wait 30 seconds." -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Pulse matches failed" -ForegroundColor Red
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "✅ All endpoint tests complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Insert test data (see DEV_TEST_CHECKLIST.md Step 6)" -ForegroundColor Gray
Write-Host "  2. Wait 30 seconds for pulse cycle" -ForegroundColor Gray
Write-Host "  3. Run this script again to see matches" -ForegroundColor Gray
Write-Host ""
