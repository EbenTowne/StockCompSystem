// frontend/src/routes/AppRoutes.tsx
import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from '../LoginPage'
import ForgetPasswordPage from '../ForgetPasswordPage'
import ResetPasswordPage from '../ResetPasswordPage'
import RegisterEmployerPage from '../EmployerPage'
import DashboardPage from '../pages/DashboardPage'
import ProtectedRoute from '../components/ProtectedRoute'
import Enable2FAPage from '../pages/Enable2FAPage'  // ✅ new
import EmployeeDashboardPage from "../pages/EmployeeDashboardPage";

export default function AppRoutes() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgetPasswordPage />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
      <Route path="/register-employer" element={<RegisterEmployerPage />} />

      {/* protected */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/2fa"
        element={
          <ProtectedRoute>
            <Enable2FAPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/dashboard"
        element={
          <ProtectedRoute>
            <EmployeeDashboardPage />
          </ProtectedRoute>
        }
      />

      {/* redirects */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
