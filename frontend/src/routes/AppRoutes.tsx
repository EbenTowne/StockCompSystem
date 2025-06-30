import { Routes, Route, Navigate } from 'react-router-dom';

import LoginPage            from '../LoginPage';            // ✅ fixed paths
import RegisterEmployerPage from '../EmployerPage';         // (same file as earlier)
import ForgotPasswordPage   from '../ForgetPasswordPage';
import ResetPasswordPage    from '../ResetPasswordPage';

import Dashboard            from '../App';                  // existing component

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/register-employer"
        element={<RegisterEmployerPage />}
      />

      <Route
        path="/forgot-password"
        element={<ForgotPasswordPage />}
      />

      <Route
        path="/reset-password/:uidb64/:token"
        element={<ResetPasswordPage />}
      />

      <Route path="/dashboard" element={<Dashboard />} />

      {/* catch-all → login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
