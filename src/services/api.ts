const API_BASE_URL = 'http://localhost:4000/api'

export type UserRole = 'user' | 'counsellor' | 'admin'
export type AdminScope = 'operational' | 'platform_owner'
export type AuthUser = { id: string; fullName: string; email: string; role: UserRole; adminScope?: AdminScope | null; phone?: string | null; profilePhotoUrl?: string | null; emailVerified: boolean; createdAt: string }
export type AuthResponse = { success: boolean; message: string; token: string; user: AuthUser }
export type CareerRequestStatus = 'submitted' | 'assigned' | 'in_progress' | 'session_scheduled' | 'completed' | 'cancelled' | 'closed'
export type CareerSessionStatus = 'scheduled' | 'reschedule_requested' | 'cancelled' | 'completed' | 'no_show'
export type CounsellorOperationalState = 'needs_attention' | 'ready_for_counsellor' | 'active' | 'waiting_approval' | 'exhausted' | 'locked' | 'closed' | 'cancelled'

export type DeliveryState = {
  isLocked: boolean
  lockedAt?: string | null
  lockedBy?: string | null
  lockReason?: string | null
  sessionsGranted: number
  sessionsConsumed: number
  sessionsRemaining: number
  entitlementStatus: 'inactive' | 'active' | 'exhausted' | 'revoked'
  operationalState?: CounsellorOperationalState
  hasCounsellorActivity?: boolean
  hasAttention?: boolean
  canSendMessages: boolean
  canScheduleSessions: boolean
  canManageSessions: boolean
  readOnlyMessage?: string | null
}

export type CareerRequest = {
  id: string; requestNumber: string; requestType: 'career_counselling' | 'mock_interview'; status: CareerRequestStatus
  title: string; description: string; industry?: string | null; currentJobTitle?: string | null
  yearsOfExperience?: number | null; targetRole?: string | null; skills?: string[]
  preferredDate?: string | null; preferredTimeSlot?: string | null; timezone?: string | null
  preferredSlots?: SchedulingSlot[]
  slotProposals?: SlotProposal[]
  schedulingStatus?: SchedulingStatus
  resumeDocument?: ResumeDocument | null
  submittedAt?: string | null; assignedAt?: string | null; completedAt?: string | null; cancelledAt?: string | null
  cancellationReason?: string | null; deliveryState?: DeliveryState; createdAt: string; updatedAt?: string
  user?: { id: string; fullName: string; email: string; phone?: string | null } | null
  assignedCounsellor?: { id: string; fullName: string; email: string } | null
  unreadMessageCount?: number
}

export type RequestMessage = { id: string; requestId: string; senderType: 'user' | 'counsellor' | 'admin' | 'system'; sender: { id: string; fullName: string; role: UserRole } | null; messageBody: string; isInternal: boolean; readAt?: string | null; createdAt: string }
export type CareerSession = { id: string; requestId: string; requestNumber: string; title: string; scheduledStartAt: string; scheduledEndAt: string; timezone: string; meetingProvider?: string | null; meetingLink?: string | null; meetingLinkUpdatedAt?: string | null; status: CareerSessionStatus; rescheduleReason?: string | null; cancellationReason?: string | null; cancelledAt?: string | null; completedAt?: string | null; reminderSentAt?: string | null; user?: { id: string; fullName: string; email: string } | null; counsellor?: { id: string; fullName: string; email: string } | null; createdAt: string; updatedAt: string }
export type CareerNotification = { id: string; requestId?: string | null; sessionId?: string | null; notificationType: string; title: string; message: string; actionUrl?: string | null; isRead: boolean; readAt?: string | null; createdAt: string }
export type CounsellorProfile = { id: string; fullName: string; email: string; phone?: string | null; isActive: boolean; isAvailable: boolean; profile: { headline?: string | null; biography?: string | null; yearsOfExperience?: number | null; specializations: string[]; languages: string[]; linkedinUrl?: string | null }; activeRequestCount: number; createdAt: string }
export type Pagination = { page: number; pageSize: number; totalItems: number; totalPages: number }
export type AdminDashboardStats = { totalUsers: number; activeCounsellors: number; totalRequests: number; unassignedRequests: number; activeRequests: number; completedRequests: number; upcomingSessions: number; awaitingEntitlementApproval?: number; readyToStartRequests?: number; exhaustedEntitlements?: number }
export type CounsellorDashboardStats = { needsAttention: number; readyForCounsellor: number; activeEngagements: number; waitingForApproval: number; sessionsToday: number; upcomingThisWeek: number }
export type EntitlementAdjustment = { id: string; adjustmentType: string; source: string; sessionsDelta: number; reason?: string | null; paymentProvider?: string | null; paymentReferenceId?: string | null; metadata?: Record<string, unknown>; createdAt: string; createdByName?: string | null; sessionTitle?: string | null }
export type SchedulingStatus = 'requested_preferences' | 'counsellor_review' | 'alternative_slots_proposed' | 'user_slot_selected' | 'confirmed'
export type SchedulingSlot = { id?: string; scheduledStartAt: string; scheduledEndAt: string; timezone: string; displayOrder?: number; status?: string; source?: 'user_preference' | 'counsellor_alternative' }
export type SlotProposal = { id: string; requestId: string; counsellorId: string; message?: string | null; status: 'proposed' | 'selected' | 'confirmed' | 'cancelled' | 'expired'; selectedOptionId?: string | null; createdAt: string; updatedAt: string; options: SchedulingSlot[] }

type ApiErrorResponse = { success?: boolean; message?: string; errors?: Array<{ field: string; message: string }> }

function getToken() { return localStorage.getItem('careerconnect_token') }
export function saveAuthSession(token: string, user: AuthUser) { localStorage.setItem('careerconnect_token', token); localStorage.setItem('careerconnect_user', JSON.stringify(user)) }
export function clearAuthSession() { localStorage.removeItem('careerconnect_token'); localStorage.removeItem('careerconnect_user') }
export function getStoredUser(): AuthUser | null { const saved = localStorage.getItem('careerconnect_user'); if (!saved) return null; try { return JSON.parse(saved) as AuthUser } catch { clearAuthSession(); return null } }

function toQueryString(filters: Record<string, string | number | boolean | undefined | null>) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)) })
  const query = params.toString()
  return query ? `?${query}` : ''
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const responseData = (await response.json().catch(() => null)) as T | ApiErrorResponse | null
  if (!response.ok) {
    const data = responseData as ApiErrorResponse | null
    throw new Error(data?.errors?.map((error) => error.message).join(' ') || data?.message || 'Something went wrong. Please try again.')
  }
  return responseData as T
}


async function apiFormRequest<T>(path: string, formData: FormData, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, body: formData, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const responseData = (await response.json().catch(() => null)) as T | ApiErrorResponse | null
  if (!response.ok) { const data = responseData as ApiErrorResponse | null; throw new Error(data?.message || 'Something went wrong. Please try again.') }
  return responseData as T
}
export const authApi = {
  register: (payload: { fullName: string; email: string; password: string; phone?: string }) => apiRequest<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) => apiRequest<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  forgotPassword: (payload: { email: string }) => apiRequest<{ success: boolean; message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(payload) }),
  resetPassword: (payload: { token: string; password: string; confirmPassword: string }) => apiRequest<{ success: boolean; message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => apiRequest<{ success: boolean; user: AuthUser }>('/auth/me'),
}
export const requestApi = {
  getMyRequests: () => apiRequest<{ success: boolean; count: number; requests: CareerRequest[] }>('/requests/my'),
  createRequest: (payload: { requestType: 'career_counselling' | 'mock_interview'; title: string; description: string; industry?: string; currentJobTitle?: string; yearsOfExperience?: number; targetRole?: string; skills?: string[]; preferredDate?: string; preferredTimeSlot?: string; timezone?: string; preferredSlots?: Array<{ scheduledStartAt: string; scheduledEndAt: string; timezone: string }>; serviceContact?: { phoneCountryCode: string; phoneNumber: string; serviceCommunicationConsent: true }; additionalDetails?: Record<string, unknown> }) => apiRequest<{ success: boolean; message: string; request: CareerRequest }>('/requests', { method: 'POST', body: JSON.stringify(payload) }),
  getScheduling: (requestId: string) => apiRequest<{ success: boolean; requestId: string; schedulingStatus: SchedulingStatus; preferredSlots: SchedulingSlot[]; slotProposals: SlotProposal[] }>(`/requests/${requestId}/scheduling`),
  selectProposalOption: (requestId: string, proposalId: string, optionId: string) => apiRequest<{ success: boolean; message: string; session: CareerSession; schedulingStatus: SchedulingStatus }>(`/requests/${requestId}/slot-proposals/${proposalId}/options/${optionId}/select`, { method: 'POST' }),
}
export const messageApi = {
  getMessages: (requestId: string) => apiRequest<{ success: boolean; count: number; messages: RequestMessage[]; deliveryState?: DeliveryState }>(`/requests/${requestId}/messages`),
  sendMessage: (requestId: string, messageBody: string) => apiRequest<{ success: boolean; message: string; requestMessage: RequestMessage; deliveryState?: DeliveryState }>(`/requests/${requestId}/messages`, { method: 'POST', body: JSON.stringify({ messageBody }) }),
}
export const internalNotesApi = {
  get: (requestId: string) => apiRequest<{ success: boolean; count: number; internalNotes: RequestMessage[] }>(`/requests/${requestId}/internal-notes`),
  send: (requestId: string, messageBody: string) => apiRequest<{ success: boolean; message: string; internalNote: RequestMessage }>(`/requests/${requestId}/internal-notes`, { method: 'POST', body: JSON.stringify({ messageBody }) }),
}
export type SessionListFilters = { search?: string; startDate?: string; endDate?: string; year?: number; month?: number; status?: CareerSessionStatus; page?: number; pageSize?: number; sortBy?: 'scheduledStartAt' | 'createdAt' | 'updatedAt' | 'status'; sortDirection?: 'asc' | 'desc' }
export const sessionApi = {
  getRequestSessions: (requestId: string) => apiRequest<{ success: boolean; count: number; sessions: CareerSession[]; deliveryState?: DeliveryState }>(`/requests/${requestId}/sessions`),
  getMySessions: (filters: SessionListFilters = {}) => apiRequest<{ success: boolean; filters: SessionListFilters; pagination: Pagination; sessions: CareerSession[] }>(`/sessions/my${toQueryString(filters)}`),
  scheduleSession: (requestId: string, payload: { title?: string; scheduledStartAt: string; scheduledEndAt: string; timezone: string; meetingProvider: string; meetingLink?: string }) => apiRequest<{ success: boolean; message: string; session: CareerSession; deliveryState?: DeliveryState }>(`/requests/${requestId}/sessions`, { method: 'POST', body: JSON.stringify(payload) }),
  rescheduleSession: (sessionId: string, payload: { title?: string; scheduledStartAt: string; scheduledEndAt: string; timezone: string; meetingProvider: string; meetingLink?: string }) => apiRequest<{ success: boolean; message: string; session: CareerSession; deliveryState?: DeliveryState }>(`/sessions/${sessionId}/reschedule`, { method: 'PATCH', body: JSON.stringify(payload) }),
  completeSession: (sessionId: string, completionNotes?: string) => apiRequest<{ success: boolean; message: string; session: CareerSession; deliveryState?: DeliveryState }>(`/sessions/${sessionId}/complete`, { method: 'PATCH', body: JSON.stringify({ completionNotes: completionNotes || '' }) }),
}
export const notificationApi = {
  getNotifications: () => apiRequest<{ success: boolean; unreadCount: number; notifications: CareerNotification[] }>('/notifications'),
  markAsRead: (id: string) => apiRequest<{ success: boolean; notification: CareerNotification }>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllAsRead: () => apiRequest<{ success: boolean; message: string; updatedCount: number }>('/notifications/read-all', { method: 'PATCH' }),
}
export type CounsellorQueue = 'all' | 'needs_attention' | 'ready_for_counsellor' | 'active' | 'waiting_approval' | 'completed'
export type CounsellorRequestFilters = { search?: string; queue?: CounsellorQueue; page?: number; pageSize?: number; sortBy?: 'updatedAt' | 'createdAt' | 'requestNumber'; sortDirection?: 'asc' | 'desc' }
export const counsellorApi = {
  getDashboard: () => apiRequest<{ success: boolean; dashboard: CounsellorDashboardStats }>('/counsellor/dashboard'),
  getRequests: (filters: CounsellorRequestFilters = {}) => apiRequest<{ success: boolean; filters: CounsellorRequestFilters; pagination: Pagination; requests: CareerRequest[] }>(`/counsellor/requests${toQueryString(filters)}`),
  getRequest: (id: string) => apiRequest<{ success: boolean; request: CareerRequest }>(`/counsellor/requests/${id}`),
  getPreparation: (id: string) => apiRequest<{ success:boolean; profile:CareerProfile; resume:ResumeDocument|null }>(`/counsellor/requests/${id}/preparation`),
  acceptPreferredSlot: (requestId: string, slotId: string, payload: { meetingProvider: string; meetingLink?: string }) => apiRequest<{ success: boolean; message: string; session: CareerSession; schedulingStatus: SchedulingStatus }>(`/counsellor/requests/${requestId}/preferred-slots/${slotId}/accept`, { method: 'POST', body: JSON.stringify(payload) }),
  proposeAlternateSlots: (requestId: string, payload: { message?: string; slots: Array<{ scheduledStartAt: string; scheduledEndAt: string; timezone: string }> }) => apiRequest<{ success: boolean; message: string; proposal: SlotProposal; schedulingStatus: SchedulingStatus }>(`/counsellor/requests/${requestId}/slot-proposals`, { method: 'POST', body: JSON.stringify(payload) }),
}
export const organizationInquiryApi = {
  create: (payload: { organizationName: string; contactName: string; workEmail: string; phone?: string; countryOrRegion?: string; organizationSize?: string; supportArea: 'hiring_talent_support' | 'leadership_development' | 'career_internal_mobility' | 'custom_workforce_program' | 'not_sure_yet'; targetAudience?: string; expectedScope?: string; desiredTimeline?: string; currentChallenge: string; successOutcome?: string; preferredDiscussionTime?: string; contactPreference: 'email' | 'phone' | 'either' }) => apiRequest<{ success: boolean; message: string; inquiry: { id: string; status: string; createdAt: string } }>('/organization-inquiries', { method: 'POST', body: JSON.stringify(payload) }),
}

// Admin API remains intentionally compatible with the existing AdminDashboard.
export type AdminOperationalState = 'awaiting_assignment' | 'awaiting_entitlement' | 'ready_to_start' | 'active' | 'exhausted' | 'locked' | 'closed' | 'cancelled'
export type AdminRequestFilters = { status?: CareerRequestStatus; requestType?: 'career_counselling' | 'mock_interview'; assigned?: boolean; locked?: boolean; entitlementStatus?: DeliveryState['entitlementStatus']; operationalState?: AdminOperationalState; counsellorId?: string; userId?: string; search?: string; startDate?: string; endDate?: string; year?: number; month?: number; page?: number; pageSize?: number; sortBy?: 'createdAt' | 'updatedAt' | 'submittedAt' | 'status' | 'sessionsRemaining'; sortDirection?: 'asc' | 'desc' }
export type AdminSessionFilters = SessionListFilters & { counsellorId?: string; userId?: string; requestId?: string; search?: string }
export const adminApi = {
  getDashboard: () => apiRequest<{ success: boolean; dashboard: AdminDashboardStats }>('/admin/dashboard'),
  getCounsellors: (filters: { search?: string; available?: boolean; page?: number; pageSize?: number } = {}) => apiRequest<{ success: boolean; pagination: Pagination; counsellors: CounsellorProfile[] }>(`/admin/counsellors${toQueryString(filters)}`),
  getRequests: (filters: AdminRequestFilters = {}) => apiRequest<{ success: boolean; filters: AdminRequestFilters; pagination: Pagination; requests: CareerRequest[] }>(`/admin/requests${toQueryString({ ...filters, assigned: filters.assigned === undefined ? undefined : String(filters.assigned), locked: filters.locked === undefined ? undefined : String(filters.locked) })}`),
  getRequest: (id: string) => apiRequest<{ success: boolean; request: CareerRequest }>(`/admin/requests/${id}`),
  getSessions: (filters: AdminSessionFilters = {}) => apiRequest<{ success: boolean; filters: AdminSessionFilters; pagination: Pagination; sessions: CareerSession[] }>(`/admin/sessions${toQueryString(filters)}`),
  getEntitlementHistory: (id: string, page=1, pageSize=25) => apiRequest<{ success: boolean; pagination: Pagination; adjustments: EntitlementAdjustment[] }>(`/admin/requests/${id}/entitlement-history${toQueryString({page,pageSize})}`),
  activateEngagement: (id: string, payload: { counsellorId?: string | null; sessionsGranted?: number; reason: string }) => apiRequest<{ success: boolean; message: string; request: CareerRequest; deliveryState: DeliveryState }>(`/admin/requests/${id}/activate`, { method:'PATCH', body:JSON.stringify(payload)}),
  assignCounsellor: (id: string, counsellorId: string, options: { futureSessionAction?: 'transfer'|'cancel'; reason?: string }={}) => apiRequest<{ success:boolean; message:string; request:CareerRequest; futureSessionsAffected:number; futureSessionAction:'transfer'|'cancel'}>(`/admin/requests/${id}/assign`,{method:'PATCH',body:JSON.stringify({counsellorId,futureSessionAction:options.futureSessionAction||'transfer',reason:options.reason||''})}),
  unassignCounsellor: (id: string, reason: string) => apiRequest<{success:boolean;message:string;request:CareerRequest;cancelledFutureSessions:number}>(`/admin/requests/${id}/unassign`,{method:'PATCH',body:JSON.stringify({reason})}),
  setEntitlement: (id:string,sessionsGranted:number,reason:string) => apiRequest<{success:boolean;message:string;deliveryState:DeliveryState}>(`/admin/requests/${id}/entitlement`,{method:'PATCH',body:JSON.stringify({sessionsGranted,reason})}),
  lockEngagement: (id:string,reason:string) => apiRequest<{success:boolean;message:string;deliveryState:DeliveryState}>(`/admin/requests/${id}/lock`,{method:'PATCH',body:JSON.stringify({reason})}),
  reopenEngagement: (id:string,reason:string) => apiRequest<{success:boolean;message:string;deliveryState:DeliveryState}>(`/admin/requests/${id}/reopen`,{method:'PATCH',body:JSON.stringify({reason})}),
  closeEngagement: (id:string,reason:string) => apiRequest<{success:boolean;message:string;cancelledFutureSessions:number;deliveryState:DeliveryState}>(`/admin/requests/${id}/close`,{method:'PATCH',body:JSON.stringify({reason})}),
}


export type AdminUser = { id:string; fullName:string; email:string; role:UserRole; adminScope?: AdminScope | null; phone?:string|null; isActive:boolean; lastLoginAt?:string|null; createdAt:string; updatedAt?:string }
export type CareerProfile = { professionalSummary:string; currentJobTitle:string; industry:string; yearsOfExperience:number|null; targetRole:string; skills:string[]; careerGoals:string; linkedinUrl:string; updatedAt?:string|null }
export type ResumeDocument = { id:string; originalFileName:string; mimeType:string; sizeBytes:number; uploadedAt:string }
export type ServiceContact = { phone?:string|null; phoneCountryCode:string; phoneNumber:string; phoneE164?:string|null; serviceCommunicationConsentAt?:string|null; readyForServiceContact:boolean }
export type CounsellorAvailability = { isAvailable:boolean; timezone:string; defaultSessionDurationMinutes:number; windows:Array<{id?:string;dayOfWeek:number;startTime:string;endTime:string;enabled:boolean}>; blocks:Array<{id:string;startsAt:string;endsAt:string;reason?:string|null}> }
export const careerProfileApi = {
  get: () => apiRequest<{success:boolean;profile:CareerProfile;resume:ResumeDocument|null;contact?:ServiceContact}>('/me/career-profile'),
  save: (payload: CareerProfile) => apiRequest<{success:boolean;message:string;profile:CareerProfile}>('/me/career-profile',{method:'PUT',body:JSON.stringify(payload)}),
  uploadResume: (file: File) => { const form=new FormData(); form.append('resume',file); return apiFormRequest<{success:boolean;message:string;resume:ResumeDocument}>('/me/career-profile/resume',form,{method:'POST'}) },
  saveServiceContact: (payload:{phoneCountryCode:string;phoneNumber:string;serviceCommunicationConsent:true}) => apiRequest<{success:boolean;message:string;contact:ServiceContact}>('/me/service-contact',{method:'PUT',body:JSON.stringify(payload)}),
  downloadUrl: (resumeId:string) => `${API_BASE_URL}/resumes/${resumeId}/download`,
}
export const availabilityApi = {
  get: () => apiRequest<{success:boolean;availability:CounsellorAvailability}>('/counsellor/availability'),
  save: (payload: Pick<CounsellorAvailability,'timezone'|'defaultSessionDurationMinutes'|'windows'>) => apiRequest<{success:boolean;message:string;availability:CounsellorAvailability}>('/counsellor/availability',{method:'PUT',body:JSON.stringify(payload)}),
  addBlock: (payload:{startsAt:string;endsAt:string;reason?:string}) => apiRequest<{success:boolean;message:string;block:CounsellorAvailability['blocks'][number]}>('/counsellor/availability/blocks',{method:'POST',body:JSON.stringify(payload)}),
  deleteBlock: (id:string) => apiRequest<{success:boolean;message:string}>(`/counsellor/availability/blocks/${id}`,{method:'DELETE'}),
}
export const bookingApi = {
  getSlots:(requestId:string,from:string,to:string)=>apiRequest<{success:boolean;timezone:string;durationMinutes:number;slots:Array<{startAt:string;endAt:string;timezone:string}>}>(`/requests/${requestId}/available-slots${toQueryString({from,to})}`),
  book:(requestId:string,payload:{scheduledStartAt:string;scheduledEndAt:string})=>apiRequest<{success:boolean;message:string;session:CareerSession}>(`/requests/${requestId}/book-session`,{method:'POST',body:JSON.stringify(payload)}),
}
export const adminUserApi = {
  getUsers:(filters:{search?:string;role?:UserRole;active?:boolean;page?:number;pageSize?:number}={})=>apiRequest<{success:boolean;pagination:Pagination;users:AdminUser[]}>(`/admin/users${toQueryString({...filters,active:filters.active===undefined?undefined:String(filters.active)})}`),
  changeRole:(id:string,role:UserRole,adminScope:AdminScope|null,reason:string)=>apiRequest<{success:boolean;message:string;user:AdminUser}>(`/admin/users/${id}/role`,{method:'PATCH',body:JSON.stringify({role,adminScope,reason})}),
  deactivate:(id:string,reason:string)=>apiRequest<{success:boolean;message:string;user:AdminUser}>(`/admin/users/${id}/deactivate`,{method:'PATCH',body:JSON.stringify({reason})}),
  reactivate:(id:string,reason:string)=>apiRequest<{success:boolean;message:string;user:AdminUser}>(`/admin/users/${id}/reactivate`,{method:'PATCH',body:JSON.stringify({reason})}),
}

export type ToolkitResourceType = 'guide' | 'framework' | 'checklist' | 'worksheet' | 'template' | 'answer_library'
export type ToolkitCategory = { id:string; slug:string; name:string; description:string; displayOrder:number; isActive:boolean }
export type ToolkitContentBlock = { type:'heading'|'paragraph'|'list'|'callout'; heading?:string; body?:string; items?:string[] }
export type ToolkitResource = { id:string; category:{id:string;slug:string;name:string}; slug:string; title:string; description:string; resourceType:ToolkitResourceType; readingTimeMinutes:number; previewBody:string; whatYouWillLearn:string[]; status?:'draft'|'published'|'archived'; publishedAt?:string|null; saved?:boolean; contentBlocks?:ToolkitContentBlock[]; createdAt?:string; updatedAt?:string }
export const toolkitApi = {
  getCategories: () => apiRequest<{success:boolean;categories:ToolkitCategory[]}>('/toolkit/categories'),
  getResources: (filters:{category?:string;type?:ToolkitResourceType;search?:string}={}) => apiRequest<{success:boolean;resources:ToolkitResource[]}>(`/toolkit/resources${toQueryString(filters)}`),
  getPreview: (slug:string) => apiRequest<{success:boolean;resource:ToolkitResource;access:{fullContentRequiresLogin:boolean}}>(`/toolkit/resources/${slug}`),
  getFull: (slug:string) => apiRequest<{success:boolean;resource:ToolkitResource}>(`/toolkit/resources/${slug}/full`),
  getSaved: () => apiRequest<{success:boolean;resources:ToolkitResource[]}>('/toolkit/my/saves'),
  save: (resourceId:string) => apiRequest<{success:boolean;message:string}>(`/toolkit/resources/${resourceId}/save`,{method:'POST'}),
  unsave: (resourceId:string) => apiRequest<{success:boolean;message:string}>(`/toolkit/resources/${resourceId}/save`,{method:'DELETE'}),
}
