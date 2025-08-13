export default function Footer() {
  return (
    <footer className="border-t py-6 text-center text-sm text-muted-foreground">
      <div className="mx-auto max-w-7xl px-4">© {new Date().getFullYear()} InC</div>
    </footer>
  )
}