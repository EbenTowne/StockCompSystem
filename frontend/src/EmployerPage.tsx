import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { registerEmployer } from './auth'

interface FormState {
  username:     string
  name:         string
  email:        string
  company_name: string
  unique_id:    string
  password:     string
}

export default function RegisterEmployerPage() {
  const nav = useNavigate()
  const [form, setForm] = useState<FormState>({
    username:     '',
    name:         '',
    email:        '',
    company_name: '',
    unique_id:    '',
    password:     '',
  })
  const [error, setError] = useState<string>('')

  const handle = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [key]: e.target.value }))
    setError('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await registerEmployer(
        form.username,
        form.name,
        form.email,
        form.password,
        form.company_name,
        form.unique_id,
      )
      nav('/login')
    } catch (err: any) {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        if (data.username) {
          setError(
            Array.isArray(data.username)
              ? data.username.join(' ')
              : String(data.username)
          )
        } else if (data.email) {
          setError(
            Array.isArray(data.email)
              ? data.email.join(' ')
              : String(data.email)
          )
        } else if (data.detail) {
          setError(data.detail)
        } else {
          setError('Registration failed')
        }
      } else {
        setError('Registration failed')
      }
    }
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-2xl font-bold mb-6 text-center">
        Register as Employer
      </h1>

      <form onSubmit={submit} className="space-y-4">
        <input
          className="input w-full"
          placeholder="Username"
          required
          value={form.username}
          onChange={handle('username')}
        />

        <input
          className="input w-full"
          placeholder="Full name"
          required
          value={form.name}
          onChange={handle('name')}
        />

        <input
          className="input w-full"
          type="email"
          placeholder="Email"
          required
          value={form.email}
          onChange={handle('email')}
        />

        <input
          className="input w-full"
          placeholder="Company name"
          required
          value={form.company_name}
          onChange={handle('company_name')}
        />

        <input
          className="input w-full"
          placeholder="Unique ID"
          required
          value={form.unique_id}
          onChange={handle('unique_id')}
        />

        <input
          className="input w-full"
          type="password"
          placeholder="Password (min 8 chars)"
          required
          minLength={8}
          value={form.password}
          onChange={handle('password')}
        />

        <button className="btn-primary w-full" type="submit">
          Create account
        </button>

        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </form>

      <p className="text-center text-sm mt-4">
        Already have an account?{' '}
        <Link to="/login" className="text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}