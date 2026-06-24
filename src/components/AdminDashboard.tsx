import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import AdminUsersPanel from './AdminUsersPanel'
import {
  adminApi,
  internalNotesApi,
  messageApi,
  sessionApi,
  notificationApi,
  type AdminDashboardStats,
  type AdminRequestFilters,
  type AdminOperationalState,
  type AdminSessionFilters,
  type CareerRequest,
  type CareerRequestStatus,
  type CareerSession,
  type CareerNotification,
  type CounsellorProfile,
  type DeliveryState,
  type EntitlementAdjustment,
  type Pagination,
  type RequestMessage,
} from '../services/api'
import { getStoredUser } from '../services/api'
import {
  onRealtimeInternalNote,
  onRealtimeMessage,
  onRealtimeNotification,
} from '../services/realtime'
import '../styles/internal-notes.css'

const PAGE_SIZE = 25

const REQUEST_STATUSES: Array<{ value: CareerRequestStatus; label: string }> = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'session_scheduled', label: 'Session scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'closed', label: 'Closed' },
]

const SESSION_STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'reschedule_requested', label: 'Reschedule requested' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No-show' },
] as const

type AdminTab = 'requests' | 'sessions' | 'counsellors' | 'users'
type DetailTab = 'overview' | 'conversation' | 'internal_notes' | 'sessions' | 'entitlement'

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date)
}

function formatStatus(status: string) {
  return status.replaceAll('_', ' ')
}

function requestLabel(request: CareerRequest) {
  return request.requestType === 'career_counselling'
    ? 'Career Counselling'
    : 'Mock Interview'
}

function deliveryStateFallback(request: CareerRequest): DeliveryState {
  return (
    request.deliveryState || {
      isLocked: false,
      sessionsGranted: 0,
      sessionsConsumed: 0,
      sessionsRemaining: 0,
      entitlementStatus: 'inactive',
      canSendMessages: true,
      canScheduleSessions: false,
      canManageSessions: true,
      readOnlyMessage: null,
    }
  )
}


function getOperationalState(request: CareerRequest): AdminOperationalState {
  const state = deliveryStateFallback(request)
  if (request.status === 'cancelled') return 'cancelled'
  if (request.status === 'closed') return 'closed'
  if (state.entitlementStatus === 'exhausted') return 'exhausted'
  if (state.isLocked || request.status === 'completed') return 'locked'
  if (!request.assignedCounsellor) return 'awaiting_assignment'
  if (state.sessionsRemaining <= 0) return 'awaiting_entitlement'
  if (request.status === 'assigned') return 'ready_to_start'
  return 'active'
}

function getOperationalStateLabel(state: AdminOperationalState) {
  return {
    awaiting_assignment: 'Awaiting assignment',
    awaiting_entitlement: 'Awaiting session approval',
    ready_to_start: 'Ready for counsellor',
    active: 'Active',
    exhausted: 'Exhausted',
    locked: 'Locked',
    closed: 'Closed',
    cancelled: 'Cancelled',
  }[state]
}

function getOperationalStateClass(state: AdminOperationalState) {
  if (['locked', 'closed', 'cancelled'].includes(state)) return 'locked'
  if (state === 'exhausted') return 'exhausted'
  if (state === 'ready_to_start') return 'ready'
  if (['awaiting_assignment', 'awaiting_entitlement'].includes(state)) return 'waiting'
  return 'open'
}

function makeDefaultPagination(): Pagination {
  return {
    page: 1,
    pageSize: PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
  }
}

function toOptionalNumber(value: string) {
  if (!value.trim()) return undefined
  const numberValue = Number(value)
  return Number.isInteger(numberValue) ? numberValue : undefined
}

function AdminDashboard() {
  const currentUser = getStoredUser()
  const isPlatformOwner = currentUser?.role === 'admin' && currentUser.adminScope === 'platform_owner'
  const [activeTab, setActiveTab] = useState<AdminTab>('requests')
  const [dashboard, setDashboard] = useState<AdminDashboardStats | null>(null)

  const [requestFilters, setRequestFilters] = useState({
    search: '',
    status: '',
    requestType: '',
    assigned: '',
    entitlementStatus: '',
    operationalState: '',
    counsellorId: '',
    startDate: '',
    endDate: '',
    sortBy: 'createdAt',
    sortDirection: 'desc' as 'asc' | 'desc',
  })
  const [requests, setRequests] = useState<CareerRequest[]>([])
  const [requestPagination, setRequestPagination] = useState<Pagination>(
    makeDefaultPagination(),
  )

  const [sessionFilters, setSessionFilters] = useState({
    search: '',
    status: '',
    counsellorId: '',
    startDate: '',
    endDate: '',
    year: '',
    month: '',
    sortBy: 'scheduledStartAt',
    sortDirection: 'desc' as 'asc' | 'desc',
  })
  const [sessions, setSessions] = useState<CareerSession[]>([])
  const [sessionPagination, setSessionPagination] = useState<Pagination>(
    makeDefaultPagination(),
  )

  const [counsellors, setCounsellors] = useState<CounsellorProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingRequests, setIsLoadingRequests] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [adminNotifications, setAdminNotifications] = useState<CareerNotification[]>([])
  const [adminUnreadNotificationCount, setAdminUnreadNotificationCount] = useState(0)
  const [showAdminNotifications, setShowAdminNotifications] = useState(false)

  const [selectedRequest, setSelectedRequest] = useState<CareerRequest | null>(
    null,
  )
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [detailMessages, setDetailMessages] = useState<RequestMessage[]>([])
  const [internalNotes, setInternalNotes] = useState<RequestMessage[]>([])
  const [internalNoteText, setInternalNoteText] = useState('')
  const [publicMessageText, setPublicMessageText] = useState('')
  const [isSendingInternalNote, setIsSendingInternalNote] = useState(false)
  const [isSendingPublicMessage, setIsSendingPublicMessage] = useState(false)
  const [detailSessions, setDetailSessions] = useState<CareerSession[]>([])
  const [entitlementHistory, setEntitlementHistory] = useState<
    EntitlementAdjustment[]
  >([])
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [newCounsellorId, setNewCounsellorId] = useState('')
  const [futureSessionAction, setFutureSessionAction] = useState<'transfer' | 'cancel'>(
    'transfer',
  )
  const [actionReason, setActionReason] = useState('')
  const [removeCounsellorReason, setRemoveCounsellorReason] = useState('')
  const [sessionsGrantedInput, setSessionsGrantedInput] = useState('')
  const [isActionRunning, setIsActionRunning] = useState(false)

  const publicConversationListRef = useRef<HTMLDivElement>(null)
  const internalNotesListRef = useRef<HTMLDivElement>(null)

  const detailDeliveryState = useMemo(
    () => (selectedRequest ? deliveryStateFallback(selectedRequest) : null),
    [selectedRequest],
  )

  function buildRequestFilters(page = 1): AdminRequestFilters {
    return {
      search: requestFilters.search.trim() || undefined,
      status: (requestFilters.status || undefined) as
        | CareerRequestStatus
        | undefined,
      requestType: (requestFilters.requestType || undefined) as 'career_counselling' | 'mock_interview' | undefined,
      assigned:
        requestFilters.assigned === ''
          ? undefined
          : requestFilters.assigned === 'true',
      entitlementStatus: (requestFilters.entitlementStatus || undefined) as
        | DeliveryState['entitlementStatus']
        | undefined,
      operationalState: (requestFilters.operationalState || undefined) as AdminOperationalState | undefined,
      counsellorId: requestFilters.counsellorId || undefined,
      startDate: requestFilters.startDate || undefined,
      endDate: requestFilters.endDate || undefined,
      page,
      pageSize: PAGE_SIZE,
      sortBy: requestFilters.sortBy as AdminRequestFilters['sortBy'],
      sortDirection: requestFilters.sortDirection,
    }
  }

  function buildSessionFilters(page = 1): AdminSessionFilters {
    return {
      search: sessionFilters.search.trim() || undefined,
      status: (sessionFilters.status || undefined) as
        | CareerSession['status']
        | undefined,
      counsellorId: sessionFilters.counsellorId || undefined,
      startDate: sessionFilters.startDate || undefined,
      endDate: sessionFilters.endDate || undefined,
      year: toOptionalNumber(sessionFilters.year),
      month: toOptionalNumber(sessionFilters.month),
      page,
      pageSize: PAGE_SIZE,
      sortBy: sessionFilters.sortBy as AdminSessionFilters['sortBy'],
      sortDirection: sessionFilters.sortDirection,
    }
  }

  async function loadDashboard() {
    const response = await adminApi.getDashboard()
    setDashboard(response.dashboard)
  }

  async function loadCounsellors() {
    const response = await adminApi.getCounsellors({ page: 1, pageSize: 100 })
    setCounsellors(response.counsellors)
  }

  async function loadRequests(page = 1) {
    setIsLoadingRequests(true)
    try {
      const response = await adminApi.getRequests(buildRequestFilters(page))
      setRequests(response.requests)
      setRequestPagination(response.pagination)
    } finally {
      setIsLoadingRequests(false)
    }
  }

  async function loadSessions(page = 1) {
    setIsLoadingSessions(true)
    try {
      const response = await adminApi.getSessions(buildSessionFilters(page))
      setSessions(response.sessions)
      setSessionPagination(response.pagination)
    } finally {
      setIsLoadingSessions(false)
    }
  }

  async function loadAdminNotifications() {
    try {
      const response = await notificationApi.getNotifications()
      setAdminNotifications(response.notifications)
      setAdminUnreadNotificationCount(response.unreadCount)
    } catch (error) {
      console.error('Unable to load admin notifications:', error)
    }
  }

  function getUnreadCounsellorAlertCounts(requestId: string) {
    return adminNotifications.reduce(
      (counts, notification) => {
        if (notification.requestId !== requestId || notification.isRead) {
          return counts
        }

        if (notification.notificationType === 'counsellor_message') {
          counts.publicMessages += 1
        }

        if (notification.notificationType === 'counsellor_internal_note') {
          counts.internalNotes += 1
        }

        return counts
      },
      { publicMessages: 0, internalNotes: 0 },
    )
  }

  async function markCounsellorAlertsForRequestRead(
    requestId: string,
    notificationType: 'counsellor_message' | 'counsellor_internal_note',
  ) {
    const unreadForRequest = adminNotifications.filter(
      (notification) =>
        notification.requestId === requestId &&
        notification.notificationType === notificationType &&
        !notification.isRead,
    )

    if (unreadForRequest.length === 0) {
      return
    }

    try {
      await Promise.all(
        unreadForRequest.map((notification) => notificationApi.markAsRead(notification.id)),
      )

      const readAt = new Date().toISOString()
      setAdminNotifications((currentNotifications) =>
        currentNotifications.map((notification) =>
          unreadForRequest.some((unreadNotification) => unreadNotification.id === notification.id)
            ? { ...notification, isRead: true, readAt }
            : notification,
        ),
      )
      setAdminUnreadNotificationCount((currentCount) =>
        Math.max(0, currentCount - unreadForRequest.length),
      )
    } catch (error) {
      console.error('Unable to mark counsellor activity alerts as read:', error)
    }
  }

  function getPreferredDetailTab(requestId: string): DetailTab {
    const counts = getUnreadCounsellorAlertCounts(requestId)

    if (counts.internalNotes > 0) {
      return 'internal_notes'
    }

    if (counts.publicMessages > 0) {
      return 'conversation'
    }

    return 'overview'
  }

  async function openAdminNotification(notification: CareerNotification) {
    setShowAdminNotifications(false)

    if (!notification.isRead) {
      try {
        await notificationApi.markAsRead(notification.id)
        setAdminNotifications((currentNotifications) =>
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
        setAdminUnreadNotificationCount((currentCount) => Math.max(0, currentCount - 1))
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to update the notification.',
        )
      }
    }

    if (notification.requestId) {
      await openRequestDetail(
        notification.requestId,
        notification.notificationType === 'counsellor_internal_note'
          ? 'internal_notes'
          : 'conversation',
      )
    }
  }

  async function loadInitialData() {
    setIsLoading(true)
    setErrorMessage('')
    try {
      await Promise.all([loadDashboard(), loadCounsellors(), loadRequests(1)])
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to load admin controls.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadInitialData()
    void loadAdminNotifications()
  }, [])

  useEffect(() => {
    if (activeTab === 'sessions' && sessions.length === 0 && !isLoadingSessions) {
      void loadSessions(1).catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions.')
      })
    }
  }, [activeTab])

  async function openRequestDetail(requestId: string, initialTab: DetailTab = 'overview') {
    setErrorMessage('')
    setSuccessMessage('')
    setDetailTab(initialTab)
    setIsLoadingDetail(true)

    try {
      const requestResponse = await adminApi.getRequest(requestId)
      setSelectedRequest(requestResponse.request)
      setNewCounsellorId(requestResponse.request.assignedCounsellor?.id || '')
      setSessionsGrantedInput(
        String(deliveryStateFallback(requestResponse.request).sessionsGranted),
      )
      setActionReason('')
      setRemoveCounsellorReason('')

      const [messageResponse, internalNotesResponse, sessionResponse, entitlementResponse] =
        await Promise.all([
          messageApi.getMessages(requestId),
          internalNotesApi.get(requestId),
          sessionApi.getRequestSessions(requestId),
          adminApi.getEntitlementHistory(requestId),
        ])

      setDetailMessages(messageResponse.messages)
      setInternalNotes(internalNotesResponse.internalNotes)
      setInternalNoteText('')
      setPublicMessageText('')
      setDetailSessions(sessionResponse.sessions)
      setEntitlementHistory(entitlementResponse.adjustments)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to load request details.',
      )
      setSelectedRequest(null)
    } finally {
      setIsLoadingDetail(false)
    }
  }

  async function refreshAfterAction(message: string) {
    setSuccessMessage(message)
    await Promise.all([
      loadDashboard(),
      loadRequests(requestPagination.page),
      activeTab === 'sessions' ? loadSessions(sessionPagination.page) : Promise.resolve(),
    ])

    if (selectedRequest) {
      await openRequestDetail(selectedRequest.id, detailTab)
    }
  }

  async function handleApplyRequestFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    try {
      await loadRequests(1)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to filter requests.')
    }
  }

  async function handleApplySessionFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    try {
      await loadSessions(1)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to filter sessions.')
    }
  }

  function resetRequestFilters() {
    setRequestFilters({
      search: '',
      status: '',
      requestType: '',
      assigned: '',
        entitlementStatus: '',
      operationalState: '',
      counsellorId: '',
      startDate: '',
      endDate: '',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    })
    window.setTimeout(() => void loadRequests(1), 0)
  }

  function resetSessionFilters() {
    setSessionFilters({
      search: '',
      status: '',
      counsellorId: '',
      startDate: '',
      endDate: '',
      year: '',
      month: '',
      sortBy: 'scheduledStartAt',
      sortDirection: 'desc',
    })
    window.setTimeout(() => void loadSessions(1), 0)
  }

  async function runAdminAction(action: () => Promise<{ message: string }>) {
    if (!selectedRequest) return
    setIsActionRunning(true)
    setErrorMessage('')
    try {
      const response = await action()
      await refreshAfterAction(response.message)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save this change.')
    } finally {
      setIsActionRunning(false)
    }
  }

  async function handleActivateEngagement() {
    const sessionsGranted = sessionsGrantedInput.trim() === '' ? undefined : Number(sessionsGrantedInput)

    if (!selectedRequest) return

    if (sessionsGranted !== undefined && (!Number.isInteger(sessionsGranted) || sessionsGranted < 0)) {
      setErrorMessage('Enter a whole session count of zero or greater.')
      return
    }

    if (actionReason.trim().length < 5) {
      setErrorMessage('Add a short setup reason of at least 5 characters.')
      return
    }

    await runAdminAction(() =>
      adminApi.activateEngagement(selectedRequest.id, {
        counsellorId: newCounsellorId || null,
        sessionsGranted,
        reason: actionReason.trim(),
      }),
    )
  }

  async function handleAssignCounsellor() {
    if (!selectedRequest || !newCounsellorId) {
      setErrorMessage('Select a counsellor before saving the assignment.')
      return
    }

    await runAdminAction(() =>
      adminApi.assignCounsellor(selectedRequest.id, newCounsellorId, {
        futureSessionAction,
        reason: actionReason.trim(),
      }),
    )
  }

  async function handleRemoveCounsellor() {
    if (!selectedRequest?.assignedCounsellor) return
    if (removeCounsellorReason.trim().length < 5) {
      setErrorMessage('Add a short removal reason of at least 5 characters before removing the counsellor.')
      return
    }

    const confirmed = window.confirm(
      'Remove the assigned counsellor? Any scheduled or reschedule-requested sessions for this engagement will be cancelled, and the request will return to Awaiting assignment.',
    )
    if (!confirmed) return

    await runAdminAction(() =>
      adminApi.unassignCounsellor(selectedRequest.id, removeCounsellorReason.trim()),
    )
  }

  async function handleSetEntitlement() {
    const sessionsGranted = Number(sessionsGrantedInput)
    if (!selectedRequest || !Number.isInteger(sessionsGranted) || sessionsGranted < 0) {
      setErrorMessage('Enter a whole session count of zero or greater.')
      return
    }
    if (actionReason.trim().length < 5) {
      setErrorMessage('Add a short reason of at least 5 characters for the entitlement change.')
      return
    }

    await runAdminAction(() =>
      adminApi.setEntitlement(selectedRequest.id, sessionsGranted, actionReason.trim()),
    )
  }

  async function handleLock() {
    if (!selectedRequest || actionReason.trim().length < 5) {
      setErrorMessage('Add a short reason of at least 5 characters before locking.')
      return
    }
    await runAdminAction(() => adminApi.lockEngagement(selectedRequest.id, actionReason.trim()))
  }

  async function handleReopen() {
    if (!selectedRequest || actionReason.trim().length < 5) {
      setErrorMessage('Add a short reason of at least 5 characters before reopening.')
      return
    }
    await runAdminAction(() => adminApi.reopenEngagement(selectedRequest.id, actionReason.trim()))
  }

  async function handleClose() {
    if (!selectedRequest || actionReason.trim().length < 5) {
      setErrorMessage('Add a short reason of at least 5 characters before closing.')
      return
    }

    const shouldClose = window.confirm(
      'Close this engagement? Any scheduled or reschedule-requested future sessions will be cancelled.',
    )
    if (!shouldClose) return

    await runAdminAction(() => adminApi.closeEngagement(selectedRequest.id, actionReason.trim()))
  }

  async function handleSendPublicMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedRequest || !publicMessageText.trim()) {
      return
    }

    setIsSendingPublicMessage(true)
    setErrorMessage('')

    try {
      const response = await messageApi.sendMessage(
        selectedRequest.id,
        publicMessageText.trim(),
      )

      setDetailMessages((currentMessages) =>
        currentMessages.some((message) => message.id === response.requestMessage.id)
          ? currentMessages
          : [...currentMessages, response.requestMessage],
      )
      setPublicMessageText('')
      setSuccessMessage('Message sent to the user. The assigned counsellor can also see it in the shared conversation.')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to send the user conversation message.',
      )
    } finally {
      setIsSendingPublicMessage(false)
    }
  }

  async function handleSendInternalNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedRequest || !selectedRequest.assignedCounsellor) {
      setErrorMessage('Assign a counsellor before sending an internal team note.')
      return
    }

    if (!internalNoteText.trim()) {
      return
    }

    setIsSendingInternalNote(true)
    setErrorMessage('')

    try {
      const response = await internalNotesApi.send(
        selectedRequest.id,
        internalNoteText.trim(),
      )
      setInternalNotes((currentNotes) =>
        currentNotes.some((note) => note.id === response.internalNote.id)
          ? currentNotes
          : [...currentNotes, response.internalNote],
      )
      setInternalNoteText('')
      setSuccessMessage('Internal note sent to the assigned counsellor.')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to send the internal note.',
      )
    } finally {
      setIsSendingInternalNote(false)
    }
  }

  useEffect(() => {
    if (!selectedRequest?.id) {
      return
    }

    if (detailTab === 'conversation') {
      void markCounsellorAlertsForRequestRead(
        selectedRequest.id,
        'counsellor_message',
      )
    }

    if (detailTab === 'internal_notes') {
      void markCounsellorAlertsForRequestRead(
        selectedRequest.id,
        'counsellor_internal_note',
      )
    }
  }, [detailTab, selectedRequest?.id, adminNotifications])

  useEffect(() => {
    return onRealtimeMessage((message) => {
      if (message.requestId !== selectedRequest?.id || message.isInternal) {
        return
      }

      setDetailMessages((currentMessages) =>
        currentMessages.some((currentMessage) => currentMessage.id === message.id)
          ? currentMessages
          : [...currentMessages, message],
      )
    })
  }, [selectedRequest?.id])

  useEffect(() => {
    return onRealtimeInternalNote((note) => {
      if (note.requestId !== selectedRequest?.id) {
        return
      }

      setInternalNotes((currentNotes) =>
        currentNotes.some((currentNote) => currentNote.id === note.id)
          ? currentNotes
          : [...currentNotes, note],
      )
    })
  }, [selectedRequest?.id])


  useEffect(() => {
    return onRealtimeNotification((notification) => {
      if (
        notification.notificationType !== 'counsellor_message' &&
        notification.notificationType !== 'counsellor_internal_note'
      ) {
        return
      }

      setAdminNotifications((currentNotifications) =>
        currentNotifications.some((currentNotification) => currentNotification.id === notification.id)
          ? currentNotifications
          : [notification, ...currentNotifications],
      )
      setAdminUnreadNotificationCount((currentCount) =>
        notification.isRead ? currentCount : currentCount + 1,
      )
    })
  }, [])

  useLayoutEffect(() => {
    const activeList =
      detailTab === 'conversation'
        ? publicConversationListRef.current
        : detailTab === 'internal_notes'
          ? internalNotesListRef.current
          : null

    if (!activeList) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      activeList.scrollTop = activeList.scrollHeight
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    detailTab,
    selectedRequest?.id,
    detailMessages.length,
    internalNotes.length,
  ])

  return (
    <section className="role-dashboard-section admin-dashboard-section admin-control-section">
      <div className="role-dashboard-container admin-control-container">
        <div className="role-dashboard-heading">
          <div>
            <p className="eyebrow">ADMIN CONTROL CENTER</p>
            <h2>Run request operations with clear, matching filters.</h2>
            <p>
              Each request filter maps to a visible table column. Request-created filters always use the Request created date shown below.
            </p>
          </div>
          <div className="admin-heading-actions">
            <div className="admin-notification-area">
              <button
                className="admin-notification-button"
                type="button"
                onClick={() => setShowAdminNotifications((currentValue) => !currentValue)}
                aria-expanded={showAdminNotifications}
              >
                <span>Notifications</span>
                {adminUnreadNotificationCount > 0 && (
                  <span className="admin-notification-count">
                    {adminUnreadNotificationCount > 99 ? '99+' : adminUnreadNotificationCount}
                  </span>
                )}
              </button>

              {showAdminNotifications && (
                <div className="admin-notification-panel">
                  <div className="admin-notification-panel-header">
                    <div>
                      <strong>Operations alerts</strong>
                      <span>Counsellor messages requiring review</span>
                    </div>
                  </div>

                  {adminNotifications.filter(
                    (notification) => (
                            notification.notificationType === 'counsellor_message' ||
                            notification.notificationType === 'counsellor_internal_note'
                          ),
                  ).length === 0 ? (
                    <p className="admin-notification-empty">
                      No counsellor message alerts yet.
                    </p>
                  ) : (
                    <div className="admin-notification-list">
                      {adminNotifications
                        .filter(
                          (notification) =>
                            (
                            notification.notificationType === 'counsellor_message' ||
                            notification.notificationType === 'counsellor_internal_note'
                          ),
                        )
                        .slice(0, 10)
                        .map((notification) => (
                          <button
                            className={`admin-notification-item ${
                              notification.isRead ? 'is-read' : 'is-unread'
                            }`}
                            key={notification.id}
                            type="button"
                            onClick={() => void openAdminNotification(notification)}
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

            <button
              className="dashboard-refresh-button"
              type="button"
              onClick={() => void Promise.all([loadInitialData(), loadAdminNotifications()])}
            >
              Refresh dashboard
            </button>
          </div>
        </div>

        {errorMessage && <div className="role-dashboard-error">{errorMessage}</div>}
        {successMessage && <div className="role-dashboard-success">{successMessage}</div>}

        {isLoading ? (
          <div className="role-dashboard-loading">Loading admin control center...</div>
        ) : (
          <>
            <div className="dashboard-stat-grid admin-stat-grid admin-stat-grid-wide">
              <article><span>Total users</span><strong>{dashboard?.totalUsers || 0}</strong></article>
              <article><span>Active counsellors</span><strong>{dashboard?.activeCounsellors || 0}</strong></article>
              <article><span>Awaiting assignment</span><strong>{dashboard?.unassignedRequests || 0}</strong></article>
              <article><span>Awaiting entitlement</span><strong>{dashboard?.awaitingEntitlementApproval || 0}</strong></article>
              <article><span>Ready for counsellor</span><strong>{dashboard?.readyToStartRequests || 0}</strong></article>
              <article><span>Exhausted engagements</span><strong>{dashboard?.exhaustedEntitlements || 0}</strong></article>
              <article><span>Upcoming sessions</span><strong>{dashboard?.upcomingSessions || 0}</strong></article>
            </div>

            <nav className="admin-tab-bar" aria-label="Admin sections">
              <button className={activeTab === 'requests' ? 'active' : ''} type="button" onClick={() => setActiveTab('requests')}>Requests</button>
              <button className={activeTab === 'sessions' ? 'active' : ''} type="button" onClick={() => setActiveTab('sessions')}>Sessions</button>
              <button className={activeTab === 'counsellors' ? 'active' : ''} type="button" onClick={() => setActiveTab('counsellors')}>Counsellors</button>
              {isPlatformOwner && (
                <button className={activeTab === 'users' ? 'active' : ''} type="button" onClick={() => setActiveTab('users')}>Users</button>
              )}
            </nav>

            {activeTab === 'requests' && (
              <section className="admin-data-panel">
                <div className="admin-data-panel-heading">
                  <div><p>REQUEST MANAGEMENT</p><h3>Filter, review, assign, and govern engagements</h3></div>
                  <span>{requestPagination.totalItems} matching request{requestPagination.totalItems === 1 ? '' : 's'}</span>
                </div>

                <form className="admin-filter-grid" onSubmit={handleApplyRequestFilters}>
                  <label>Search request, requestor, or counsellor<input value={requestFilters.search} onChange={(event) => setRequestFilters({ ...requestFilters, search: event.target.value })} placeholder="Request no., name, or email" /></label>
                  <label>Request type<select value={requestFilters.requestType || ''} onChange={(event) => setRequestFilters({ ...requestFilters, requestType: event.target.value })}><option value="">All request types</option><option value="career_counselling">Career Counselling</option><option value="mock_interview">Mock Interview</option></select></label>
                  <label>Request lifecycle<select value={requestFilters.status} onChange={(event) => setRequestFilters({ ...requestFilters, status: event.target.value })}><option value="">All request lifecycles</option>{REQUEST_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
                  <label>Operational status<select value={requestFilters.operationalState} onChange={(event) => setRequestFilters({ ...requestFilters, operationalState: event.target.value })}><option value="">All operational statuses</option><option value="awaiting_assignment">Awaiting assignment</option><option value="awaiting_entitlement">Awaiting session approval</option><option value="ready_to_start">Ready for counsellor</option><option value="active">Active</option><option value="exhausted">Exhausted</option><option value="locked">Locked</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label>
                  <label>Counsellor assignment<select value={requestFilters.assigned} onChange={(event) => setRequestFilters({ ...requestFilters, assigned: event.target.value })}><option value="">All assignment states</option><option value="true">Assigned</option><option value="false">Unassigned</option></select></label>
                  <label>Assigned counsellor<select value={requestFilters.counsellorId} onChange={(event) => setRequestFilters({ ...requestFilters, counsellorId: event.target.value })}><option value="">All counsellors</option>{counsellors.map((counsellor) => <option key={counsellor.id} value={counsellor.id}>{counsellor.fullName}</option>)}</select></label>
                  <label>Entitlement status<select value={requestFilters.entitlementStatus} onChange={(event) => setRequestFilters({ ...requestFilters, entitlementStatus: event.target.value })}><option value="">All entitlement statuses</option><option value="inactive">Not approved</option><option value="active">Approved with sessions remaining</option><option value="exhausted">Exhausted</option><option value="revoked">Revoked</option></select></label>
                  <label>Request created from<input type="date" value={requestFilters.startDate} onChange={(event) => setRequestFilters({ ...requestFilters, startDate: event.target.value })} /></label>
                  <label>Request created to<input type="date" value={requestFilters.endDate} onChange={(event) => setRequestFilters({ ...requestFilters, endDate: event.target.value })} /></label>
                  <label>Sort by<select value={requestFilters.sortBy} onChange={(event) => setRequestFilters({ ...requestFilters, sortBy: event.target.value })}><option value="createdAt">Request created</option><option value="updatedAt">Last updated</option><option value="status">Request lifecycle</option><option value="sessionsRemaining">Sessions remaining</option></select></label>
                  <label>Direction<select value={requestFilters.sortDirection} onChange={(event) => setRequestFilters({ ...requestFilters, sortDirection: event.target.value as 'asc' | 'desc' })}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
                  <div className="admin-filter-actions"><button className="small-primary-button" type="submit" disabled={isLoadingRequests}>{isLoadingRequests ? 'Applying...' : 'Apply filters'}</button><button className="admin-secondary-button" type="button" onClick={resetRequestFilters}>Clear</button></div>
                </form>

                <div className="admin-table-wrap">
                  <table className="admin-data-table">
                    <thead><tr><th>Request</th><th>Requestor</th><th>Counsellor</th><th>Session entitlement</th><th>Operational status</th><th>Request created</th><th>Last updated</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                      {requests.length === 0 ? <tr><td colSpan={8} className="admin-empty-cell">No requests match the selected filters.</td></tr> : requests.map((request) => {
                        const state = deliveryStateFallback(request)
                        const operationalState = getOperationalState(request)
                        const needsSetup = ['awaiting_assignment', 'awaiting_entitlement'].includes(operationalState)
                        const unreadAlerts = getUnreadCounsellorAlertCounts(request.id)
                        const hasUnreadAlerts =
                          unreadAlerts.publicMessages > 0 || unreadAlerts.internalNotes > 0
                        return <tr key={request.id}>
                          <td><strong>{request.requestNumber}</strong><span>{requestLabel(request)}</span><small>Lifecycle: {formatStatus(request.status)}</small></td>
                          <td><strong>{request.user?.fullName || 'Unknown requestor'}</strong><span>{request.user?.email || '—'}</span></td>
                          <td>
                            {request.assignedCounsellor ? (
                              <>
                                <strong>{request.assignedCounsellor.fullName}</strong>
                                <span>{request.assignedCounsellor.email}</span>
                              </>
                            ) : (
                              <span className="admin-muted">Unassigned</span>
                            )}

                          </td>
                          <td><strong>{state.sessionsRemaining} remaining</strong><span>{state.sessionsGranted} approved · {state.sessionsConsumed} completed</span><small className={`entitlement-state ${state.entitlementStatus}`}>{formatStatus(state.entitlementStatus)}</small></td>
                          <td><span className={`admin-state-pill ${getOperationalStateClass(operationalState)}`}>{getOperationalStateLabel(operationalState)}</span></td>
                          <td>{formatDate(request.submittedAt || request.createdAt)}</td>
                          <td>{formatDate(request.updatedAt || request.createdAt)}</td>
                          <td>
                            <div className="admin-request-action-cell">
                              <button
                                className={needsSetup ? 'admin-activate-row-button' : 'view-conversation-button'}
                                type="button"
                                onClick={() => void openRequestDetail(request.id, getPreferredDetailTab(request.id))}
                              >
                                {needsSetup ? 'Set up' : 'Manage'}
                              </button>
                              {hasUnreadAlerts && (
                                <div className="admin-request-alerts" aria-label="Unread counsellor activity">
                                  {unreadAlerts.publicMessages > 0 && (
                                    <span className="admin-request-alert public-message-alert">
                                      {unreadAlerts.publicMessages} new message{unreadAlerts.publicMessages === 1 ? '' : 's'}
                                    </span>
                                  )}
                                  {unreadAlerts.internalNotes > 0 && (
                                    <span className="admin-request-alert private-note-alert">
                                      {unreadAlerts.internalNotes} private note{unreadAlerts.internalNotes === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="admin-pagination"><span>Page {requestPagination.page} of {requestPagination.totalPages}</span><div><button type="button" disabled={requestPagination.page <= 1 || isLoadingRequests} onClick={() => void loadRequests(requestPagination.page - 1)}>Previous</button><button type="button" disabled={requestPagination.page >= requestPagination.totalPages || isLoadingRequests} onClick={() => void loadRequests(requestPagination.page + 1)}>Next</button></div></div>
              </section>
            )}

            {activeTab === 'sessions' && (
              <section className="admin-data-panel">
                <div className="admin-data-panel-heading"><div><p>SESSION HISTORY</p><h3>Search historical sessions without loading them all</h3></div><span>{sessionPagination.totalItems} matching session{sessionPagination.totalItems === 1 ? '' : 's'}</span></div>
                <form className="admin-filter-grid admin-session-filter-grid" onSubmit={handleApplySessionFilters}>
                  <label>Search<input value={sessionFilters.search} onChange={(event) => setSessionFilters({ ...sessionFilters, search: event.target.value })} placeholder="Request, user, counsellor" /></label>
                  <label>Status<select value={sessionFilters.status} onChange={(event) => setSessionFilters({ ...sessionFilters, status: event.target.value })}><option value="">All statuses</option>{SESSION_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
                  <label>Counsellor<select value={sessionFilters.counsellorId} onChange={(event) => setSessionFilters({ ...sessionFilters, counsellorId: event.target.value })}><option value="">All counsellors</option>{counsellors.map((counsellor) => <option key={counsellor.id} value={counsellor.id}>{counsellor.fullName}</option>)}</select></label>
                  <label>Start date<input type="date" value={sessionFilters.startDate} onChange={(event) => setSessionFilters({ ...sessionFilters, startDate: event.target.value })} /></label>
                  <label>End date<input type="date" value={sessionFilters.endDate} onChange={(event) => setSessionFilters({ ...sessionFilters, endDate: event.target.value })} /></label>
                  <label>Year<input inputMode="numeric" maxLength={4} placeholder="2026" value={sessionFilters.year} onChange={(event) => setSessionFilters({ ...sessionFilters, year: event.target.value })} /></label>
                  <label>Month<select value={sessionFilters.month} onChange={(event) => setSessionFilters({ ...sessionFilters, month: event.target.value })}><option value="">Any month</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, index, 1))}</option>)}</select></label>
                  <label>Sort by<select value={sessionFilters.sortBy} onChange={(event) => setSessionFilters({ ...sessionFilters, sortBy: event.target.value })}><option value="scheduledStartAt">Scheduled date</option><option value="createdAt">Created</option><option value="updatedAt">Last updated</option><option value="status">Status</option></select></label>
                  <label>Direction<select value={sessionFilters.sortDirection} onChange={(event) => setSessionFilters({ ...sessionFilters, sortDirection: event.target.value as 'asc' | 'desc' })}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
                  <div className="admin-filter-actions"><button className="small-primary-button" type="submit" disabled={isLoadingSessions}>{isLoadingSessions ? 'Applying...' : 'Apply filters'}</button><button className="admin-secondary-button" type="button" onClick={resetSessionFilters}>Clear</button></div>
                </form>
                <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>Session</th><th>Request</th><th>User</th><th>Counsellor</th><th>Scheduled</th><th>Status</th></tr></thead><tbody>{sessions.length === 0 ? <tr><td colSpan={6} className="admin-empty-cell">No sessions match the selected filters.</td></tr> : sessions.map((session) => <tr key={session.id}><td><strong>{session.title}</strong><span>{session.meetingProvider || 'Meeting'}</span></td><td>{session.requestNumber}</td><td>{session.user?.fullName || '—'}</td><td>{session.counsellor?.fullName || '—'}</td><td>{formatDateTime(session.scheduledStartAt)}<span>{session.timezone}</span></td><td><span className={`session-status ${session.status}`}>{formatStatus(session.status)}</span></td></tr>)}</tbody></table></div>
                <div className="admin-pagination"><span>Page {sessionPagination.page} of {sessionPagination.totalPages}</span><div><button type="button" disabled={sessionPagination.page <= 1 || isLoadingSessions} onClick={() => void loadSessions(sessionPagination.page - 1)}>Previous</button><button type="button" disabled={sessionPagination.page >= sessionPagination.totalPages || isLoadingSessions} onClick={() => void loadSessions(sessionPagination.page + 1)}>Next</button></div></div>
              </section>
            )}

            {activeTab === 'counsellors' && (
              <section className="admin-data-panel"><div className="admin-data-panel-heading"><div><p>COUNSELLOR CAPACITY</p><h3>Current availability and active workload</h3></div><span>{counsellors.length} counsellor{counsellors.length === 1 ? '' : 's'}</span></div><div className="admin-counsellor-grid">{counsellors.map((counsellor) => <article className="admin-counsellor-card admin-counsellor-card-expanded" key={counsellor.id}><div className="admin-counsellor-avatar">{counsellor.fullName.charAt(0).toUpperCase()}</div><div><strong>{counsellor.fullName}</strong><span>{counsellor.email}</span><small>{counsellor.profile.headline || 'Career counsellor'}</small><p>{counsellor.activeRequestCount} active request{counsellor.activeRequestCount === 1 ? '' : 's'}</p><em className={counsellor.isAvailable ? 'counsellor-available' : 'counsellor-unavailable'}>{counsellor.isAvailable ? 'Available' : 'Unavailable'}</em></div></article>)}</div></section>
            )}

            {isPlatformOwner && activeTab === 'users' && <AdminUsersPanel />}
          </>
        )}
      </div>

      {selectedRequest && (
        <div className="admin-detail-backdrop" role="presentation" onMouseDown={() => setSelectedRequest(null)}>
          <aside className="admin-detail-drawer" role="dialog" aria-modal="true" aria-label="Request management" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-detail-header"><div><p>{selectedRequest.requestNumber}</p><h3>{requestLabel(selectedRequest)}</h3><span className={`workspace-status ${selectedRequest.status}`}>{detailDeliveryState?.isLocked ? 'locked' : formatStatus(selectedRequest.status)}</span></div><button type="button" aria-label="Close request details" onClick={() => setSelectedRequest(null)}>×</button></div>
            {isLoadingDetail ? <div className="role-dashboard-loading">Loading request details...</div> : <>
              <div className="admin-detail-tabs"><button className={detailTab === 'overview' ? 'active' : ''} type="button" onClick={() => setDetailTab('overview')}>Overview</button><button className={detailTab === 'conversation' ? 'active' : ''} type="button" onClick={() => setDetailTab('conversation')}>User conversation</button><button className={detailTab === 'internal_notes' ? 'active' : ''} type="button" onClick={() => setDetailTab('internal_notes')}>Internal team notes</button><button className={detailTab === 'sessions' ? 'active' : ''} type="button" onClick={() => setDetailTab('sessions')}>Sessions</button><button className={detailTab === 'entitlement' ? 'active' : ''} type="button" onClick={() => setDetailTab('entitlement')}>Entitlement</button></div>

              {detailTab === 'overview' && detailDeliveryState && <div className="admin-detail-content">
                <section className="admin-summary-box"><strong>User</strong><span>{selectedRequest.user?.fullName || 'Unknown user'}</span><small>{selectedRequest.user?.email || '—'}</small></section>
                <section className="admin-summary-box"><strong>Goal</strong><p>{selectedRequest.description}</p></section>
                <section className="admin-entitlement-summary"><div><span>Approved</span><strong>{detailDeliveryState.sessionsGranted}</strong></div><div><span>Completed</span><strong>{detailDeliveryState.sessionsConsumed}</strong></div><div><span>Remaining</span><strong>{detailDeliveryState.sessionsRemaining}</strong></div><div><span>State</span><strong>{detailDeliveryState.isLocked ? 'Locked' : formatStatus(detailDeliveryState.entitlementStatus)}</strong></div></section>

                {!detailDeliveryState.isLocked && !selectedRequest.assignedCounsellor && <section className="admin-activation-section"><div><p>ENGAGEMENT SETUP</p><h4>Set up this engagement</h4><span>Complete setup in stages. Select a counsellor when one is available, or leave it unassigned. Approve sessions now or later. The counsellor can begin only after both are complete.</span></div><label>Counsellor<select value={newCounsellorId} onChange={(event) => setNewCounsellorId(event.target.value)}><option value="">Assign later — awaiting assignment</option>{counsellors.map((counsellor) => <option key={counsellor.id} value={counsellor.id}>{counsellor.fullName}{counsellor.isAvailable ? '' : ' (unavailable)'}</option>)}</select></label><div className="admin-package-buttons"><button type="button" onClick={() => setSessionsGrantedInput('0')}>Approve later</button><button type="button" onClick={() => setSessionsGrantedInput('3')}>3 sessions</button><button type="button" onClick={() => setSessionsGrantedInput('6')}>6 sessions</button><button type="button" onClick={() => setSessionsGrantedInput('12')}>12 sessions</button></div><label>Approved sessions<input type="number" min="0" step="1" value={sessionsGrantedInput} onChange={(event) => setSessionsGrantedInput(event.target.value)} /></label><label>Setup reason<textarea rows={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="For example: Request approved; counsellor selection pending." /></label><button className="admin-activate-button" type="button" disabled={isActionRunning} onClick={() => void handleActivateEngagement()}>{isActionRunning ? 'Saving...' : 'Save engagement setup'}</button></section>}

                {selectedRequest.assignedCounsellor && <section className="admin-action-section"><h4>Counsellor assignment</h4><p className="admin-helper-text">Current counsellor: <strong>{selectedRequest.assignedCounsellor.fullName}</strong>. Use this section to change or remove the existing assignment. The initial engagement setup is intentionally locked here so it cannot accidentally remove the counsellor.</p><label>New counsellor<select value={newCounsellorId} onChange={(event) => setNewCounsellorId(event.target.value)}>{counsellors.map((counsellor) => <option key={counsellor.id} value={counsellor.id}>{counsellor.fullName}{counsellor.isAvailable ? '' : ' (unavailable)'}</option>)}</select></label><label>Future scheduled sessions<select value={futureSessionAction} onChange={(event) => setFutureSessionAction(event.target.value as 'transfer' | 'cancel')}><option value="transfer">Transfer to new counsellor</option><option value="cancel">Cancel and schedule again</option></select></label><div className="admin-action-row"><button className="small-primary-button" type="button" disabled={isActionRunning || !newCounsellorId || newCounsellorId === selectedRequest.assignedCounsellor.id} onClick={() => void handleAssignCounsellor()}>{isActionRunning ? 'Saving...' : 'Change counsellor'}</button></div><div className="admin-danger-zone"><strong>Remove counsellor</strong><p>Returns this engagement to Awaiting assignment. Scheduled or reschedule-requested sessions will be cancelled because every session must have an assigned counsellor.</p><label>Removal reason<textarea rows={3} value={removeCounsellorReason} onChange={(event) => setRemoveCounsellorReason(event.target.value)} placeholder="For example: Counsellor unavailable; returning request to assignment queue." /></label><button className="admin-close-button" type="button" disabled={isActionRunning} onClick={() => void handleRemoveCounsellor()}>{isActionRunning ? 'Removing...' : 'Remove counsellor'}</button></div></section>}
                <section className="admin-action-section"><h4>Engagement controls</h4><label>Reason for this administrative change<textarea rows={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Required for entitlement, lock, reopen, or close actions." /></label><div className="admin-action-row">{detailDeliveryState.isLocked ? <button className="admin-reopen-button" type="button" disabled={isActionRunning} onClick={() => void handleReopen()}>Reopen engagement</button> : <button className="admin-lock-button" type="button" disabled={isActionRunning} onClick={() => void handleLock()}>Lock engagement</button>}<button className="admin-close-button" type="button" disabled={isActionRunning} onClick={() => void handleClose()}>Close engagement</button></div></section>
              </div>}

              {detailTab === 'conversation' && <div className="admin-detail-content"><section className="internal-notes-panel"><header><div><p>SHARED USER CONVERSATION</p><h4>Conversation with {selectedRequest.user?.fullName || 'user'}</h4></div><span>{selectedRequest.assignedCounsellor ? `Counsellor: ${selectedRequest.assignedCounsellor.fullName}` : 'No counsellor assigned yet'}</span></header><p className="internal-notes-explainer">Messages here are visible to the user, the assigned counsellor, and CareerConnect administrators. Use Internal team notes for private operational communication.</p><div className="admin-message-list" ref={publicConversationListRef}>{detailMessages.length === 0 ? <div className="message-empty-state">No messages have been sent for this request.</div> : detailMessages.map((message) => <article className={`admin-message-bubble ${message.senderType === 'user' ? 'admin-message-user' : message.senderType === 'counsellor' ? 'admin-message-counsellor' : 'admin-message-system'}`} key={message.id}><strong>{message.sender?.fullName || formatStatus(message.senderType)}</strong><p>{message.messageBody}</p><small>{formatDateTime(message.createdAt)}</small></article>)}</div><form className="internal-note-composer admin-public-message-composer" onSubmit={handleSendPublicMessage}><textarea value={publicMessageText} onChange={(event) => setPublicMessageText(event.target.value)} placeholder={`Write a message to ${selectedRequest.user?.fullName || 'the user'}...`} rows={4} maxLength={5000}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      if (!isSendingPublicMessage && publicMessageText.trim()) {
                        event.currentTarget.form?.requestSubmit()
                      }
                    }
                  }}
                /><button className="small-primary-button" disabled={isSendingPublicMessage || !publicMessageText.trim()} type="submit">{isSendingPublicMessage ? 'Sending...' : 'Send message to user'}</button></form></section></div>}

              {detailTab === 'internal_notes' && <div className="admin-detail-content"><section className="internal-notes-panel"><header><div><p>PRIVATE TEAM COMMUNICATION</p><h4>Internal notes</h4></div><span>{selectedRequest.assignedCounsellor ? `With ${selectedRequest.assignedCounsellor.fullName}` : 'Counsellor assignment required'}</span></header><p className="internal-notes-explainer">Only CareerConnect administrators and the assigned counsellor can view these notes. They are never visible to the user.</p><div className="internal-notes-list" ref={internalNotesListRef}>{internalNotes.length === 0 ? <div className="message-empty-state">No internal team notes yet.</div> : internalNotes.map((note) => <article className={note.senderType === 'admin' ? 'internal-note-from-admin' : 'internal-note-from-counsellor'} key={note.id}><strong>{note.sender?.fullName || formatStatus(note.senderType)}</strong><p>{note.messageBody}</p><small>{formatDateTime(note.createdAt)}</small></article>)}</div>{selectedRequest.assignedCounsellor ? <form className="internal-note-composer" onSubmit={handleSendInternalNote}><textarea value={internalNoteText} onChange={(event) => setInternalNoteText(event.target.value)} placeholder={`Write a private note to ${selectedRequest.assignedCounsellor.fullName}...`} rows={4} maxLength={5000}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      if (!isSendingInternalNote && internalNoteText.trim()) {
                        event.currentTarget.form?.requestSubmit()
                      }
                    }
                  }}
                /><button className="small-primary-button" disabled={isSendingInternalNote || !internalNoteText.trim()} type="submit">{isSendingInternalNote ? 'Sending...' : 'Send internal note'}</button></form> : <div className="internal-notes-assignment-warning">Assign a counsellor in Overview before starting internal team communication.</div>}</section></div>}

              {detailTab === 'sessions' && <div className="admin-detail-content"><div className="admin-detail-session-list">{detailSessions.length === 0 ? <div className="session-empty-state">No sessions have been scheduled yet.</div> : detailSessions.map((session) => <article className="admin-detail-session-card" key={session.id}><div><strong>{session.title}</strong><span>{formatDateTime(session.scheduledStartAt)}</span><small>{session.counsellor?.fullName || 'No counsellor'} · {session.meetingProvider || 'Meeting'}</small></div><em className={`session-status ${session.status}`}>{formatStatus(session.status)}</em></article>)}</div></div>}

              {detailTab === 'entitlement' && detailDeliveryState && <div className="admin-detail-content"><section className="admin-action-section"><h4>Approve or adjust sessions</h4><div className="admin-package-buttons"><button type="button" onClick={() => setSessionsGrantedInput('3')}>3 sessions</button><button type="button" onClick={() => setSessionsGrantedInput('6')}>6 sessions</button><button type="button" onClick={() => setSessionsGrantedInput('12')}>12 sessions</button></div><label>Total approved sessions<input type="number" min="0" step="1" value={sessionsGrantedInput} onChange={(event) => setSessionsGrantedInput(event.target.value)} /></label><p className="admin-helper-text">Completed sessions cannot be reduced. Current completed count: {detailDeliveryState.sessionsConsumed}.</p><label>Reason for entitlement adjustment<textarea rows={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="For example: Payment confirmed for a 6-session package." /></label><button className="small-primary-button" type="button" disabled={isActionRunning} onClick={() => void handleSetEntitlement()}>{isActionRunning ? 'Saving...' : 'Save entitlement'}</button></section><section className="admin-history-section"><h4>Entitlement history</h4>{entitlementHistory.length === 0 ? <p>No entitlement changes recorded yet.</p> : entitlementHistory.map((adjustment) => <article key={adjustment.id}><div><strong>{formatStatus(adjustment.adjustmentType)}</strong><span>{adjustment.sessionsDelta > 0 ? '+' : ''}{adjustment.sessionsDelta} session{Math.abs(adjustment.sessionsDelta) === 1 ? '' : 's'}</span></div><p>{adjustment.reason || 'No reason recorded.'}</p><small>{formatDateTime(adjustment.createdAt)}{adjustment.createdByName ? ` · ${adjustment.createdByName}` : ''}</small></article>)}</section></div>}
            </>}
          </aside>
        </div>
      )}
    </section>
  )
}

export default AdminDashboard
