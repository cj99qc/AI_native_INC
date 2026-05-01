export const dynamic = 'force-dynamic'

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001'

const SERVICE_NAMES = ['pricing', 'routing', 'matching', 'escrow', 'rag'] as const
type ServiceName = typeof SERVICE_NAMES[number]

export type ServiceHealth = {
  name: ServiceName
  status: 'up' | 'down' | 'unknown'
  latency_ms: number | null
}

export type PulseStatus = {
  running: boolean
  total_matches?: number
  last_scan?: string
  scan_interval_seconds?: number
  error?: string
}

export type ServicesResponse = {
  bridge: { status: 'up' | 'down'; latency_ms: number }
  services: ServiceHealth[]
  pulse: PulseStatus
  checked_at: string
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function probe(
  url: string,
  timeoutMs = 4000
): Promise<{ ok: boolean; data: unknown; latency: number }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    const data = await res.json().catch(() => null)
    return { ok: res.ok, data, latency: Date.now() - start }
  } catch {
    return { ok: false, data: null, latency: Date.now() - start }
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  // 1. Check bridge reachability first
  const bridgeCheck = await probe(`${BRIDGE_URL}/health`)

  if (!bridgeCheck.ok) {
    const body: ServicesResponse = {
      bridge:     { status: 'down', latency_ms: bridgeCheck.latency },
      services:   SERVICE_NAMES.map(name => ({ name, status: 'unknown', latency_ms: null })),
      pulse:      { running: false, error: 'Bridge unreachable' },
      checked_at: new Date().toISOString(),
    }
    return Response.json(body)
  }

  // 2. Fan out to all service health checks + pulse status in parallel
  const [serviceResults, pulseProbe] = await Promise.all([
    Promise.all(
      SERVICE_NAMES.map(async (name): Promise<ServiceHealth> => {
        const check = await probe(`${BRIDGE_URL}/api/health/${name}`)
        return {
          name,
          status:     check.ok ? 'up' : 'down',
          latency_ms: check.latency,
        }
      })
    ),
    probe(`${BRIDGE_URL}/api/matching/pulse/status`),
  ])

  // 3. Parse pulse data safely
  const pulse: PulseStatus = pulseProbe.ok && pulseProbe.data
    ? {
        running: true,
        ...(pulseProbe.data as Record<string, unknown>),
      } as PulseStatus
    : { running: false, error: 'Pulse worker not responding' }

  const body: ServicesResponse = {
    bridge:     { status: 'up', latency_ms: bridgeCheck.latency },
    services:   serviceResults,
    pulse,
    checked_at: new Date().toISOString(),
  }

  return Response.json(body)
}
