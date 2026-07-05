import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import './styles/app-shell.css'
import AppShell from './components/AppShell'
import ProtectedRoute from './components/ProtectedRoute'
import PublicLayout from './components/PublicLayout'
import AuthPage from './pages/AuthPage'
import PublicHome from './pages/PublicHome'
import CareerToolkitPage from './pages/CareerToolkitPage'
import ToolkitResourcePage from './pages/ToolkitResourcePage'
import OrganizationsPage from './pages/OrganizationsPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import RolePortal from './pages/RolePortal'
import UserPortal from './pages/UserPortal'
import WhoWeArePage from './pages/WhoWeArePage'
import { getStoredUser } from './services/api'

function getDefaultPortalPath() {
  const user = getStoredUser()
  if (!user) return '/'
  if (user.role === 'admin') return '/admin/overview'
  if (user.role === 'counsellor') return '/counsellor/dashboard'
  return '/app/dashboard'
}

function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<PublicHome />} />
        <Route path="/who-we-are" element={<WhoWeArePage />} />
        <Route path="/career-toolkit" element={<CareerToolkitPage />} />
        <Route path="/career-toolkit/:categorySlug" element={<CareerToolkitPage />} />
        <Route path="/career-toolkit/resources/:resourceSlug" element={<ToolkitResourcePage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot-password" />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={['user']} />}><Route element={<AppShell />}>
        <Route path="/app/dashboard" element={<UserPortal page="dashboard" />} />
        <Route path="/app/requests" element={<UserPortal page="requests" />} />
        <Route path="/app/workspace" element={<UserPortal page="workspace" />} />
        <Route path="/app/sessions" element={<UserPortal page="sessions" />} />
        <Route path="/app/notifications" element={<UserPortal page="notifications" />} />
        <Route path="/app/toolkit" element={<UserPortal page="toolkit" />} />
        <Route path="/app/account" element={<UserPortal page="account" />} />
      </Route></Route>
      <Route element={<ProtectedRoute allowedRoles={['counsellor']} />}><Route element={<AppShell />}>
        <Route path="/counsellor/dashboard" element={<RolePortal role="counsellor" />} />
      </Route></Route>
      <Route element={<ProtectedRoute allowedRoles={['admin']} />}><Route element={<AppShell />}>
        <Route path="/admin/overview" element={<RolePortal role="admin" />} />
      </Route></Route>
      <Route path="*" element={<Navigate to={getDefaultPortalPath()} replace />} />
    </Routes>
  )
}

export default App
