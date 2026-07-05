import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { getStoredUser } from '../services/api'
import '../styles/public-navigation.css'

const homeSections = [
  ['overview', 'Overview'],
  ['who-careerconnect-helps', 'Who CareerConnect Helps'],
  ['what-you-gain', 'What You Gain'],
  ['services', 'How CareerConnect Helps'],
  ['how-it-works', 'How It Works'],
] as const

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
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)
  const homeMenuRef = useRef<HTMLDivElement>(null)

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function goToHomeSection(sectionId: string) {
    setHomeMenuOpen(false)
    if (location.pathname === '/') {
      scrollToSection(sectionId)
      window.history.replaceState(null, '', `/#${sectionId}`)
      return
    }
    navigate(`/#${sectionId}`)
  }

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  useEffect(() => {
    if (location.pathname !== '/') {
      window.scrollTo({ top: 0, left: 0 })
      return
    }

    if (!location.hash) {
      window.scrollTo({ top: 0, left: 0 })
      return
    }

    const sectionId = location.hash.replace('#', '')
    window.setTimeout(() => scrollToSection(sectionId), 0)
  }, [location.pathname, location.hash])

  useEffect(() => {
    if (!homeMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (!homeMenuRef.current?.contains(event.target as Node)) setHomeMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setHomeMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [homeMenuOpen])

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">C</span>
          <span>Career<span>Connect</span></span>
        </Link>

        <nav className="navigation public-navigation" aria-label="Public navigation">
          <div
            className="home-menu"
            ref={homeMenuRef}
            onMouseEnter={() => setHomeMenuOpen(true)}
            onMouseLeave={() => setHomeMenuOpen(false)}
          >
            <Link className="home-link" to="/" onClick={() => setHomeMenuOpen(false)}>Home</Link>
            <button
              aria-controls="home-section-menu"
              aria-expanded={homeMenuOpen}
              aria-label="Show Home page sections"
              className="home-menu-toggle"
              type="button"
              onClick={() => setHomeMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">▾</span>
            </button>
            <div className="home-menu-panel" data-open={homeMenuOpen} id="home-section-menu" role="menu">
              {homeSections.map(([sectionId, label]) => (
                <button
                  key={sectionId}
                  role="menuitem"
                  type="button"
                  onClick={() => goToHomeSection(sectionId)}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <Link to="/who-we-are">Who We Are</Link>
          <Link to="/career-toolkit">Career Toolkit</Link>
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
