import CartSummary from '@/components/features/CartSummary'

export default function CartPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Your Cart</h1>
      <CartSummary />
      <a href="/checkout" className="inline-block rounded bg-primary px-3 py-2 text-primary-foreground">Proceed to Checkout</a>
    </div>
  )
}