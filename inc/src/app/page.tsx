import ProductGrid from '@/components/features/ProductGrid'

export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <main className="space-y-10 p-4">
      <section className="mx-auto max-w-7xl rounded bg-muted p-8">
        <h1 className="text-3xl font-semibold">InC – AI-native Local Logistics Marketplace</h1>
        <p className="mt-2 text-muted-foreground">Search, compare, and get local deliveries powered by AI.</p>
        <a href="/search" className="mt-4 inline-block rounded bg-primary px-3 py-2 text-primary-foreground">Start searching</a>
      </section>
      <section className="mx-auto max-w-7xl space-y-4">
        <h2 className="text-xl font-semibold">Featured Products</h2>
        <ProductGrid />
      </section>
    </main>
  )
}
