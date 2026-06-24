import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  careerProfileApi,
  type CareerProfile,
  type ResumeDocument,
} from '../services/api'
import '../styles/career-profile.css'

type CareerProfilePanelProps = {
  onProfileSaved?: (profile: CareerProfile, resumeUploaded: boolean) => void
}

const blankProfile: CareerProfile = {
  professionalSummary: '',
  currentJobTitle: '',
  industry: '',
  yearsOfExperience: null,
  targetRole: '',
  skills: [],
  careerGoals: '',
  linkedinUrl: '',
}

function isProfileComplete(profile: CareerProfile) {
  return Boolean(
    profile.professionalSummary.trim() &&
      profile.currentJobTitle.trim() &&
      profile.industry.trim() &&
      profile.yearsOfExperience !== null &&
      profile.yearsOfExperience !== undefined &&
      profile.targetRole.trim() &&
      profile.skills.length > 0 &&
      profile.careerGoals.trim(),
  )
}

function CareerProfilePanel({ onProfileSaved }: CareerProfilePanelProps) {
  const [profile, setProfile] = useState<CareerProfile>(blankProfile)
  const [skillsInput, setSkillsInput] = useState('')
  const [resume, setResume] = useState<ResumeDocument | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const profileComplete = useMemo(() => isProfileComplete(profile), [profile])

  useEffect(() => {
    let active = true

    async function loadProfile() {
      setIsLoading(true)
      setError('')

      try {
        const response = await careerProfileApi.get()
        if (!active) return

        setProfile(response.profile)
        setSkillsInput(response.profile.skills.join(', '))
        setResume(response.resume)
        setIsEditing(!isProfileComplete(response.profile))
      } catch (loadError) {
        if (!active) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load Career Profile.',
        )
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void loadProfile()

    return () => {
      active = false
    }
  }, [])

  function beginEditing() {
    setError('')
    setSuccess('')
    setSelectedFile(null)
    setIsEditing(true)
  }

  function cancelEditing() {
    if (!profileComplete) return
    setError('')
    setSuccess('')
    setSelectedFile(null)
    setSkillsInput(profile.skills.join(', '))
    setIsEditing(false)
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')

    try {
      // Keep UI-only metadata such as updatedAt out of the strict backend request schema.
      const savedProfileResponse = await careerProfileApi.save({
        professionalSummary: profile.professionalSummary,
        currentJobTitle: profile.currentJobTitle,
        industry: profile.industry,
        yearsOfExperience: profile.yearsOfExperience,
        targetRole: profile.targetRole,
        skills: skillsInput
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        careerGoals: profile.careerGoals,
        linkedinUrl: profile.linkedinUrl,
      })

      let nextResume = resume
      if (selectedFile) {
        const uploadResponse = await careerProfileApi.uploadResume(selectedFile)
        nextResume = uploadResponse.resume
        setResume(nextResume)
        setSelectedFile(null)
      }

      setProfile(savedProfileResponse.profile)
      setSkillsInput(savedProfileResponse.profile.skills.join(', '))
      onProfileSaved?.(savedProfileResponse.profile, Boolean(nextResume))
      setSuccess(
        nextResume
          ? 'Career Profile and resume saved successfully.'
          : 'Career Profile saved successfully. You can upload a resume later if you choose.',
      )
      setIsEditing(false)
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save Career Profile.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <section className="career-profile-panel">
        <div className="portal-loading-panel">Loading Career Profile…</div>
      </section>
    )
  }

  return (
    <section className="career-profile-panel">
      <div className="portal-card-heading">
        <div>
          <span>CAREER PROFILE</span>
          <h2>{profileComplete && !isEditing ? 'Your Career Profile' : 'Help your counsellor prepare'}</h2>
        </div>

        {profileComplete && !isEditing && (
          <button className="portal-secondary-action" type="button" onClick={beginEditing}>
            Edit Career Profile →
          </button>
        )}
      </div>

      {!profileComplete || isEditing ? (
        <p className="career-profile-intro">
          Complete the required details before submitting a support request. Your resume is optional,
          but uploading it can help your assigned counsellor provide more relevant feedback.
        </p>
      ) : (
        <p className="career-profile-intro">
          Your required Career Profile details are complete. Your assigned counsellor can use this information
          to prepare before the first session.
        </p>
      )}

      {error && <div className="career-profile-alert error">{error}</div>}
      {success && <div className="career-profile-alert success">{success}</div>}

      {profileComplete && !isEditing ? (
        <div className="career-profile-summary">
          <div className="portal-summary-request-list">
            <article>
              <div>
                <strong>Career Profile</strong>
                <span>Required details completed</span>
              </div>
              <span className="portal-status status-completed">Complete</span>
            </article>
            <article>
              <div>
                <strong>Resume</strong>
                <span>{resume ? resume.originalFileName : 'Optional — not uploaded'}</span>
              </div>
              <span className={`portal-status ${resume ? 'status-completed' : 'status-assigned'}`}>
                {resume ? 'Uploaded' : 'Optional'}
              </span>
            </article>
          </div>

          <div className="workspace-summary-card">
            <h4>Professional summary</h4>
            <p>{profile.professionalSummary}</p>
            <div className="workspace-summary-grid">
              <span><strong>Current role</strong>{profile.currentJobTitle}</span>
              <span><strong>Industry</strong>{profile.industry}</span>
              <span><strong>Experience</strong>{profile.yearsOfExperience} years</span>
              <span><strong>Target role</strong>{profile.targetRole}</span>
              <span><strong>Skills</strong>{profile.skills.join(', ')}</span>
              <span><strong>LinkedIn</strong>{profile.linkedinUrl || 'Not provided'}</span>
            </div>
          </div>

          <div className="workspace-summary-card">
            <h4>Career goals</h4>
            <p>{profile.careerGoals}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={saveProfile} className="career-profile-form">
          <label>
            Professional summary
            <textarea
              required
              rows={4}
              value={profile.professionalSummary}
              onChange={(event) =>
                setProfile({ ...profile, professionalSummary: event.target.value })
              }
              placeholder="Briefly describe your background and where you need support."
            />
          </label>

          <div className="career-profile-grid">
            <label>
              Current role
              <input
                required
                value={profile.currentJobTitle}
                onChange={(event) =>
                  setProfile({ ...profile, currentJobTitle: event.target.value })
                }
              />
            </label>

            <label>
              Industry
              <input
                required
                value={profile.industry}
                onChange={(event) => setProfile({ ...profile, industry: event.target.value })}
              />
            </label>

            <label>
              Years of experience
              <input
                required
                type="number"
                min="0"
                max="60"
                value={profile.yearsOfExperience ?? ''}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    yearsOfExperience: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>

            <label>
              Target role
              <input
                required
                value={profile.targetRole}
                onChange={(event) => setProfile({ ...profile, targetRole: event.target.value })}
              />
            </label>
          </div>

          <label>
            Skills
            <input
              required
              value={skillsInput}
              onChange={(event) => setSkillsInput(event.target.value)}
              placeholder="Cloud, project delivery, stakeholder management"
            />
          </label>

          <label>
            Career goals
            <textarea
              required
              rows={3}
              value={profile.careerGoals}
              onChange={(event) => setProfile({ ...profile, careerGoals: event.target.value })}
            />
          </label>

          <label>
            LinkedIn URL <span>(optional)</span>
            <input
              type="url"
              value={profile.linkedinUrl}
              onChange={(event) => setProfile({ ...profile, linkedinUrl: event.target.value })}
            />
          </label>

          <label>
            Resume <span>(optional — PDF, DOC, or DOCX, maximum 5 MB)</span>
            <input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
            {resume && <small>Current file: {resume.originalFileName}</small>}
          </label>

          <div className="career-profile-actions">
            <button className="portal-primary-action" disabled={busy} type="submit">
              {busy ? 'Saving…' : profileComplete ? 'Save changes' : 'Save Career Profile'} <span>→</span>
            </button>

            {profileComplete && (
              <button className="portal-secondary-action" type="button" onClick={cancelEditing} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

export default CareerProfilePanel
