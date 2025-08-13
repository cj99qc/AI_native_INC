'use client'

import { useState } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'

export default function LoginPage() {
  const supabase = useSupabase()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function sendMagic() {
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (!error) setSent(true)
    else alert(error.message)
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Login</h1>
      <input className="w-full rounded border px-3 py-2" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
      <button className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={sendMagic}>Send Magic Link</button>
      {sent && <div className="text-sm text-muted-foreground">Check your email for the login link.</div>}
    </div>
  )
}