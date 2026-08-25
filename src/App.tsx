import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';

/**
 * Every page except the login form is loaded on demand.
 *
 * These were all static imports, so the browser downloaded and parsed the
 * entire CRM — seventeen pages, their charts, their modals — before it could
 * render a username field. One 570 kB bundle to sign in. In `npm run dev` it
 * was worse: Vite had to transform every one of those modules on first paste
 * of the URL, which is why the login page took many seconds to appear locally.
 *
 * LoginPage stays static on purpose. It is the one page an unauthenticated
 * visitor always needs, so splitting it would only add a round trip.
 *
 * Named exports need the `.then` shim: React.lazy expects a module whose
 * `default` is the component.
 */
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const LeadsPage = lazy(() => import('./pages/LeadsPage').then(m => ({ default: m.LeadsPage })));
const LeadDetail = lazy(() => import('./pages/LeadDetail').then(m => ({ default: m.LeadDetail })));
const DealsPage = lazy(() => import('./pages/DealsPage').then(m => ({ default: m.DealsPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then(m => ({ default: m.PaymentsPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then(m => ({ default: m.TeamPage })));
const FinancePage = lazy(() => import('./pages/FinancePage').then(m => ({ default: m.FinancePage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const GuidePage = lazy(() => import('./pages/GuidePage').then(m => ({ default: m.GuidePage })));
const InsightsPage = lazy(() => import('./pages/InsightsPage').then(m => ({ default: m.InsightsPage })));
const DeletedLeadsPage = lazy(() => import('./pages/DeletedLeadsPage').then(m => ({ default: m.DeletedLeadsPage })));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage').then(m => ({ default: m.MeetingsPage })));
const DailyLogsPage = lazy(() => import('./pages/DailyLogsPage').then(m => ({ default: m.DailyLogsPage })));
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage').then(m => ({ default: m.OAuthCallbackPage })));

/** Shown while a page chunk is in flight. Matches the auth loading state. */
const PageFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-[#161616] border-t-transparent rounded-full animate-spin"></div>
  </div>
);

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
              {/* One boundary around the whole shell: the nav stays on screen
                  while the next page's chunk loads, instead of the layout
                  blinking out and back on every navigation. */}
              <Suspense fallback={<PageFallback />}>
                <AppShell />
              </Suspense>
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
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="daily-logs" element={<DailyLogsPage />} />
          <Route path="oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="guide" element={<GuidePage />} />
          {/* Everyone may see their OWN numbers; the backend scopes the rows
              and hides organisation analytics from non-SUPER_ADMINs. */}
          <Route path="insights" element={<InsightsPage />} />
          <Route
            path="deleted-leads"
            element={
              <ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}>
                <DeletedLeadsPage />
              </ProtectedRoute>
            }
          />

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
              <ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}>
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
