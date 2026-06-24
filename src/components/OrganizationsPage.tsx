import { useState, type FormEvent } from 'react'
import { organizationInquiryApi } from '../services/api'
import '../styles/organizations.css'

type FormState = {
  organizationName: string; contactName: string; workEmail: string; phone: string
  countryOrRegion: string; organizationSize: string; supportArea: 'hiring_talent_support' | 'leadership_development' | 'career_internal_mobility' | 'custom_workforce_program' | 'not_sure_yet'
  targetAudience: string; expectedScope: string; desiredTimeline: string; currentChallenge: string
  successOutcome: string; preferredDiscussionTime: string; contactPreference: 'email' | 'phone' | 'either'
}

const initialForm: FormState = {
  organizationName:'', contactName:'', workEmail:'', phone:'', countryOrRegion:'', organizationSize:'',
  supportArea:'not_sure_yet', targetAudience:'', expectedScope:'', desiredTimeline:'',
  currentChallenge:'', successOutcome:'', preferredDiscussionTime:'', contactPreference:'email',
}

function OrganizationsPage() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmitting(true)
    try {
      const response = await organizationInquiryApi.create(form)
      setSuccessMessage(response.message)
      setForm(initialForm)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to send your enquiry. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="organizations-page">
      <section className="organizations-hero">
        <div>
          <p className="eyebrow">CAREERCONNECT FOR ORGANIZATIONS</p>
          <h1>Build stronger teams, leaders, and talent pipelines.</h1>
          <p>CareerConnect partners with organizations that need practical hiring support, leadership development, internal mobility, and workforce capability programs.</p>
          <div className="organizations-hero-actions">
            <a className="primary-button" href="#organization-enquiry">Request a discussion <span>→</span></a>
            <a className="text-button" href="#organization-services">Explore services <span>→</span></a>
          </div>
        </div>
        <aside className="organizations-outcomes-card">
          <p>WHAT WE HELP IMPROVE</p>
          <strong>More confident leaders.</strong>
          <strong>Stronger interview capability.</strong>
          <strong>Clearer employee growth paths.</strong>
          <strong>Targeted workforce development.</strong>
        </aside>
      </section>

      <section className="organization-services-section" id="organization-services">
        <div className="section-heading"><p className="eyebrow">ORGANIZATION SERVICES</p><h2>Support that connects people decisions to business outcomes.</h2></div>
        <div className="organization-service-grid">
          <article><span>01</span><h3>Hiring and Talent Support</h3><p>Build more consistent hiring decisions and targeted talent pipelines.</p><ul><li>Candidate sourcing and role-based talent support</li><li>Interview-panel capability and structured interviewing</li><li>Role, competency, and assessment support</li></ul></article>
          <article><span>02</span><h3>Leadership Development</h3><p>Prepare leaders for the situations that define team performance.</p><ul><li>First-time manager foundations</li><li>Mid-level manager development</li><li>Senior leader transitions and coaching</li></ul></article>
          <article><span>03</span><h3>Career Growth and Internal Mobility</h3><p>Help employees see and prepare for meaningful next opportunities.</p><ul><li>Career-pathing and internal mobility workshops</li><li>High-potential employee development</li><li>Mentoring-program design</li></ul></article>
          <article><span>04</span><h3>Custom Workforce Programs</h3><p>Design focused learning or capability programs around your business context.</p><ul><li>Leadership offsites and workshops</li><li>Cohort-based development programs</li><li>Organization-specific capability programs</li></ul></article>
        </div>
      </section>

      <section className="organization-value-section">
        <div><p className="eyebrow">HOW WE ADD VALUE</p><h2>Practical programs, not generic training.</h2></div>
        <div className="organization-value-list">
          <span>Align development activity to real management and talent challenges.</span>
          <span>Build confidence through frameworks, practice, and feedback.</span>
          <span>Create a clear path from discovery conversation to a tailored program.</span>
          <span>Work with your timeline, audience, and delivery constraints.</span>
        </div>
      </section>

      <section className="organization-enquiry-section" id="organization-enquiry">
        <div className="organization-enquiry-intro">
          <p className="eyebrow">START A CONVERSATION</p>
          <h2>Tell us what your organization needs.</h2>
          <p>Share the challenge, audience, and intended outcome. We will review your enquiry and arrange the right next conversation.</p>
          <div className="organization-enquiry-note"><strong>Examples:</strong> Fill critical roles, prepare first-time managers, improve internal mobility, develop mid-to-senior leaders, or design a custom workforce program.</div>
        </div>

        <form className="organization-enquiry-form" onSubmit={submit}>
          {errorMessage && <div className="organization-alert error">{errorMessage}</div>}
          {successMessage && <div className="organization-alert success">{successMessage}</div>}
          <div className="organization-form-grid">
            <label>Organization name<input required value={form.organizationName} onChange={(e)=>update('organizationName', e.target.value)} /></label>
            <label>Your name<input required value={form.contactName} onChange={(e)=>update('contactName', e.target.value)} /></label>
            <label>Work email<input required type="email" value={form.workEmail} onChange={(e)=>update('workEmail', e.target.value)} /></label>
            <label>Phone number<input value={form.phone} onChange={(e)=>update('phone', e.target.value)} /></label>
            <label>Country or region<input value={form.countryOrRegion} onChange={(e)=>update('countryOrRegion', e.target.value)} /></label>
            <label>Organization size<select value={form.organizationSize} onChange={(e)=>update('organizationSize', e.target.value)}><option value="">Select size</option><option>1–50</option><option>51–250</option><option>251–1,000</option><option>1,001–5,000</option><option>5,000+</option></select></label>
            <label>Area of support<select value={form.supportArea} onChange={(e)=>update('supportArea', e.target.value as FormState['supportArea'])}><option value="not_sure_yet">Not sure yet</option><option value="hiring_talent_support">Hiring and talent support</option><option value="leadership_development">Leadership development</option><option value="career_internal_mobility">Career growth and internal mobility</option><option value="custom_workforce_program">Custom workforce program</option></select></label>
            <label>Target audience<input placeholder="For example: first-time managers" value={form.targetAudience} onChange={(e)=>update('targetAudience', e.target.value)} /></label>
            <label>Expected scope<input placeholder="For example: 40 managers / 6 open roles" value={form.expectedScope} onChange={(e)=>update('expectedScope', e.target.value)} /></label>
            <label>Desired timeline<input placeholder="For example: start in Q3" value={form.desiredTimeline} onChange={(e)=>update('desiredTimeline', e.target.value)} /></label>
          </div>
          <label>What challenge are you trying to solve?<textarea required rows={5} value={form.currentChallenge} onChange={(e)=>update('currentChallenge', e.target.value)} placeholder="Describe the current context, challenge, or request." /></label>
          <label>What would success look like?<textarea rows={3} value={form.successOutcome} onChange={(e)=>update('successOutcome', e.target.value)} placeholder="Optional" /></label>
          <div className="organization-form-grid">
            <label>Preferred discussion time<input value={form.preferredDiscussionTime} onChange={(e)=>update('preferredDiscussionTime', e.target.value)} placeholder="For example: weekday afternoons IST" /></label>
            <label>Preferred contact method<select value={form.contactPreference} onChange={(e)=>update('contactPreference', e.target.value as FormState['contactPreference'])}><option value="email">Email</option><option value="phone">Phone</option><option value="either">Either</option></select></label>
          </div>
          <button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? 'Sending enquiry...' : 'Request a discussion'} <span>→</span></button>
        </form>
      </section>
    </main>
  )
}

export default OrganizationsPage
