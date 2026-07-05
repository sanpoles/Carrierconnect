import { Link } from 'react-router-dom'
import '../styles/who-we-are.css'

const lessons = [
  'Capable professionals can still struggle with career direction.',
  'Strong delivery experience does not automatically become a strong career story.',
  'Technical capability alone does not always make the next move clear.',
]

const guidancePrinciples = [
  "Start with the person's real background.",
  'Connect strengths and experience to credible role direction.',
  'Keep guidance practical, grounded, and role-relevant.',
]

function WhoWeArePage() {
  return (
    <main className="who-page">
      <section className="who-hero" aria-labelledby="who-hero-title">
        <div>
          <p className="who-eyebrow">THE PEOPLE BEHIND CAREERCONNECT</p>
          <h1 id="who-hero-title">Experience that understands the journey.</h1>
          <p>
            CareerConnect is shaped by people who have worked across IT operations, infrastructure, enterprise
            platforms, delivery, automation, cloud operations, and technical leadership&mdash;and who have seen how
            difficult career decisions can be, even for capable professionals.
          </p>
        </div>
      </section>

      <section className="who-story" aria-labelledby="who-story-title">
        <div className="who-section-heading">
          <p className="who-eyebrow">WHY WE CREATED CAREERCONNECT</p>
          <h2 id="who-story-title">Built for the moments technical skill is not enough.</h2>
          <p>
            We created CareerConnect for people who know the work, but need clearer direction, stronger positioning, or
            more confidence explaining why they are ready for the next opportunity.
          </p>
        </div>
      </section>

      <section className="who-profiles" aria-labelledby="who-profiles-title">
        <div className="who-section-heading">
          <p className="who-eyebrow">FOUNDER AND TEAM PROFILES</p>
          <h2 id="who-profiles-title">Real profiles will sit here.</h2>
          <p>These placeholders are reserved for real photos, names, roles, biographies, and profile links.</p>
        </div>
        <article className="who-founder-card">
          <div className="who-founder-photo" aria-label="Founder photo placeholder">
            [Founder photo]
          </div>
          <div className="who-founder-copy">
            <p className="who-placeholder">Founder profile placeholder</p>
            <h3>[Founder name]</h3>
            <p className="who-founder-role">[Founder role]</p>
            <p>[Founder biography]</p>
            <a href="https://www.linkedin.com" target="_blank" rel="noreferrer">
              [LinkedIn profile link]
            </a>
          </div>
        </article>
      </section>

      <section className="who-lessons" aria-labelledby="who-lessons-title">
        <div className="who-section-heading">
          <p className="who-eyebrow">WHAT OUR EXPERIENCE HAS TAUGHT US</p>
          <h2 id="who-lessons-title">The career challenge is often about translation.</h2>
        </div>
        <div className="who-card-grid">
          {lessons.map((lesson) => (
            <article key={lesson}>
              <span aria-hidden="true">&bull;</span>
              <p>{lesson}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="who-guidance" aria-labelledby="who-guidance-title">
        <div className="who-section-heading">
          <p className="who-eyebrow">HOW THAT SHAPES OUR GUIDANCE</p>
          <h2 id="who-guidance-title">Practical, grounded, role-relevant support.</h2>
          <p>
            CareerConnect guidance is based on the person's real background, strengths, experience, and direction,
            not generic advice or one-path-fits-all messaging.
          </p>
        </div>
        <ul>
          {guidancePrinciples.map((principle) => (
            <li key={principle}>{principle}</li>
          ))}
        </ul>
      </section>

      <section className="who-final-cta" aria-labelledby="who-final-title">
        <div>
          <p className="who-eyebrow">READY FOR FOCUSED SUPPORT?</p>
          <h2 id="who-final-title">Prepare for your next IT career conversation.</h2>
        </div>
        <Link className="who-primary-link" to="/register">
          Create free account
        </Link>
        <Link className="who-secondary-link" to="/#how-it-works">
          See how CareerConnect works
        </Link>
      </section>
    </main>
  )
}

export default WhoWeArePage
