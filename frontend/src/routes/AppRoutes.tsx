import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from '../LoginPage'
import ForgetPasswordPage from '../ForgetPasswordPage'
import ResetPasswordPage from '../ResetPasswordPage'
import RegisterEmployerPage from '../EmployerPage'
import ProtectedRoute from '../components/ProtectedRoute'
import Enable2FAPage from '../pages/Enable2FAPage'
import EmployeeDashboardPage from '../pages/EmployeeDashboardPage'

// employer pages
import EmployerLayout from '../components/EmployerLayout'
import DashboardPage from '../pages/DashboardPage'
import InviteEmployee from "../pages/InviteEmployee"
import CreateGrant from "../pages/CreateGrant"
import ManageGrant from '../pages/ManageGrant'
import CapTable from "../pages/CapTable"

// NEW: employee registration (public)
import EmployeeRegister from '../pages/EmployeeRegister'

export default function AppRoutes() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgetPasswordPage />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
      <Route path="/register-employer" element={<RegisterEmployerPage />} />

      {/* NEW: public employee registration page reached from email link */}
      <Route path="/employee/register" element={<EmployeeRegister />} />

      {/* employer (with sidebar layout) */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <EmployerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="invite" element={<InviteEmployee />} />
        <Route path="create-grant" element={<CreateGrant />} />
        <Route path="grants" element={<ManageGrant />} />
        <Route path="cap-table" element={<CapTable />} />
      </Route>

      {/* employee area */}
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