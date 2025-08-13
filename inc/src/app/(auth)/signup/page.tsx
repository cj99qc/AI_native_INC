'use client'

import { useState } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'

export default function SignupPage() {
  const supabase = useSupabase()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function signup() {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) alert(error.message)
    else alert('Check your email to confirm your account.')
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Sign Up</h1>
      <input className="w-full rounded border px-3 py-2" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
      <input className="w-full rounded border px-3 py-2" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={signup}>Create account</button>
    </div>
  )
}