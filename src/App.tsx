import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { LeadsPage } from './pages/LeadsPage';
import { LeadDetail } from './pages/LeadDetail';
import { DealsPage } from './pages/DealsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { TeamPage } from './pages/TeamPage';
import { FinancePage } from './pages/FinancePage';
import { AdminPage } from './pages/AdminPage';
import { GuidePage } from './pages/GuidePage';

const ProtectedRoute: React.FC<{ children: React.ReactNode; roles?: string[] }> = ({ children, roles }) => {
  const { user, isLoading, role } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F9F9F9] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-[#161616]/40 uppercase tracking-widest">Loading...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(role || '')) return <Navigate to="/" replace />;
  return <>{children}</>;
};

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          {/* All roles */}
          <Route index element={<Dashboard />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="deals" element={<DealsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="guide" element={<GuidePage />} />

          {/* Admin + Super Admin */}
          <Route
            path="team"
            element={
              <ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}>
                <TeamPage />
              </ProtectedRoute>
            }
          />

          {/* Super Admin only */}
          <Route
            path="finance"
            element={
              <ProtectedRoute roles={['SUPER_ADMIN']}>
                <FinancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin"
            element={
              <ProtectedRoute roles={['SUPER_ADMIN']}>
                <AdminPage />
              </ProtectedRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
