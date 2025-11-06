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
import EmployerLayout from "../components/EmployerLayout"
import DashboardPage from "../pages/DashboardPage"
import CreateGrant from "../pages/CreateGrant"
import CapTable from "../pages/CapTable"
import AIChatbot from "../pages/AIChatbot"
import Expenses from "../pages/Expenses"
import CompanyMetrics from "../pages/CompanyMetrics"
import ViewEmployees from "../pages/ViewEmployees"

// UPDATED: unified Manage Grants page (search + list)
import ManageGrants from "../pages/ManageGrant"
import ManageGrantDetail from "../pages/ManageGrantDetail"

// PUBLIC: employee registration
import EmployeeRegister from '../pages/EmployeeRegister'

export default function AppRoutes() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgetPasswordPage />} />
      {/* FIX: param name must be uidb64 to match ResetPasswordPage */}
      <Route path="/reset-password/:uidb64/:token" element={<ResetPasswordPage />} />
      <Route path="/register-employer" element={<RegisterEmployerPage />} />

      {/* public employee registration (from email link) */}
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
        <Route index element={<Navigate to="company-metrics" replace />} />
        <Route path="create-grant" element={<CreateGrant />} />

        {/* Unified Manage Grants */}
        <Route path="grants" element={<ManageGrants />} />
        <Route path="grants/:uniqueId/:grantId" element={<ManageGrantDetail />} />

        <Route path="cap-table" element={<CapTable />} />
        <Route path="ai-chatbot" element={<AIChatbot />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="company-metrics" element={<CompanyMetrics />} />
        <Route path="view-employees" element={<ViewEmployees />} />
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