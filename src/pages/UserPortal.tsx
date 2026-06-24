import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import UserWorkspace from '../components/UserWorkspace'
import CareerProfilePanel from '../components/CareerProfilePanel'
import {
  careerProfileApi,
  getStoredUser,
  notificationApi,
  requestApi,
  sessionApi,
  type CareerNotification,
  type CareerProfile,
  type CareerRequest,
  type CareerSession,
} from '../services/api'

type UserPortalPage =
  | 'dashboard'
  | 'requests'
  | 'workspace'
  | 'sessions'
  | 'notifications'
  | 'account'

type UserPortalProps = {
  page: UserPortalPage
}

type RequestFormState = {
  currentJobTitle: string
  industry: string
  yearsOfExperience: string
  targetRole: string
  skills: string
  preferredDate: string
  preferredTimeSlot: string
  description: string
}

const initialRequestForm: RequestFormState = {
  currentJobTitle: '',
  industry: '',
  yearsOfExperience: '',
  targetRole: '',
  skills: '',
  preferredDate: '',
  preferredTimeSlot: '',
  description: '',
}

function getRequestName(requestType: CareerRequest['requestType']) {
  return requestType === 'career_counselling'
    ? 'Career Counselling'
    : 'Mock Interview'
}

function getStatusLabel(status: CareerRequest['status']) {
  return status.replaceAll('_', ' ')
}

function isCareerProfileComplete(profile: CareerProfile | null) {
  return Boolean(
    profile &&
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

function UserPortal({ page }: UserPortalProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentUser = getStoredUser()

  const serviceFromUrl = new URLSearchParams(location.search).get('service')
  const requestIdFromUrl = new URLSearchParams(location.search).get('requestId')

  const [requests, setRequests] = useState<CareerRequest[]>([])
  const [notifications, setNotifications] = useState<CareerNotification[]>([])
  const [sessions, setSessions] = useState<CareerSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [selectedService, setSelectedService] = useState(
    serviceFromUrl === 'mock_interview'
      ? 'Mock Interview'
      : serviceFromUrl === 'career_counselling'
        ? 'Career Counselling'
        : '',
  )
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false)
  const [requestForm, setRequestForm] =
    useState<RequestFormState>(initialRequestForm)

  const [careerProfile, setCareerProfile] = useState<CareerProfile | null>(null)
  const [hasResume, setHasResume] = useState(false)
  const [isLoadingCareerProfile, setIsLoadingCareerProfile] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadCareerProfile() {
      setIsLoadingCareerProfile(true)

      try {
        const response = await careerProfileApi.get()

        if (isMounted) {
          setCareerProfile(response.profile)
          setHasResume(Boolean(response.resume))
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load your Career Profile.',
          )
        }
      } finally {
        if (isMounted) {
          setIsLoadingCareerProfile(false)
        }
      }
    }

    void loadCareerProfile()

    return () => {
      isMounted = false
    }
  }, [])

  const selectedWorkspaceRequestId = useMemo(() => {
    if (requestIdFromUrl && requests.some((request) => request.id === requestIdFromUrl)) {
      return requestIdFromUrl
    }

    return requests[0]?.id || null
  }, [requestIdFromUrl, requests])

  useEffect(() => {
    let isMounted = true

    async function loadPageData() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        if (page === 'sessions') {
          const response = await sessionApi.getMySessions()

          if (isMounted) {
            setSessions(response.sessions)
          }

          return
        }

        if (page === 'notifications') {
          const response = await notificationApi.getNotifications()

          if (isMounted) {
            setNotifications(response.notifications)
          }

          return
        }

        const response = await requestApi.getMyRequests()

        if (isMounted) {
          setRequests(response.requests)
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load this page. Please try again.',
          )
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadPageData()

    return () => {
      isMounted = false
    }
  }, [page])

  function updateRequestForm(field: keyof RequestFormState, value: string) {
    setRequestForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function chooseService(service: 'Career Counselling' | 'Mock Interview') {
    setSelectedService(service)
    setErrorMessage('')
  }

  async function handleSubmitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedService) {
      setErrorMessage('Select Career Counselling or Mock Interview first.')
      return
    }

    if (!isCareerProfileComplete(careerProfile)) {
      setErrorMessage(
        'Complete your Career Profile before submitting a support request.',
      )
      navigate('/app/account')
      return
    }

    if (!hasResume) {
      const continueWithoutResume = window.confirm(
        'A resume is optional, but uploading one can help your counsellor prepare more effectively. Would you like to continue without a resume?',
      )

      if (!continueWithoutResume) {
        navigate('/app/account')
        return
      }
    }

    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmittingRequest(true)

    try {
      const skills = requestForm.skills
        .split(',')
        .map((skill) => skill.trim())
        .filter(Boolean)

      const response = await requestApi.createRequest({
        requestType:
          selectedService === 'Mock Interview'
            ? 'mock_interview'
            : 'career_counselling',
        title:
          selectedService === 'Mock Interview'
            ? 'Mock Interview Support Request'
            : 'Career Counselling Support Request',
        description: requestForm.description,
        industry: requestForm.industry || undefined,
        currentJobTitle: requestForm.currentJobTitle || undefined,
        yearsOfExperience: requestForm.yearsOfExperience
          ? Number(requestForm.yearsOfExperience)
          : undefined,
        targetRole: requestForm.targetRole || undefined,
        skills,
        preferredDate: requestForm.preferredDate || undefined,
        preferredTimeSlot: requestForm.preferredTimeSlot || undefined,
        timezone: 'Asia/Kolkata',
        additionalDetails: {
          submittedFrom: 'CareerConnect user portal',
        },
      })

      setRequests((currentRequests) => [response.request, ...currentRequests])
      setRequestForm(initialRequestForm)
      setSelectedService('')
      setSuccessMessage('Your support request has been submitted successfully.')

      navigate(`/app/workspace?requestId=${response.request.id}`)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to submit your request. Please try again.',
      )
    } finally {
      setIsSubmittingRequest(false)
    }
  }

  async function markNotificationAsRead(notification: CareerNotification) {
    if (notification.isRead) {
      return
    }

    try {
      const response = await notificationApi.markAsRead(notification.id)

      setNotifications((currentNotifications) =>
        currentNotifications.map((currentNotification) =>
          currentNotification.id === notification.id
            ? response.notification
            : currentNotification,
        ),
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to update the notification.',
      )
    }
  }

  if (!currentUser) {
    return null
  }

  const openRequestCount = requests.filter(
    (request) =>
      !['completed', 'cancelled', 'closed'].includes(request.status),
  ).length

  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.isRead,
  ).length

  const careerProfileComplete = isCareerProfileComplete(careerProfile)
  const showCareerProfileGate =
    isLoadingCareerProfile || !careerProfileComplete

  if (page === 'dashboard') {
    return (
      <section className="portal-page">
        <div className="portal-page-header">
          <div>
            <p className="eyebrow">PERSONAL DASHBOARD</p>
            <h1>Welcome back, {currentUser.fullName.split(' ')[0]}.</h1>
            <p>
              Review your career support journey, requests, sessions, and
              conversations from one secure workspace.
            </p>
          </div>

          <Link
            className="portal-primary-action"
            to={careerProfileComplete ? '/app/requests' : '/app/account'}
          >
            {careerProfileComplete
              ? 'Create support request'
              : 'Complete Career Profile'}{' '}
            <span>→</span>
          </Link>
        </div>

        {errorMessage && (
          <div className="portal-alert portal-alert-error">{errorMessage}</div>
        )}

        {isLoading ? (
          <div className="portal-loading-panel">Loading your dashboard…</div>
        ) : (
          <>
            {showCareerProfileGate && (
              <div className="portal-content-card">
                <div className="portal-card-heading">
                  <div>
                    <span>PREPARE FOR PERSONALIZED CAREER SUPPORT</span>
                    <h2>Complete your Career Profile before submitting a request.</h2>
                  </div>
                  <Link className="portal-secondary-action" to="/app/account">
                    Complete profile →
                  </Link>
                </div>
                <p>
                  Your counsellor uses your background, experience, target role,
                  skills, and career goals to prepare for the first session. This
                  keeps the session focused on advice and practical next steps.
                </p>
                <p>
                  A resume is optional, but uploading one can help your counsellor
                  prepare more effectively. Your information is visible only to
                  your assigned counsellor and authorized CareerConnect
                  administrators.
                </p>
                <div className="portal-summary-request-list">
                  <article>
                    <div>
                      <strong>Career Profile</strong>
                      <span>
                        {isLoadingCareerProfile
                          ? 'Checking profile'
                          : 'Required before request submission'}
                      </span>
                    </div>
                    <span
                      className={`portal-status ${
                        careerProfileComplete ? 'status-completed' : 'status-submitted'
                      }`}
                    >
                      {careerProfileComplete ? 'Complete' : 'Action required'}
                    </span>
                  </article>
                  <article>
                    <div>
                      <strong>Resume</strong>
                      <span>Optional but recommended</span>
                    </div>
                    <span className="portal-status status-assigned">
                      {hasResume ? 'Uploaded' : 'Not uploaded'}
                    </span>
                  </article>
                </div>
              </div>
            )}

            <div className="portal-stat-grid">
              <article>
                <span>Total requests</span>
                <strong>{requests.length}</strong>
                <Link to="/app/requests">View requests →</Link>
              </article>

              <article>
                <span>Active requests</span>
                <strong>{openRequestCount}</strong>
                <Link to="/app/workspace">Open workspace →</Link>
              </article>

              <article>
                <span>Upcoming sessions</span>
                <strong>View</strong>
                <Link to="/app/sessions">Open sessions →</Link>
              </article>

              <article>
                <span>Notifications</span>
                <strong>{unreadNotificationCount || '—'}</strong>
                <Link to="/app/notifications">View notifications →</Link>
              </article>
            </div>

            <div className="portal-content-card">
              <div className="portal-card-heading">
                <div>
                  <span>RECENT REQUESTS</span>
                  <h2>Your latest career support activity</h2>
                </div>

                <Link to="/app/requests">View all requests</Link>
              </div>

              {requests.length === 0 ? (
                <div className="portal-empty-state">
                  <strong>No requests submitted yet.</strong>
                  <p>
                    Start with Career Counselling or a Mock Interview request.
                  </p>
                  <Link
                    className="portal-primary-action"
                    to={careerProfileComplete ? '/app/requests' : '/app/account'}
                  >
                    {careerProfileComplete
                      ? 'Submit your first request'
                      : 'Complete Career Profile'}{' '}
                    <span>→</span>
                  </Link>
                </div>
              ) : (
                <div className="portal-summary-request-list">
                  {requests.slice(0, 4).map((request) => (
                    <article key={request.id}>
                      <div>
                        <strong>{getRequestName(request.requestType)}</strong>
                        <span>{request.requestNumber}</span>
                      </div>

                      <span className={`portal-status status-${request.status}`}>
                        {getStatusLabel(request.status)}
                      </span>

                      <Link to={`/app/workspace?requestId=${request.id}`}>
                        Open workspace →
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    )
  }

  if (page === 'requests') {
    return (
      <section className="portal-page">
        <div className="portal-page-header">
          <div>
            <p className="eyebrow">MY REQUESTS</p>
            <h1>Career support requests</h1>
            <p>
              Submit a new request or review the current status of every
              counselling and mock interview request.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="portal-alert portal-alert-error">{errorMessage}</div>
        )}

        {successMessage && (
          <div className="portal-alert portal-alert-success">
            {successMessage}
          </div>
        )}

        {!careerProfileComplete && !isLoadingCareerProfile && (
          <div className="portal-alert portal-alert-error">
            <strong>Complete your Career Profile before submitting a support request.</strong>{' '}
            Your background, experience, target role, skills, and career goals
            help your counsellor prepare. A resume is optional but recommended.{' '}
            <Link to="/app/account">Complete Career Profile →</Link>
          </div>
        )}

        <div className="portal-request-layout">
          <div className="portal-content-card">
            <div className="portal-card-heading">
              <div>
                <span>NEW REQUEST</span>
                <h2>Tell us how we can help.</h2>
              </div>
            </div>

            {!careerProfileComplete ? (
              <div className="portal-empty-state">
                <strong>Prepare your Career Profile first.</strong>
                <p>
                  Complete the required profile information before choosing a
                  support service. A resume is optional, but recommended.
                </p>
                <Link className="portal-primary-action" to="/app/account">
                  Complete Career Profile <span>→</span>
                </Link>
              </div>
            ) : !selectedService ? (
              <div className="portal-service-choice-grid">
                <button
                  type="button"
                  onClick={() => chooseService('Career Counselling')}
                >
                  <span>✦</span>
                  <strong>Career Counselling</strong>
                  <p>Direction, role transition, CV, job search and planning.</p>
                </button>

                <button
                  type="button"
                  onClick={() => chooseService('Mock Interview')}
                >
                  <span>◎</span>
                  <strong>Mock Interview</strong>
                  <p>Realistic interview practice with focused feedback.</p>
                </button>
              </div>
            ) : (
              <form className="portal-request-form" onSubmit={handleSubmitRequest}>
                <div className="portal-form-title-row">
                  <div>
                    <span>REQUESTING</span>
                    <strong>{selectedService}</strong>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedService('')}
                  >
                    Change
                  </button>
                </div>

                <div className="portal-form-grid">
                  <label>
                    Current job title
                    <input
                      placeholder="For example: Infrastructure Manager"
                      type="text"
                      value={requestForm.currentJobTitle}
                      onChange={(event) =>
                        updateRequestForm('currentJobTitle', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Industry
                    <input
                      placeholder="For example: Information Technology"
                      type="text"
                      value={requestForm.industry}
                      onChange={(event) =>
                        updateRequestForm('industry', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Years of experience
                    <input
                      max="60"
                      min="0"
                      placeholder="For example: 8"
                      type="number"
                      value={requestForm.yearsOfExperience}
                      onChange={(event) =>
                        updateRequestForm(
                          'yearsOfExperience',
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <label>
                    Target role
                    <input
                      placeholder="For example: Technical Project Manager"
                      type="text"
                      value={requestForm.targetRole}
                      onChange={(event) =>
                        updateRequestForm('targetRole', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Preferred date
                    <input
                      type="date"
                      value={requestForm.preferredDate}
                      onChange={(event) =>
                        updateRequestForm('preferredDate', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Preferred time
                    <select
                      value={requestForm.preferredTimeSlot}
                      onChange={(event) =>
                        updateRequestForm(
                          'preferredTimeSlot',
                          event.target.value,
                        )
                      }
                    >
                      <option value="">No preference</option>
                      <option value="Morning">Morning</option>
                      <option value="Afternoon">Afternoon</option>
                      <option value="Evening">Evening</option>
                      <option value="Weekend">Weekend</option>
                    </select>
                  </label>
                </div>

                <label>
                  Skills or focus areas
                  <input
                    placeholder="For example: Cloud, Delivery Management, Stakeholder Management"
                    type="text"
                    value={requestForm.skills}
                    onChange={(event) =>
                      updateRequestForm('skills', event.target.value)
                    }
                  />
                </label>

                <label>
                  What would you like support with?
                  <textarea
                    required
                    placeholder="Describe your career goal, challenge, or interview preparation requirement."
                    rows={5}
                    value={requestForm.description}
                    onChange={(event) =>
                      updateRequestForm('description', event.target.value)
                    }
                  />
                </label>

                <button
                  className="portal-primary-action"
                  disabled={isSubmittingRequest}
                  type="submit"
                >
                  {isSubmittingRequest
                    ? 'Submitting request...'
                    : 'Submit request'}{' '}
                  <span>→</span>
                </button>
              </form>
            )}
          </div>

          <div className="portal-content-card">
            <div className="portal-card-heading">
              <div>
                <span>REQUEST HISTORY</span>
                <h2>Submitted requests</h2>
              </div>
            </div>

            {isLoading ? (
              <div className="portal-loading-panel">Loading requests…</div>
            ) : requests.length === 0 ? (
              <div className="portal-empty-state">
                <strong>No requests submitted yet.</strong>
                <p>Your submitted support requests will appear here.</p>
              </div>
            ) : (
              <div className="portal-summary-request-list">
                {requests.map((request) => (
                  <article key={request.id}>
                    <div>
                      <strong>{getRequestName(request.requestType)}</strong>
                      <span>{request.requestNumber}</span>
                    </div>

                    <span className={`portal-status status-${request.status}`}>
                      {getStatusLabel(request.status)}
                    </span>

                    <Link to={`/app/workspace?requestId=${request.id}`}>
                      Open →
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  if (page === 'workspace') {
    return (
      <section className="portal-page">
        <div className="portal-page-header">
          <div>
            <p className="eyebrow">MESSAGES & WORKSPACE</p>
            <h1>Request workspace</h1>
            <p>
              Open one request to view counsellor messages, session details,
              and progress updates.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="portal-alert portal-alert-error">{errorMessage}</div>
        )}

        {isLoading ? (
          <div className="portal-loading-panel">Loading your workspace…</div>
        ) : (
          <UserWorkspace
            requests={requests}
            selectedRequestId={selectedWorkspaceRequestId}
            onRequestSelected={(requestId) =>
              navigate(`/app/workspace?requestId=${requestId}`)
            }
          />
        )}
      </section>
    )
  }

  if (page === 'sessions') {
    return (
      <section className="portal-page">
        <div className="portal-page-header">
          <div>
            <p className="eyebrow">MY SESSIONS</p>
            <h1>Career support sessions</h1>
            <p>
              Review all scheduled, completed, rescheduled, and cancelled
              sessions in one place.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="portal-alert portal-alert-error">{errorMessage}</div>
        )}

        <div className="portal-content-card">
          {isLoading ? (
            <div className="portal-loading-panel">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="portal-empty-state">
              <strong>No sessions scheduled yet.</strong>
              <p>
                Your counsellor will schedule a session after reviewing your
                request.
              </p>
            </div>
          ) : (
            <div className="portal-session-list">
              {sessions.map((session) => (
                <article key={session.id} className="portal-session-card">
                  <div>
                    <span className={`portal-status session-status-${session.status}`}>
                      {session.status.replaceAll('_', ' ')}
                    </span>
                    <strong>{session.title}</strong>
                    <p>
                      {new Date(session.scheduledStartAt).toLocaleString()}
                    </p>
                    <small>{session.timezone}</small>
                  </div>

                  {session.meetingLink &&
                    session.status === 'scheduled' && (
                      <a
                        className="portal-secondary-action"
                        href={session.meetingLink}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Join session →
                      </a>
                    )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    )
  }

  if (page === 'notifications') {
    return (
      <section className="portal-page">
        <div className="portal-page-header">
          <div>
            <p className="eyebrow">NOTIFICATIONS</p>
            <h1>CareerConnect updates</h1>
            <p>
              Review request, counsellor assignment, message, and session
              updates.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="portal-alert portal-alert-error">{errorMessage}</div>
        )}

        <div className="portal-content-card">
          {isLoading ? (
            <div className="portal-loading-panel">Loading notifications…</div>
          ) : notifications.length === 0 ? (
            <div className="portal-empty-state">
              <strong>No notifications yet.</strong>
              <p>CareerConnect updates will appear here.</p>
            </div>
          ) : (
            <div className="portal-notification-list">
              {notifications.map((notification) => (
                <button
                  className={`portal-notification-item${
                    notification.isRead ? '' : ' unread'
                  }`}
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    void markNotificationAsRead(notification)

                    if (notification.requestId) {
                      navigate(
                        `/app/workspace?requestId=${notification.requestId}`,
                      )
                    }
                  }}
                >
                  <strong>{notification.title}</strong>
                  <span>{notification.message}</span>
                  <small>
                    {new Date(notification.createdAt).toLocaleString()}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="portal-page">
      <div className="portal-page-header">
        <div>
          <p className="eyebrow">MY ACCOUNT</p>
          <h1>Account details</h1>
          <p>
            This is the account currently used for CareerConnect requests,
            messages, and sessions.
          </p>
        </div>
      </div>

      <div className="portal-content-card portal-account-card">
        <div className="portal-account-avatar">
          {currentUser.fullName.charAt(0).toUpperCase()}
        </div>

        <div className="portal-account-details">
          <div>
            <span>Full name</span>
            <strong>{currentUser.fullName}</strong>
          </div>

          <div>
            <span>Email address</span>
            <strong>{currentUser.email}</strong>
          </div>

          <div>
            <span>Phone number</span>
            <strong>{currentUser.phone || 'Not provided'}</strong>
          </div>

          <div>
            <span>Account role</span>
            <strong>CareerConnect User</strong>
          </div>
        </div>

        <p className="portal-account-note">Your account details are shown above.</p>
      </div>

      <CareerProfilePanel
        onProfileSaved={(profile, resumeUploaded) => {
          setCareerProfile(profile)
          setHasResume(resumeUploaded)
        }}
      />
    </section>
  )
}

export default UserPortal