type SearchResult = { id: string; name: string; description: string | null; price: number }

async function searchProducts(q: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/search/semantic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q }),
    cache: 'no-store',
  })
  if (!res.ok) return [] as SearchResult[]
  return (await res.json()).results as SearchResult[]
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const query = (q ?? '').toString()
  const results = query ? await searchProducts(query) : []
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      <form className="flex gap-2" method="get">
        <input className="flex-1 rounded border px-3 py-2" name="q" defaultValue={query} placeholder="Search products" />
        <button className="rounded bg-primary px-3 py-2 text-primary-foreground" type="submit">Search</button>
      </form>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r) => (
          <a key={r.id} href={`/product/${r.id}`} className="rounded border p-4">
            <div className="font-medium">{r.name}</div>
            <div className="truncate text-sm text-muted-foreground">{r.description}</div>
            <div className="mt-2 text-primary">${Number(r.price).toFixed(2)}</div>
          </a>
        ))}
      </div>
    </div>
  )
}