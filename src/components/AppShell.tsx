import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  clearAuthSession,
  getStoredUser,
  type AuthUser,
} from '../services/api'
import RealtimeBridge from './RealtimeBridge'

type NavigationItem = {
  label: string
  to: string
  symbol: string
}

function getNavigationItems(user: AuthUser): NavigationItem[] {
  if (user.role === 'admin') {
    return [
      {
        label: 'Admin Overview',
        to: '/admin/overview',
        symbol: '◈',
      },
    ]
  }

  if (user.role === 'counsellor') {
    return [
      {
        label: 'Dashboard',
        to: '/counsellor/dashboard',
        symbol: '◈',
      },
    ]
  }

  return [
    {
      label: 'Dashboard',
      to: '/app/dashboard',
      symbol: '◈',
    },
    {
      label: 'My Requests',
      to: '/app/requests',
      symbol: '◫',
    },
    {
      label: 'Messages & Workspace',
      to: '/app/workspace',
      symbol: '◌',
    },
    {
      label: 'Sessions',
      to: '/app/sessions',
      symbol: '◷',
    },
    {
      label: 'Notifications',
      to: '/app/notifications',
      symbol: '◉',
    },
    {
      label: 'My Account',
      to: '/app/account',
      symbol: '◍',
    },
  ]
}

function getRoleLabel(role: AuthUser['role']) {
  if (role === 'admin') {
    return 'Platform Administrator'
  }

  if (role === 'counsellor') {
    return 'Career Counsellor'
  }

  return 'CareerConnect User'
}

function AppShell() {
  const navigate = useNavigate()
  const currentUser = getStoredUser()

  if (!currentUser) {
    return null
  }

  const navigationItems = getNavigationItems(currentUser)

  function handleLogout() {
    clearAuthSession()
    navigate('/', { replace: true })
  }

  return (
    <div className="portal-shell">
      <RealtimeBridge currentUser={currentUser} />

      <aside className="portal-sidebar">
        <div className="portal-brand-area">
          <NavLink className="portal-brand" to={navigationItems[0].to}>
            <span className="portal-brand-mark">C</span>
            <span>
              Career<span>Connect</span>
            </span>
          </NavLink>

          <span className="portal-role-label">{getRoleLabel(currentUser.role)}</span>
        </div>

        <nav className="portal-navigation" aria-label="Portal navigation">
          {navigationItems.map((item) => (
            <NavLink
              className={({ isActive }) =>
                `portal-navigation-link${isActive ? ' active' : ''}`
              }
              key={item.to}
              to={item.to}
            >
              <span className="portal-navigation-icon">{item.symbol}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="portal-sidebar-bottom">
          <div className="portal-user-card">
            <div className="portal-user-avatar">
              {currentUser.fullName.charAt(0).toUpperCase()}
            </div>

            <div>
              <strong>{currentUser.fullName}</strong>
              <span>{currentUser.email}</span>
            </div>
          </div>

          <button
            className="portal-logout-button"
            type="button"
            onClick={handleLogout}
          >
            <span>↪</span>
            Logout
          </button>
        </div>
      </aside>

      <div className="portal-main-area">
        <header className="portal-topbar">
          <div>
            <span className="portal-topbar-caption">CAREERCONNECT PORTAL</span>
            <strong>{currentUser.fullName.split(' ')[0]}'s Workspace</strong>
          </div>

          <div className="portal-topbar-status">
            <span className="portal-status-dot" />
            Secure session active
          </div>
        </header>

        <main className="portal-page-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppShell