// src/components/Header.tsx
import React, { useContext } from 'react'
import { Link } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

export default function Header() {
  const { user, signOut } = useContext(AuthContext)!

  return (
    <header className="px-6 py-4 bg-gray-800 text-white flex justify-between items-center shadow-md">
      <Link to="/" className="text-2xl font-bold hover:text-gray-300">
        Stock Comp System
      </Link>

      {user ? (
        <div className="flex items-center space-x-4">
          <span className="text-lg">Hi, {user.username}</span>
          <button
            onClick={signOut}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded transition"
          >
            Sign Out
          </button>
        </div>
      ) : (
        <Link
          to="/login"
          className="text-indigo-400 hover:text-indigo-300 font-medium"
        >
          Sign In
        </Link>
      )}
    </header>
  )
}
