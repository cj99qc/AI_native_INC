# PowerShell script to test The Pulse
# Usage: Set your DATABASE_URL first, then run: .\start_test.ps1

Write-Host "🩸 Starting INC Matching Service with The Pulse" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if DATABASE_URL is set
if (-not $env:DATABASE_URL) {
    Write-Host "❌ ERROR: DATABASE_URL not set!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please set it first:" -ForegroundColor Yellow
    Write-Host '  $env:DATABASE_URL="postgresql://postgres:YOUR-PASSWORD@db.mgjethgvecrlcxkzsfbu.supabase.co:5432/postgres"' -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "✅ DATABASE_URL is set" -ForegroundColor Green
Write-Host ""

# Navigate to matching service
Set-Location services\matching_service

Write-Host "🔧 Checking dependencies..." -ForegroundColor Cyan
python -c "import fastapi, uvicorn, psycopg2; print('✅ All dependencies installed')"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Dependencies missing. Installing..." -ForegroundColor Red
    pip install -r requirements.txt
}

Write-Host ""
Write-Host "🧪 Testing database connection..." -ForegroundColor Cyan
python -c "import psycopg2; import os; conn = psycopg2.connect(os.getenv('DATABASE_URL')); print('✅ Database connected!'); conn.close()"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Database connection failed!" -ForegroundColor Red
    Write-Host "Check your DATABASE_URL and password" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "🚀 Starting matching service on http://localhost:8003" -ForegroundColor Cyan
Write-Host ""
Write-Host "Watch for:" -ForegroundColor Yellow
Write-Host "  🩸 The Pulse is alive - autonomous matching enabled" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# Start the service
python -m uvicorn app:app --host 0.0.0.0 --port 8003 --reload
