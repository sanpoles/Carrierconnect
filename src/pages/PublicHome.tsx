import { Link, Navigate, useNavigate } from 'react-router-dom'
import { getStoredUser } from '../services/api'
import '../styles/public-home.css'

const audiencePaths = [
  {
    title: 'Entering IT',
    copy: 'Clarify possible first-role directions, position skills and projects, and prepare for early-career conversations.',
  },
  {
    title: 'Growing in IT',
    copy: 'Identify stronger role direction, communicate impact, and prepare for broader responsibility.',
  },
  {
    title: 'Changing roles or stepping up in IT',
    copy: 'Position experience for a new role, senior opportunity, leadership path, or career shift.',
  },
]

const gains = [
  'Clearer direction',
  'Stronger positioning',
  'Clearer career story',
  'More confidence for career conversations and interviews',
]

const journeyStages = [
  {
    title: 'Start with where you are',
    copy: 'Share your background, projects, experience, strengths, and the kind of opportunity you want to prepare for.',
  },
  {
    title: 'Clarify the direction',
    copy: 'Use Career Guidance to identify a credible path and understand which strengths should lead your story.',
  },
  {
    title: 'Practise the conversation',
    copy: 'Use Mock Interviews to practise explaining skills, projects, experience, decisions, and readiness clearly.',
  },
]

function getPortalPath() {
  const currentUser = getStoredUser()
  if (!currentUser) return '/'
  if (currentUser.role === 'admin') return '/admin/overview'
  if (currentUser.role === 'counsellor') return '/counsellor/dashboard'
  return '/app/dashboard'
}

function PublicHome() {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  if (currentUser) return <Navigate to={getPortalPath()} replace />

  function beginService(service: 'career_counselling' | 'mock_interview') {
    navigate(`/register?service=${service}`)
  }

  return (
    <main className="public-home">
      <section className="landing-hero" id="overview" aria-labelledby="landing-hero-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">CAREER PREPARATION FOR IT ROLES</p>
          <h1 id="landing-hero-title">Make your next IT career move with clarity and confidence.</h1>
          <p className="landing-hero-description">
            CareerConnect helps you identify the right direction, position your strengths, and practise the
            conversations that help you move forward.
          </p>
          <p className="landing-hero-clarifier">
            For IT professionals changing roles, stepping up, or entering the field &mdash; career preparation, not
            technical training.
          </p>
          <div className="landing-hero-actions">
            <button className="landing-primary-action" type="button" onClick={() => navigate('/register')}>
              Create free account
            </button>
            <a className="landing-secondary-action" href="#how-it-works">
              Explore how CareerConnect works
            </a>
          </div>
        </div>

        <div className="landing-role-panel" aria-label="CareerConnect preparation focus">
          <p className="landing-panel-label">ROLE READINESS</p>
          <div>
            <span>Direction</span>
            <strong>Identify the right next move.</strong>
          </div>
          <div>
            <span>Positioning</span>
            <strong>Make your strengths easier to explain.</strong>
          </div>
          <div>
            <span>Practice</span>
            <strong>Prepare for IT career conversations.</strong>
          </div>
        </div>
      </section>

      <section className="landing-audience" id="who-careerconnect-helps" aria-labelledby="audience-title">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">WHO CAREERCONNECT HELPS</p>
          <h2 id="audience-title">Different IT career stages, one familiar challenge.</h2>
          <p>
            Whether you are entering IT, growing in your current path, or preparing to step into broader responsibility,
            CareerConnect helps you make your strengths easier to understand and explain.
          </p>
        </div>
        <div className="landing-audience-grid" aria-label="CareerConnect audience paths">
          {audiencePaths.map((path) => (
            <article className="landing-audience-card" key={path.title}>
              <h3>{path.title}</h3>
              <p>{path.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-gains" id="what-you-gain" aria-labelledby="gains-title">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">WHAT YOU GAIN</p>
          <h2 id="gains-title">What you gain from focused IT career preparation.</h2>
        </div>
        <div className="landing-gain-grid" aria-label="CareerConnect preparation outcomes">
          {gains.map((gain) => (
            <article className="landing-gain-card" key={gain}>
              <span aria-hidden="true">&bull;</span>
              <h3>{gain}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-services" id="services" aria-labelledby="services-title">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">HOW CAREERCONNECT HELPS</p>
          <h2 id="services-title">Two services, one preparation path.</h2>
          <p>Career Guidance helps clarify and shape the story. Mock Interviews help practise saying it clearly.</p>
        </div>
        <div className="landing-service-grid">
          <article className="landing-service-card">
            <p>CAREER GUIDANCE</p>
            <h3>Find direction and shape your story.</h3>
            <p>
              Helps users identify a credible direction, understand which strengths to highlight, and build a clearer
              career story.
            </p>
            <button type="button" onClick={() => beginService('career_counselling')}>
              Request career guidance
            </button>
          </article>
          <article className="landing-service-card landing-service-card-accent">
            <p>MOCK INTERVIEWS</p>
            <h3>Practise IT-role conversations.</h3>
            <p>
              Helps users practise explaining skills, projects, experience, decisions, and readiness for IT roles.
            </p>
            <button type="button" onClick={() => beginService('mock_interview')}>
              Request mock interview
            </button>
          </article>
        </div>
      </section>

      <section className="landing-journey" id="how-it-works" aria-labelledby="journey-title">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">HOW IT WORKS</p>
          <h2 id="journey-title">A simple preparation journey.</h2>
          <p>CareerConnect helps you move from uncertainty to a clearer story you can practise and improve.</p>
        </div>
        <div className="landing-journey-flow" aria-label="CareerConnect preparation journey">
          {journeyStages.map((stage, index) => (
            <article className="landing-journey-card" key={stage.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{stage.title}</h3>
              <p>{stage.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-final-cta" aria-labelledby="final-cta-title">
        <div>
          <p className="landing-eyebrow">READY FOR FOCUSED SUPPORT?</p>
          <h2 id="final-cta-title">Ready to prepare for your next IT career conversation?</h2>
          <p>Create a free account when you are ready to request guidance or practise for an IT-role interview.</p>
        </div>
        <Link className="landing-final-link" to="/register">
          Create free account
        </Link>
        <a href="#how-it-works">Explore how CareerConnect works</a>
      </section>
    </main>
  )
}

export default PublicHome
