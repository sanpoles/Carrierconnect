import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getStoredUser } from '../services/api'

function getPortalLink() {
  const user = getStoredUser()
  if (!user) return '/login'
  if (user.role === 'admin') return '/admin/overview'
  if (user.role === 'counsellor') return '/counsellor/dashboard'
  return '/app/dashboard'
}

function PublicLayout() {
  const currentUser = getStoredUser()
  const navigate = useNavigate()
  const location = useLocation()

  function goToSection(sectionId: string) {
    if (location.pathname === '/') {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    navigate(`/#${sectionId}`)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">C</span>
          <span>Career<span>Connect</span></span>
        </Link>

        <nav className="navigation" aria-label="Public navigation">
          <button type="button" onClick={() => goToSection('services')}>Services</button>
          <button type="button" onClick={() => goToSection('how-it-works')}>How it works</button>
          <button type="button" onClick={() => goToSection('career-toolkit')}>Career Toolkit</button>
          <Link to="/organizations">For Organizations</Link>
        </nav>

        <div className="header-actions">
          {currentUser ? (
            <Link className="header-button" to={getPortalLink()}>Open Portal</Link>
          ) : (
            <>
              <Link className="login-button" to="/login">Login</Link>
              <Link className="header-button" to="/register">Create Account</Link>
            </>
          )}
        </div>
      </header>

      <Outlet />

      <footer>
        <Link className="brand footer-brand" to="/">
          <span className="brand-mark">C</span>
          <span>Career<span>Connect</span></span>
        </Link>
        <p>Career support, one focused next step at a time.</p>
        <span>CareerConnect Platform</span>
      </footer>
    </div>
  )
}

export default PublicLayout
