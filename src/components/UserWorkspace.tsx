import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import UserBookingPanel from './UserBookingPanel'
import {
  messageApi,
  notificationApi,
  requestApi,
  sessionApi,
  type CareerNotification,
  type CareerRequest,
  type CareerSession,
  type SlotProposal,
  type RequestMessage,
} from '../services/api'
import { onRealtimeMessage } from '../services/realtime'
import '../styles/internal-notes.css'

type UserWorkspaceProps = {
  requests: CareerRequest[]
  selectedRequestId: string | null
  onRequestSelected: (requestId: string) => void
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return 'Not available'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatStatus(status: string) {
  return status.replaceAll('_', ' ')
}

function getRequestName(requestType: CareerRequest['requestType']) {
  return requestType === 'career_counselling'
    ? 'Career Counselling'
    : 'Mock Interview'
}

function slotLabel(startAt?: string | null, endAt?: string | null) {
  return `${formatDateTime(startAt)} - ${formatDateTime(endAt)}`
}

function latestProposedSlots(request: CareerRequest | null): SlotProposal | null {
  if (!request?.slotProposals?.length) {
    return null
  }

  const proposals = request.slotProposals.filter(
    (proposal) => proposal.status === 'proposed',
  )

  return proposals[proposals.length - 1] || null
}

function UserWorkspace({
  requests,
  selectedRequestId,
  onRequestSelected,
}: UserWorkspaceProps) {
  const [messages, setMessages] = useState<RequestMessage[]>([])
  const [sessions, setSessions] = useState<CareerSession[]>([])
  const [notifications, setNotifications] = useState<CareerNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const [messageText, setMessageText] = useState('')
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false)

  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceSuccess, setWorkspaceSuccess] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [selectingSlotId, setSelectingSlotId] = useState('')
  const [confirmedProposalId, setConfirmedProposalId] = useState('')

  const messageListRef = useRef<HTMLDivElement>(null)

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || null,
    [requests, selectedRequestId],
  )

  const latestMessageId = useMemo(() => {
    return messages.length > 0 ? messages[messages.length - 1].id : ''
  }, [messages])

  const proposedSlots = useMemo(
    () => {
      const proposal = latestProposedSlots(selectedRequest)
      return proposal?.id === confirmedProposalId ? null : proposal
    },
    [confirmedProposalId, selectedRequest],
  )

  useEffect(() => {
    async function loadNotifications() {
      setIsLoadingNotifications(true)

      try {
        const response = await notificationApi.getNotifications()

        setNotifications(response.notifications)
        setUnreadCount(response.unreadCount)
      } catch (error) {
        console.error('Unable to load notifications:', error)
      } finally {
        setIsLoadingNotifications(false)
      }
    }

    loadNotifications()
  }, [])

  useEffect(() => {
    return onRealtimeMessage((message) => {
      // Messages from counsellors and admins use the same public Socket.IO event.
      // Internal notes are deliberately excluded from the user workspace.
      if (
        message.requestId !== selectedRequestId ||
        message.isInternal
      ) {
        return
      }

      setMessages((currentMessages) => {
        if (currentMessages.some((currentMessage) => currentMessage.id === message.id)) {
          return currentMessages
        }

        return [...currentMessages, message]
      })
    })
  }, [selectedRequestId])

  useEffect(() => {
    let isComponentActive = true

    async function loadRequestDetails() {
      if (!selectedRequestId) {
        if (isComponentActive) {
          setMessages([])
          setSessions([])
          setIsLoadingDetails(false)
        }

        return
      }

      setWorkspaceError('')
      setWorkspaceSuccess('')
      setConfirmedProposalId('')
      setIsLoadingDetails(true)

      try {
        const [messageResponse, sessionResponse] = await Promise.all([
          messageApi.getMessages(selectedRequestId),
          sessionApi.getRequestSessions(selectedRequestId),
        ])

        if (!isComponentActive) {
          return
        }

        setMessages(messageResponse.messages)
        setSessions(sessionResponse.sessions)
      } catch (error) {
        if (!isComponentActive) {
          return
        }

        setWorkspaceError(
          error instanceof Error
            ? error.message
            : 'Unable to load workspace details.',
        )
      } finally {
        if (isComponentActive) {
          setIsLoadingDetails(false)
        }
      }
    }

    loadRequestDetails()

    return () => {
      isComponentActive = false
    }
  }, [selectedRequestId])

  /*
    Scroll only the inner message panel.

    This does NOT scroll the page.
    It does NOT run every few seconds.
    It only runs when:
    - a request is selected
    - a genuinely new latest message appears
  */
  useLayoutEffect(() => {
    const messageList = messageListRef.current

    if (!messageList || !latestMessageId) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      messageList.scrollTop = messageList.scrollHeight
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [latestMessageId, selectedRequestId])

  async function refreshNotifications() {
    try {
      const response = await notificationApi.getNotifications()

      setNotifications(response.notifications)
      setUnreadCount(response.unreadCount)
    } catch (error) {
      console.error('Unable to refresh notifications:', error)
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedRequestId || !messageText.trim()) {
      return
    }

    setWorkspaceError('')
    setWorkspaceSuccess('')
    setIsSendingMessage(true)

    try {
      const response = await messageApi.sendMessage(
        selectedRequestId,
        messageText.trim(),
      )

      setMessages((currentMessages) => {
        const alreadyExists = currentMessages.some(
          (message) => message.id === response.requestMessage.id,
        )

        if (alreadyExists) {
          return currentMessages
        }

        return [...currentMessages, response.requestMessage]
      })

      setMessageText('')
      setWorkspaceSuccess('Your message has been sent successfully.')

      await refreshNotifications()
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : 'Unable to send your message.',
      )
    } finally {
      setIsSendingMessage(false)
    }
  }

  async function handleSelectProposalOption(proposalId: string, optionId: string) {
    if (!selectedRequestId) {
      return
    }

    setWorkspaceError('')
    setWorkspaceSuccess('')
    setSelectingSlotId(optionId)

    try {
      await requestApi.selectProposalOption(selectedRequestId, proposalId, optionId)
      const sessionResponse = await sessionApi.getRequestSessions(selectedRequestId)

      setSessions(sessionResponse.sessions)
      setConfirmedProposalId(proposalId)
      setWorkspaceSuccess('Your session time has been confirmed.')
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : 'Unable to confirm this session time.',
      )
    } finally {
      setSelectingSlotId('')
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      await notificationApi.markAllAsRead()

      setNotifications((currentNotifications) =>
        currentNotifications.map((notification) => ({
          ...notification,
          isRead: true,
          readAt: notification.readAt || new Date().toISOString(),
        })),
      )

      setUnreadCount(0)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : 'Unable to update notifications.',
      )
    }
  }

  async function handleNotificationClick(notification: CareerNotification) {
    if (!notification.isRead) {
      try {
        await notificationApi.markAsRead(notification.id)

        setNotifications((currentNotifications) =>
          currentNotifications.map((currentNotification) =>
            currentNotification.id === notification.id
              ? {
                  ...currentNotification,
                  isRead: true,
                  readAt: new Date().toISOString(),
                }
              : currentNotification,
          ),
        )

        setUnreadCount((currentCount) => Math.max(0, currentCount - 1))
      } catch (error) {
        console.error('Unable to mark notification as read:', error)
      }
    }

    if (notification.requestId) {
      onRequestSelected(notification.requestId)
      setShowNotifications(false)

      window.setTimeout(() => {
        document
          .getElementById('request-workspace')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }

  return (
    <section className="workspace-section" id="request-workspace">
      <div className="workspace-container">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">MY WORKSPACE</p>
            <h2>Requests, conversations, and sessions.</h2>
            <p className="workspace-description">
              Select a request to communicate with your counsellor, review
              scheduled sessions, access the meeting link, and track progress.
            </p>
          </div>

          <div className="notification-area">
            <button
              className="notification-button"
              type="button"
              onClick={() => setShowNotifications((currentValue) => !currentValue)}
            >
              <span>Notifications</span>

              {unreadCount > 0 && (
                <span className="notification-count">{unreadCount}</span>
              )}
            </button>

            {showNotifications && (
              <div className="notification-panel">
                <div className="notification-panel-header">
                  <strong>Notifications</strong>

                  <button
                    type="button"
                    onClick={handleMarkAllNotificationsRead}
                    disabled={unreadCount === 0}
                  >
                    Mark all read
                  </button>
                </div>

                {isLoadingNotifications ? (
                  <p className="notification-empty">Loading notifications...</p>
                ) : notifications.length === 0 ? (
                  <p className="notification-empty">
                    You do not have notifications yet.
                  </p>
                ) : (
                  <div className="notification-list">
                    {notifications.slice(0, 8).map((notification) => (
                      <button
                        className={`notification-item ${
                          notification.isRead ? 'is-read' : 'is-unread'
                        }`}
                        key={notification.id}
                        type="button"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <strong>{notification.title}</strong>
                        <span>{notification.message}</span>
                        <small>{formatDateTime(notification.createdAt)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {workspaceError && (
          <div className="workspace-error">
            <strong>Please review this:</strong> {workspaceError}
          </div>
        )}

        {workspaceSuccess && (
          <div className="workspace-success">{workspaceSuccess}</div>
        )}

        <div className="workspace-layout">
          <aside className="workspace-request-list">
            <div className="workspace-list-title">
              <strong>Your requests</strong>
              <span>{requests.length}</span>
            </div>

            {requests.length === 0 ? (
              <p className="workspace-empty-text">
                Your submitted requests will appear here.
              </p>
            ) : (
              requests.map((request) => (
                <button
                  className={`workspace-request-button ${
                    selectedRequestId === request.id ? 'selected' : ''
                  }`}
                  key={request.id}
                  type="button"
                  onClick={() => onRequestSelected(request.id)}
                >
                  <span className="workspace-request-icon">
                    {request.requestType === 'career_counselling' ? '✦' : '◎'}
                  </span>

                  <span className="workspace-request-content">
                    <strong>{getRequestName(request.requestType)}</strong>
                    <small>{request.requestNumber}</small>

                    <em className={`workspace-status ${request.status}`}>
                      {formatStatus(request.status)}
                    </em>
                  </span>
                </button>
              ))
            )}
          </aside>

          <div className="workspace-detail-panel">
            {!selectedRequest ? (
              <div className="workspace-empty-state">
                <div>↗</div>
                <h3>Select a request</h3>
                <p>
                  Open a request from the left to view messages, sessions,
                  counsellor updates, and meeting details.
                </p>
              </div>
            ) : (
              <>
                <div className="workspace-request-header">
                  <div>
                    <p>{selectedRequest.requestNumber}</p>
                    <h3>{getRequestName(selectedRequest.requestType)}</h3>

                    <span className={`workspace-status ${selectedRequest.status}`}>
                      {formatStatus(selectedRequest.status)}
                    </span>
                  </div>

                  <div className="workspace-request-meta">
                    {selectedRequest.preferredDate && (
                      <span>
                        Preferred date: {selectedRequest.preferredDate}
                      </span>
                    )}

                    {selectedRequest.assignedCounsellor && (
                      <span>
                        Counsellor: {selectedRequest.assignedCounsellor.fullName}
                      </span>
                    )}
                  </div>
                </div>

                <div className="workspace-summary-card">
                  <h4>Your request</h4>
                  <p>{selectedRequest.description}</p>

                  <div className="workspace-summary-grid">
                    <span>
                      <strong>Current role</strong>
                      {selectedRequest.currentJobTitle || 'Not provided'}
                    </span>

                    <span>
                      <strong>Target role</strong>
                      {selectedRequest.targetRole || 'Not provided'}
                    </span>

                    <span>
                      <strong>Experience</strong>
                      {selectedRequest.yearsOfExperience !== null &&
                      selectedRequest.yearsOfExperience !== undefined
                        ? `${selectedRequest.yearsOfExperience} years`
                        : 'Not provided'}
                    </span>

                    <span>
                      <strong>Preferred time</strong>
                      {selectedRequest.preferredTimeSlot || 'No preference'}
                    </span>
                  </div>
                </div>

                {selectedRequest.assignedCounsellor && (
                  <UserBookingPanel requestId={selectedRequest.id} onBooked={() => { void Promise.all([messageApi.getMessages(selectedRequest.id), sessionApi.getRequestSessions(selectedRequest.id)]).then(([m,s]) => { setMessages(m.messages); setSessions(s.sessions) }) }} />
                )}

                {proposedSlots && (
                  <section className="workspace-slot-proposals">
                    <div className="workspace-section-title">
                      <div>
                        <p>COUNSELLOR PROPOSED TIMES</p>
                        <h4>Choose a session option</h4>
                      </div>
                    </div>

                    {proposedSlots.message && <p>{proposedSlots.message}</p>}

                    <div className="workspace-proposed-slot-grid">
                      {proposedSlots.options.map((option) => (
                        <button
                          key={option.id || option.scheduledStartAt}
                          type="button"
                          disabled={Boolean(selectingSlotId) || !option.id}
                          onClick={() =>
                            option.id
                              ? void handleSelectProposalOption(
                                  proposedSlots.id,
                                  option.id,
                                )
                              : undefined
                          }
                        >
                          <strong>Option {option.displayOrder}</strong>
                          <span>
                            {slotLabel(option.scheduledStartAt, option.scheduledEndAt)}
                          </span>
                          <small>{option.timezone}</small>
                          <em>
                            {selectingSlotId === option.id
                              ? 'Confirming...'
                              : 'Select this time'}
                          </em>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {isLoadingDetails ? (
                  <div className="workspace-loading">
                    Loading conversation and sessions...
                  </div>
                ) : (
                  <div className="workspace-content-grid">
                    <section className="workspace-conversation">
                      <div className="workspace-section-title">
                        <div>
                          <p>CONVERSATION</p>
                          <h4>Messages</h4>
                        </div>

                        {selectedRequest.assignedCounsellor ? (
                          <span className="conversation-available">
                            Counsellor connected
                          </span>
                        ) : (
                          <span className="conversation-pending">
                            Awaiting counsellor assignment
                          </span>
                        )}
                      </div>

                      <div className="message-list" ref={messageListRef}>
                        {messages.length === 0 ? (
                          <div className="message-empty-state">
                            No messages yet. You can add more information about
                            your request here.
                          </div>
                        ) : (
                          messages.map((message) => (
                            <article
                              className={`message-bubble ${
                                message.senderType === 'user'
                                  ? 'message-from-user'
                                  : 'message-from-counsellor'
                              }`}
                              key={message.id}
                            >
                              <strong>
                                {message.sender?.fullName ||
                                  formatStatus(message.senderType)}
                              </strong>

                              <p>{message.messageBody}</p>
                              <small>{formatDateTime(message.createdAt)}</small>
                            </article>
                          ))
                        )}
                      </div>

                      <form
                        className="message-composer"
                        onSubmit={handleSendMessage}
                      >
                        <textarea
                          required
                          rows={3}
                          placeholder="Write a message about your request..."
                          value={messageText}
                          onChange={(event) => setMessageText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                              event.preventDefault()
                              if (!isSendingMessage && messageText.trim()) {
                                event.currentTarget.form?.requestSubmit()
                              }
                            }
                          }}
                        />

                        <button
                          type="submit"
                          disabled={isSendingMessage || !messageText.trim()}
                        >
                          {isSendingMessage ? 'Sending...' : 'Send message'} →
                        </button>
                      </form>
                    </section>

                    <section className="workspace-sessions">
                      <div className="workspace-section-title">
                        <div>
                          <p>SESSIONS</p>
                          <h4>Upcoming and completed</h4>
                        </div>
                      </div>

                      {sessions.length === 0 ? (
                        <div className="session-empty-state">
                          No session has been scheduled yet. Your counsellor
                          will share the schedule and meeting link here.
                        </div>
                      ) : (
                        <div className="session-list">
                          {sessions.map((session) => (
                            <article className="session-card" key={session.id}>
                              <div className="session-card-title">
                                <div>
                                  <strong>{session.title}</strong>

                                  <span
                                    className={`session-status ${session.status}`}
                                  >
                                    {formatStatus(session.status)}
                                  </span>
                                </div>
                              </div>

                              <p>{formatDateTime(session.scheduledStartAt)}</p>

                              <small>
                                {session.meetingProvider || 'Meeting'} ·{' '}
                                {session.timezone}
                              </small>

                              {session.meetingLink && (
                                <a
                                  className="join-session-button"
                                  href={session.meetingLink}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Join meeting →
                                </a>
                              )}

                              {session.rescheduleReason && (
                                <span className="session-note">
                                  Reschedule note: {session.rescheduleReason}
                                </span>
                              )}

                              {session.cancellationReason && (
                                <span className="session-note cancelled-note">
                                  Cancellation reason:{' '}
                                  {session.cancellationReason}
                                </span>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default UserWorkspace
