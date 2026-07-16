import { Navigate, Route, Routes } from "react-router";

import ProtectedRoute, { AdminRoute } from "../components/ProtectedRoute";
import AdminUsersPage from "../pages/AdminUsersPage";
import DashboardPage from "../pages/DashboardPage";
import LoginPage from "../pages/LoginPage";

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/usuarios"
        element={
          <AdminRoute>
            <AdminUsersPage />
          </AdminRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default AppRoutes;
