import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// adjust paths up one level into src/
import LoginPage             from '../LoginPage';
import RegisterEmployerPage  from '../EmployerPage';
import ForgotPasswordPage    from '../ForgetPasswordPage';
import ResetPasswordPage     from '../ResetPasswordPage';
import DashboardPage         from '../App';

export default function AppRoutes() {
  return (
    <Routes>
      {/* public/auth */}
      <Route path="/login"                     element={<LoginPage />} />
      <Route path="/register-employer"         element={<RegisterEmployerPage />} />
      <Route path="/forgot-password"           element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:uidb64/:token" element={<ResetPasswordPage />} />

      {/* protected */}
      <Route path="/dashboard"                 element={<DashboardPage />} />

      {/* redirects */}
      <Route path="/"       element={<Navigate to="/login"   replace />} />
      <Route path="*"       element={<Navigate to="/"        replace />} />
    </Routes>
  );
}