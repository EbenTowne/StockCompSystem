import React, { createContext, useState, useEffect } from 'react'
import { login, refreshToken } from '../auth'
import toast from 'react-hot-toast'
import dayjs from 'dayjs'
import { jwtDecode } from 'jwt-decode'

/** 1) Define the shape of your user object: */
interface User {
  username: string
  email: string
  // …add any other fields your backend returns
}

/** 2) Define your context API: */
interface AuthContextType {
  user: User | null
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => void
}

/** 3) Create context with dummy defaults: */
export const AuthContext = createContext<AuthContextType>({
  user: null,
  signIn: async () => {},
  signOut: () => {}
})

export const AuthContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)

  /** actual signIn implementation: */
  const signIn = async (username: string, password: string) => {
    try {
      const { data } = await login(username, password)
      const { access, refresh } = data
      const decoded: any = jwtDecode(access)
      setUser({ username: decoded.username, email: decoded.email })
      localStorage.setItem('accessToken', access)
      localStorage.setItem('refreshToken', refresh)
      toast.success('Logged in!')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Login failed')
    }
  }

  /** clear out everything: */
  const signOut = () => {
    setUser(null)
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    toast('Signed out')
  }

  /** (optional) auto‐refresh on mount… */
  useEffect(() => {
    /* your refreshToken logic here */
  }, [])

  return (
    <AuthContext.Provider value={{ user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// this line makes your default import work:
export default AuthContextProvider
