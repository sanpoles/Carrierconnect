import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import UserWorkspace from '../components/UserWorkspace'
import CareerProfilePanel from '../components/CareerProfilePanel'
import {
  careerProfileApi,
  getStoredUser,
  notificationApi,
  requestApi,
  toolkitApi,
  sessionApi,
  type CareerNotification,
  type CareerProfile,
  type CareerRequest,
  type CareerSession,
  type ServiceContact,
  type ToolkitResource,
} from '../services/api'
import '../styles/request-readiness.css'

type UserPortalPage =
  | 'dashboard'
  | 'requests'
  | 'workspace'
  | 'sessions'
  | 'notifications'
  | 'toolkit'
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
  preferredSlotOne: string
  preferredSlotTwo: string
  preferredSlotThree: string
  timezone: string
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
  preferredSlotOne: '',
  preferredSlotTwo: '',
  preferredSlotThree: '',
  timezone: 'Asia/Kolkata',
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
  const [currentResumeName, setCurrentResumeName] = useState('')
  const [serviceContact, setServiceContact] = useState<ServiceContact | null>(null)
  const [servicePhoneCountryCode, setServicePhoneCountryCode] = useState('+91')
  const [servicePhoneNumber, setServicePhoneNumber] = useState('')
  const [serviceContactConsent, setServiceContactConsent] = useState(false)
  const [requestResumeFile, setRequestResumeFile] = useState<File | null>(null)
  const [savedToolkitResources, setSavedToolkitResources] = useState<ToolkitResource[]>([])
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
          setCurrentResumeName(response.resume?.originalFileName || '')
          setServiceContact(response.contact || null)
          setServicePhoneCountryCode(response.contact?.phoneCountryCode || '+91')
          setServicePhoneNumber(response.contact?.phoneNumber || '')
          setServiceContactConsent(Boolean(response.contact?.readyForServiceContact))
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

        if (page === 'toolkit') {
          const response = await toolkitApi.getSaved()

          if (isMounted) {
            setSavedToolkitResources(response.resources)
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

  function getPreferredSlotsForSubmission() {
    const values = [
      requestForm.preferredSlotOne,
      requestForm.preferredSlotTwo,
      requestForm.preferredSlotThree,
    ]
      .map((value) => value.trim())
      .filter(Boolean)

    if (values.length < 2) {
      throw new Error('Add at least two preferred date and time options.')
    }

    const uniqueValues = new Set(values)
    if (uniqueValues.size !== values.length) {
      throw new Error('Preferred date and time options cannot be duplicates.')
    }

    const now = Date.now()
    return values.map((value) => {
      const start = new Date(value)
      if (Number.isNaN(start.getTime()) || start.getTime() <= now) {
        throw new Error('Preferred date and time options must be in the future.')
      }

      const end = new Date(start.getTime() + 60 * 60 * 1000)
      return {
        scheduledStartAt: start.toISOString(),
        scheduledEndAt: end.toISOString(),
        timezone: requestForm.timezone || 'Asia/Kolkata',
      }
    })
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

    let serviceContactPayload:
      | {
          phoneCountryCode: string
          phoneNumber: string
          serviceCommunicationConsent: true
        }
      | undefined

    if (!serviceContact?.readyForServiceContact) {
      if (!servicePhoneCountryCode.trim() || !servicePhoneNumber.trim()) {
        setErrorMessage('Add your service contact phone number before submitting this request.')
        return
      }

      if (!serviceContactConsent) {
        setErrorMessage(
          'Confirm that CareerConnect may use this phone number for service communication.',
        )
        return
      }

      serviceContactPayload = {
        phoneCountryCode: servicePhoneCountryCode.trim(),
        phoneNumber: servicePhoneNumber.trim(),
        serviceCommunicationConsent: true,
      }
    }

    if (!hasResume) {
      if (!requestResumeFile) {
        setErrorMessage('Upload a PDF or DOCX resume before submitting this support request.')
        return
      }
    }

    let preferredSlots: Array<{
      scheduledStartAt: string
      scheduledEndAt: string
      timezone: string
    }>

    try {
      preferredSlots = getPreferredSlotsForSubmission()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Add at least two valid preferred date and time options.',
      )
      return
    }

    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmittingRequest(true)

    try {
      let uploadedResumeName = currentResumeName

      if (!hasResume && requestResumeFile) {
        const uploadResponse = await careerProfileApi.uploadResume(requestResumeFile)
        setHasResume(true)
        setCurrentResumeName(uploadResponse.resume.originalFileName)
        setRequestResumeFile(null)
        uploadedResumeName = uploadResponse.resume.originalFileName
      }

      if (serviceContactPayload) {
        const contactResponse =
          await careerProfileApi.saveServiceContact(serviceContactPayload)
        setServiceContact(contactResponse.contact)
        setServiceContactConsent(true)
      }

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
        timezone: requestForm.timezone || 'Asia/Kolkata',
        preferredSlots,
        serviceContact: serviceContactPayload,
        additionalDetails: {
          submittedFrom: 'CareerConnect user portal',
          resumeReady: Boolean(uploadedResumeName),
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
  const requestReadinessItems = [
    {
      label: 'Career Profile',
      ready: careerProfileComplete,
      detail: careerProfileComplete ? 'Complete' : 'Required before request submission',
    },
    {
      label: 'Service contact',
      ready: Boolean(serviceContact?.readyForServiceContact),
      detail: serviceContact?.readyForServiceContact
        ? serviceContact.phoneE164 || serviceContact.phone || 'Ready'
        : 'Required for service communication',
    },
    {
      label: 'Resume',
      ready: hasResume,
      detail: hasResume ? currentResumeName || 'Uploaded' : 'PDF or DOCX required',
    },
  ]
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
                      <span>Required for Career Guidance and Mock Interview requests</span>
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
            help your counsellor prepare. Phone and resume are collected only when
            you submit a service request.{' '}
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
                  support service.
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
                    Preferred option 1
                    <input
                      required
                      type="datetime-local"
                      value={requestForm.preferredSlotOne}
                      onChange={(event) =>
                        updateRequestForm('preferredSlotOne', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Preferred option 2
                    <input
                      required
                      type="datetime-local"
                      value={requestForm.preferredSlotTwo}
                      onChange={(event) =>
                        updateRequestForm('preferredSlotTwo', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Preferred option 3
                    <input
                      type="datetime-local"
                      value={requestForm.preferredSlotThree}
                      onChange={(event) =>
                        updateRequestForm('preferredSlotThree', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Timezone
                    <select
                      value={requestForm.timezone}
                      onChange={(event) =>
                        updateRequestForm('timezone', event.target.value)
                      }
                    >
                      <option value="Asia/Kolkata">Asia/Kolkata</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="Europe/London">Europe/London</option>
                      <option value="Asia/Dubai">Asia/Dubai</option>
                      <option value="Asia/Singapore">Asia/Singapore</option>
                    </select>
                  </label>
                </div>

                <div className="request-readiness-panel">
                  <div className="portal-card-heading">
                    <div>
                      <span>REQUEST READINESS</span>
                      <h3>Required only for service requests</h3>
                    </div>
                  </div>

                  <div className="request-readiness-list">
                    {requestReadinessItems.map((item) => (
                      <span className={item.ready ? 'ready' : 'needed'} key={item.label}>
                        <strong>{item.label}</strong>
                        {item.detail}
                      </span>
                    ))}
                  </div>

                  {!serviceContact?.readyForServiceContact && (
                    <div className="request-readiness-form-grid">
                      <label>
                        Country code
                        <input
                          required
                          placeholder="+91"
                          type="tel"
                          value={servicePhoneCountryCode}
                          onChange={(event) =>
                            setServicePhoneCountryCode(event.target.value)
                          }
                        />
                      </label>

                      <label>
                        Phone number
                        <input
                          required
                          placeholder="Digits only"
                          type="tel"
                          value={servicePhoneNumber}
                          onChange={(event) =>
                            setServicePhoneNumber(event.target.value)
                          }
                        />
                      </label>

                      <label className="request-readiness-checkbox">
                        <input
                          checked={serviceContactConsent}
                          required
                          type="checkbox"
                          onChange={(event) =>
                            setServiceContactConsent(event.target.checked)
                          }
                        />
                        <span>
                          CareerConnect may use this phone number for service
                          communication about my request.
                        </span>
                      </label>
                    </div>
                  )}

                  {!hasResume && (
                    <label className="request-readiness-upload">
                      Resume upload
                      <input
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        required
                        type="file"
                        onChange={(event) =>
                          setRequestResumeFile(event.target.files?.[0] || null)
                        }
                      />
                      <small>PDF or DOCX only. This is shared only with authorized CareerConnect staff for your request.</small>
                    </label>
                  )}
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

  if (page === 'toolkit') {
    return (
      <section className="portal-page">
        <div className="portal-page-header">
          <div>
            <p className="eyebrow">MY TOOLKIT</p>
            <h1>Saved Career Toolkit resources</h1>
            <p>
              Keep useful IT career preparation guides, frameworks, checklists,
              worksheets, and templates in one place.
            </p>
          </div>

          <Link className="portal-primary-action" to="/career-toolkit">
            Browse Career Toolkit <span>→</span>
          </Link>
        </div>

        {errorMessage && (
          <div className="portal-alert portal-alert-error">{errorMessage}</div>
        )}

        <div className="portal-content-card">
          {isLoading ? (
            <div className="portal-loading-panel">Loading My Toolkit…</div>
          ) : savedToolkitResources.length === 0 ? (
            <div className="portal-empty-state">
              <strong>No saved resources yet.</strong>
              <p>
                Browse the Career Toolkit and save resources you want to revisit.
              </p>
              <Link className="portal-primary-action" to="/career-toolkit">
                Explore resources <span>→</span>
              </Link>
            </div>
          ) : (
            <div className="toolkit-saved-list">
              {savedToolkitResources.map((resource) => (
                <article key={resource.id}>
                  <span>{resource.category.name}</span>
                  <h2>{resource.title}</h2>
                  <p>{resource.description}</p>
                  <Link to={`/career-toolkit/resources/${resource.slug}`}>
                    Open resource →
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
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
