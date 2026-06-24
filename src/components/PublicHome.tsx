import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { getStoredUser } from '../services/api'

function getPortalPath() {
  const user = getStoredUser()
  if (!user) return '/'
  if (user.role === 'admin') return '/admin/overview'
  if (user.role === 'counsellor') return '/counsellor/dashboard'
  return '/app/dashboard'
}

function PublicHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentUser = getStoredUser()

  useEffect(() => {
    const section = location.hash.replace('#', '')
    if (!section) return
    const timer = window.setTimeout(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [location.hash])

  if (currentUser) return <Navigate to={getPortalPath()} replace />

  function startRequest(service: 'career_counselling' | 'mock_interview') {
    navigate(`/register?service=${service}`)
  }

  return (
    <main>
      <section className="hero-section" id="home">
        <div className="hero-content">
          <p className="eyebrow">CAREER GUIDANCE MADE PRACTICAL</p>
          <h1>Take the next step<span> in your career.</span></h1>
          <p className="hero-description">Get personalised career guidance, interview practice, and practical resources to move forward with confidence.</p>
          <div className="hero-actions">
            <a className="primary-button" href="#services">Explore support options</a>
            <a className="text-button" href="#career-toolkit">Explore the Career Toolkit <span>→</span></a>
          </div>
          <div className="hero-stats">
            <div><strong>1:1</strong><span>Personal guidance</span></div>
            <div><strong>Toolkit</strong><span>Practical career resources</span></div>
            <div><strong>Secure</strong><span>Account-based requests</span></div>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-label">YOUR CAREER JOURNEY</div>
          <div className="journey-step active"><span className="step-number">01</span><div><strong>Choose your support</strong><p>Counselling or mock interview</p></div><span className="step-check">✓</span></div>
          <div className="journey-line" />
          <div className="journey-step"><span className="step-number">02</span><div><strong>Share your goals</strong><p>Tell us what you need help with</p></div></div>
          <div className="journey-line" />
          <div className="journey-step"><span className="step-number">03</span><div><strong>Receive guidance</strong><p>Track updates, sessions, and feedback</p></div></div>
          <div className="panel-note"><span>✦</span> Start with one clear next step.</div>
        </div>
      </section>

      <section className="services-section" id="services">
        <div className="section-heading">
          <p className="eyebrow">SUPPORT OPTIONS</p>
          <h2>Choose what you need right now.</h2>
          <p>Start with a service need, then create an account or log in using the same email to securely continue your request.</p>
        </div>
        <div className="service-grid">
          <article className="service-card">
            <div className="service-icon">✦</div><p className="service-type">GUIDANCE SESSION</p><h3>Career Counselling</h3>
            <p>Get help with career direction, role transition, CV improvement, job search planning, and interview preparation.</p>
            <ul><li>Career direction and next steps</li><li>CV and profile feedback</li><li>Job search planning</li></ul>
            <button className="service-button" type="button" onClick={() => startRequest('career_counselling')}>Request Career Counselling <span>→</span></button>
          </article>
          <article className="service-card featured-card">
            <div className="featured-badge">MOST REQUESTED</div><div className="service-icon">◎</div><p className="service-type">PRACTICE SESSION</p><h3>Mock Interview</h3>
            <p>Practise your interview in a realistic format and receive focused feedback on answers, confidence, and communication.</p>
            <ul><li>Technical or HR interview practice</li><li>Answer and communication feedback</li><li>Preparation recommendations</li></ul>
            <button className="service-button dark-button" type="button" onClick={() => startRequest('mock_interview')}>Request Mock Interview <span>→</span></button>
          </article>
        </div>
      </section>

      <section className="how-it-works-section" id="how-it-works">
        <div className="section-heading compact-heading"><p className="eyebrow">HOW IT WORKS</p><h2>Start with your need. Keep everything in one workspace.</h2></div>
        <div className="process-grid">
          <div className="process-card"><span>01</span><h3>Choose a service</h3><p>Start from Career Counselling or Mock Interview, then share the support you need.</p></div>
          <div className="process-card"><span>02</span><h3>Create an account or log in</h3><p>Use the same email so your service request, messages, and sessions stay linked securely.</p></div>
          <div className="process-card"><span>03</span><h3>Track the journey</h3><p>Open My Workspace to see counsellor assignment, messages, sessions, and progress.</p></div>
        </div>
      </section>

      <section className="career-toolkit-section" id="career-toolkit">
        <div className="section-heading">
          <p className="eyebrow">CAREER TOOLKIT</p>
          <h2>Practical frameworks for your next move.</h2>
          <p>Explore useful career resources now. Create a free account to request personalised guidance when you are ready.</p>
        </div>
        <div className="toolkit-grid">
          <article><span>01</span><h3>Career Direction Framework</h3><p>Clarify role options, strengths, constraints, and your next realistic move.</p></article>
          <article><span>02</span><h3>STAR Answer Planner</h3><p>Build structured, evidence-based interview stories that show impact.</p></article>
          <article><span>03</span><h3>Impact Statement Checklist</h3><p>Turn responsibilities into achievements for your CV and LinkedIn profile.</p></article>
          <article><span>04</span><h3>Weekly Job Search Planner</h3><p>Create a consistent, measurable rhythm for applications, networking, and preparation.</p></article>
        </div>
      </section>

      <section className="organization-callout-section">
        <div><p className="eyebrow">FOR ORGANIZATIONS</p><h2>Build stronger teams, leaders, and talent pipelines.</h2><p>Explore hiring support, leadership development, internal mobility, and tailored workforce programs.</p></div>
        <Link className="primary-button" to="/organizations">Explore organization services <span>→</span></Link>
      </section>

      <section className="login-prompt-section">
        <div><p className="eyebrow">READY TO BEGIN?</p><h2>Create a free account when you are ready for personalised support.</h2><p>Your requests, conversations, sessions, and feedback stay linked securely to your CareerConnect account.</p></div>
        <button className="primary-button button-reset" type="button" onClick={() => navigate('/register')}>Create CareerConnect Account</button>
      </section>
    </main>
  )
}

export default PublicHome
