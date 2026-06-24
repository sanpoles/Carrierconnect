import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  counsellorApi, internalNotesApi, messageApi, sessionApi,
  type CareerRequest, type CareerSession, type CareerSessionStatus,
  type CounsellorDashboardStats, type CounsellorQueue, type DeliveryState,
  type Pagination, type RequestMessage, type SessionListFilters,
} from '../services/api'
import { onRealtimeInternalNote, onRealtimeMessage, onRealtimeNotification } from '../services/realtime'
import '../styles/counsellor-operations.css'
import '../styles/internal-notes.css'
import CounsellorAvailabilityPanel from './CounsellorAvailabilityPanel'
import CounsellorPreparationPanel from './CounsellorPreparationPanel'

type Tab = 'overview' | 'queues' | 'sessions' | 'history' | 'availability'
type SessionFilters = { search: string; status: '' | CareerSessionStatus; startDate: string; endDate: string; year: string; month: string; sortDirection: 'asc' | 'desc' }
const PAGE_SIZE = 25
// PostgreSQL accepts UUID values that do not necessarily use RFC version/variant bits.
// Validate only the UUID shape so existing database identifiers remain usable.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const emptyPagination: Pagination = { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 }
const emptyFilters: SessionFilters = { search:'',status:'',startDate:'',endDate:'',year:'',month:'',sortDirection:'asc' }

function localDate(value = new Date()) {
  const offset = value.getTimezoneOffset()
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function addDays(dateValue: string, days: number) {
  const next = new Date(`${dateValue}T12:00:00`)
  next.setDate(next.getDate() + days)
  return localDate(next)
}

function dateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(date)
}
function title(request: CareerRequest) { return request.requestType === 'career_counselling' ? 'Career Counselling' : 'Mock Interview' }
function label(value: string) { return value.replaceAll('_',' ') }
function state(request: CareerRequest): string { return request.deliveryState?.operationalState || 'active' }
function stateLabel(value: string) {
  return ({ needs_attention:'Needs attention',ready_for_counsellor:'Ready for counsellor',active:'Active',waiting_approval:'Waiting for approval',exhausted:'Completed',locked:'Read-only',closed:'Closed',cancelled:'Cancelled' } as Record<string,string>)[value] || label(value)
}
function sessionFilters(filters: SessionFilters, page:number): SessionListFilters {
  const numeric=(v:string)=>v ? Number(v) : undefined
  return { search:filters.search||undefined,status:filters.status||undefined,startDate:filters.startDate||undefined,endDate:filters.endDate||undefined,year:numeric(filters.year),month:numeric(filters.month),page,pageSize:PAGE_SIZE,sortBy:'scheduledStartAt',sortDirection:filters.sortDirection }
}
function fallback(request: CareerRequest | null): DeliveryState {
  const final = Boolean(request && ['completed','cancelled','closed'].includes(request.status))
  return { isLocked:final,sessionsGranted:0,sessionsConsumed:0,sessionsRemaining:0,entitlementStatus:'inactive',canSendMessages:!final,canScheduleSessions:false,canManageSessions:!final,readOnlyMessage: final ? 'This engagement is read-only.' : 'Loading engagement information.' }
}

function CounsellorDashboard() {
  const [tab,setTab] = useState<Tab>('overview')
  const [dashboard,setDashboard] = useState<CounsellorDashboardStats | null>(null)
  const [queue,setQueue] = useState<CounsellorQueue>('all')
  const [search,setSearch] = useState('')
  const [requests,setRequests] = useState<CareerRequest[]>([])
  const [requestPagination,setRequestPagination] = useState<Pagination>(emptyPagination)
  const [selectedId,setSelectedId] = useState<string | null>(null)
  const [messages,setMessages] = useState<RequestMessage[]>([])
  const [internalNotes,setInternalNotes] = useState<RequestMessage[]>([])
  const [internalNoteText,setInternalNoteText] = useState('')
  const [requestSessions,setRequestSessions] = useState<CareerSession[]>([])
  const [overviewReady,setOverviewReady] = useState<CareerRequest[]>([])
  const [overviewAttention,setOverviewAttention] = useState<CareerRequest[]>([])
  const [sessions,setSessions] = useState<CareerSession[]>([])
  const [history,setHistory] = useState<CareerSession[]>([])
  const [sessionsPagination,setSessionsPagination] = useState<Pagination>(emptyPagination)
  const [historyPagination,setHistoryPagination] = useState<Pagination>(emptyPagination)
  const [filters,setFilters] = useState<SessionFilters>(emptyFilters)
  const [historyFilters,setHistoryFilters] = useState<SessionFilters>({...emptyFilters,status:'completed'})
  const [messageText,setMessageText] = useState('')
  const [showSchedule,setShowSchedule] = useState(false)
  const [schedule,setSchedule] = useState({ title:'', start:'', end:'', provider:'Zoom', link:'' })
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [detailsLoading,setDetailsLoading] = useState(false)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const messagesRef=useRef<HTMLDivElement>(null)
  const internalNotesRef=useRef<HTMLDivElement>(null)

  const selected = useMemo(()=>requests.find(r=>r.id===selectedId)||null,[requests,selectedId])
  const requestIdsKey = useMemo(() => requests.map((request) => request.id).join('|'), [requests])
  const delivery = selected?.deliveryState || fallback(selected)
  const canSend = Boolean(selected && delivery.canSendMessages)
  const canSchedule = Boolean(selected && delivery.canScheduleSessions)
  const canManage = Boolean(selected && delivery.canManageSessions)

  function applyResponse(response: { requests: CareerRequest[]; pagination: Pagination }, preferred?: string | null) {
    setRequests(response.requests)
    setRequestPagination(response.pagination)
    const ids=new Set(response.requests.map(r=>r.id))
    setSelectedId(current => {
      // undefined means retain a still-visible selection. null means intentionally choose the first returned request.
      const candidate = preferred === undefined ? current : preferred
      return candidate && ids.has(candidate) ? candidate : response.requests[0]?.id || null
    })
    if (!response.requests.length) { setMessages([]); setRequestSessions([]); setShowSchedule(false) }
  }

  async function loadRequests(page=1, queueOverride=queue, searchOverride=search, preferred?: string | null) {
    const response=await counsellorApi.getRequests({queue:queueOverride,search:searchOverride.trim()||undefined,page,pageSize:PAGE_SIZE,sortBy:'updatedAt',sortDirection:'desc'})
    applyResponse(response,preferred)
  }
  async function loadDashboard() { const r=await counsellorApi.getDashboard(); setDashboard(r.dashboard) }
  async function loadOverview() {
    const [ready,attention] = await Promise.all([
      counsellorApi.getRequests({queue:'ready_for_counsellor',page:1,pageSize:5,sortBy:'updatedAt',sortDirection:'desc'}),
      counsellorApi.getRequests({queue:'needs_attention',page:1,pageSize:5,sortBy:'updatedAt',sortDirection:'desc'}),
    ])
    setOverviewReady(ready.requests); setOverviewAttention(attention.requests)
  }
  async function refreshAll() {
    setError('')
    await Promise.all([loadDashboard(),loadRequests(1),loadOverview()])
  }
  async function loadDetails(id:string) {
    if (!uuidPattern.test(id) || !requests.some(r=>r.id===id)) { setMessages([]);setInternalNotes([]);setRequestSessions([]); return }
    setDetailsLoading(true);setError('')
    try {
      const [m,n,s]=await Promise.all([messageApi.getMessages(id),internalNotesApi.get(id),sessionApi.getRequestSessions(id)])
      setMessages(m.messages);setInternalNotes(n.internalNotes);setInternalNoteText('');setRequestSessions(s.sessions)
      const next=s.deliveryState||m.deliveryState
      if (next) setRequests(current=>current.map(r=>r.id===id?{...r,deliveryState:next}:r))
    } catch(e) { setError(e instanceof Error?e.message:'Unable to load engagement details.') }
    finally { setDetailsLoading(false) }
  }

  useEffect(()=>{ void (async()=>{setLoading(true);try{await refreshAll()}catch(e){setError(e instanceof Error?e.message:'Unable to load counsellor operations.')}finally{setLoading(false)}})() },[])
  useEffect(()=>{
    if (!selectedId) { setMessages([]); setInternalNotes([]); setRequestSessions([]); return }
    if (!uuidPattern.test(selectedId) || !requests.some((request) => request.id === selectedId)) {
      setSelectedId(null); setMessages([]); setInternalNotes([]); setRequestSessions([]); return
    }
    void loadDetails(selectedId)
  },[selectedId,requestIdsKey])
  useEffect(()=>{ return onRealtimeMessage((m)=>{ if(m.requestId===selectedId) setMessages(c=>c.some(x=>x.id===m.id)?c:[...c,m]); void loadDashboard() }) },[selectedId])
  useEffect(()=>{ return onRealtimeInternalNote((note)=>{ if(note.requestId===selectedId) setInternalNotes(c=>c.some(x=>x.id===note.id)?c:[...c,note]) }) },[selectedId])
  useEffect(()=>{ return onRealtimeNotification(()=>{ void refreshAll() }) },[queue,search])
  useEffect(()=>{ const el=messagesRef.current;if(!el||!messages.length)return;window.requestAnimationFrame(()=>{el.scrollTop=el.scrollHeight}) },[messages.length,selectedId])
  useEffect(()=>{ const el=internalNotesRef.current;if(!el||!internalNotes.length)return;window.requestAnimationFrame(()=>{el.scrollTop=el.scrollHeight}) },[internalNotes.length,selectedId])

  async function openQueue(next:CounsellorQueue) {
    setTab('queues');setQueue(next);setError('');setSuccess('')
    try{await loadRequests(1,next,search,null)}catch(e){setError(e instanceof Error?e.message:'Unable to open queue.')}
  }
  async function send(event:FormEvent) {
    event.preventDefault()
    if(!selectedId||!uuidPattern.test(selectedId)||!messageText.trim()||!canSend)return
    setBusy(true);setError('')
    try{
      const r=await messageApi.sendMessage(selectedId,messageText.trim())
      setMessages(c=>c.some(x=>x.id===r.requestMessage.id)?c:[...c,r.requestMessage]);setMessageText('')
      setSuccess('Message sent. This engagement is now active.')
      await refreshAll()
    }catch(e){setError(e instanceof Error?e.message:'Unable to send message.')}finally{setBusy(false)}
  }

  async function sendInternalNote(event:FormEvent) {
    event.preventDefault()
    if(!selectedId||!uuidPattern.test(selectedId)||!internalNoteText.trim()) return
    setBusy(true);setError('')
    try{
      const response=await internalNotesApi.send(selectedId,internalNoteText.trim())
      setInternalNotes(current=>current.some(note=>note.id===response.internalNote.id)?current:[...current,response.internalNote])
      setInternalNoteText('')
      setSuccess('Internal note sent to CareerConnect administrators.')
    }catch(e){setError(e instanceof Error?e.message:'Unable to send the internal note.')}finally{setBusy(false)}
  }

  async function scheduleSession(event:FormEvent) {
    event.preventDefault()
    if(!selectedId||!uuidPattern.test(selectedId)||!canSchedule||!schedule.start||!schedule.end)return
    setBusy(true);setError('')
    try{
      await sessionApi.scheduleSession(selectedId,{title:schedule.title||undefined,scheduledStartAt:new Date(schedule.start).toISOString(),scheduledEndAt:new Date(schedule.end).toISOString(),timezone:'Asia/Kolkata',meetingProvider:schedule.provider,meetingLink:schedule.link||undefined})
      setSchedule({title:'',start:'',end:'',provider:'Zoom',link:''});setShowSchedule(false);setSuccess('Session scheduled. The engagement is active.')
      await refreshAll()
    }catch(e){setError(e instanceof Error?e.message:'Unable to schedule session.')}finally{setBusy(false)}
  }
  async function complete(sessionId:string) {
    if(!canManage||!window.confirm('Mark this session as completed?'))return
    setBusy(true);setError('')
    try { await sessionApi.completeSession(sessionId,'Completed by counsellor.');setSuccess('Session marked as completed.');await refreshAll() }
    catch(e){setError(e instanceof Error?e.message:'Unable to complete session.')}finally{setBusy(false)}
  }
  async function loadSessions(page=1, historyMode=false, filtersOverride?: SessionFilters) {
    const setter=historyMode?setHistory:setSessions
    const paginationSetter=historyMode?setHistoryPagination:setSessionsPagination
    const activeFilters=filtersOverride || (historyMode ? historyFilters : filters)
    setBusy(true)
    try {
      const r=await sessionApi.getMySessions(sessionFilters(activeFilters,page))
      setter(r.sessions)
      paginationSetter(r.pagination)
    } catch(e) {
      setError(e instanceof Error?e.message:'Unable to load sessions.')
    } finally {
      setBusy(false)
    }
  }

  async function openSessionPeriod(period: 'today' | 'next_7_days') {
    const startDate = localDate()
    const endDate = period === 'today' ? startDate : addDays(startDate, 6)
    const nextFilters: SessionFilters = {
      ...emptyFilters,
      startDate,
      endDate,
      sortDirection: 'asc',
    }
    setError('')
    setTab('sessions')
    setFilters(nextFilters)
    await loadSessions(1, false, nextFilters)
  }
  function sessionTable(rows:CareerSession[], pagination:Pagination, historyMode=false) {
    return <><div className="counsellor-session-table-wrap"><table><thead><tr><th>Request</th><th>User</th><th>When</th><th>Status</th></tr></thead><tbody>{rows.length===0?<tr><td colSpan={4}>No sessions match the filters.</td></tr>:rows.map(s=><tr key={s.id}><td><strong>{s.requestNumber}</strong><span>{s.title}</span></td><td>{s.user?.fullName||'—'}</td><td>{dateTime(s.scheduledStartAt)}</td><td>{label(s.status)}</td></tr>)}</tbody></table></div><div className="counsellor-pagination"><span>Page {pagination.page} of {pagination.totalPages}</span><div><button disabled={pagination.page<=1||busy} onClick={()=>void loadSessions(pagination.page-1,historyMode)}>Previous</button><button disabled={pagination.page>=pagination.totalPages||busy} onClick={()=>void loadSessions(pagination.page+1,historyMode)}>Next</button></div></div></>
  }
  function filterForm(value:SessionFilters, setValue:(f:SessionFilters)=>void, historyMode=false) {
    return <form className="counsellor-filters" onSubmit={(e)=>{e.preventDefault();void loadSessions(1,historyMode)}}><label>Search<input value={value.search} onChange={e=>setValue({...value,search:e.target.value})} placeholder="Request, user, session"/></label><label>Status<select value={value.status} onChange={e=>setValue({...value,status:e.target.value as ''|CareerSessionStatus})}><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="reschedule_requested">Reschedule requested</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No-show</option></select></label><label>From<input type="date" value={value.startDate} onChange={e=>setValue({...value,startDate:e.target.value})}/></label><label>To<input type="date" value={value.endDate} onChange={e=>setValue({...value,endDate:e.target.value})}/></label><label>Year<input maxLength={4} value={value.year} onChange={e=>setValue({...value,year:e.target.value})}/></label><label>Month<select value={value.month} onChange={e=>setValue({...value,month:e.target.value})}><option value="">Any month</option>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{new Intl.DateTimeFormat('en-IN',{month:'long'}).format(new Date(2026,i,1))}</option>)}</select></label><button type="submit">Apply</button><button type="button" onClick={()=>{const next: SessionFilters={...emptyFilters,status:historyMode?'completed':''};setValue(next);void loadSessions(1,historyMode,next)}}>Clear</button></form>
  }

  return <section className="counsellor-ops"><div className="counsellor-ops-container">
    <header className="counsellor-ops-heading"><div><p>COUNSELLOR OPERATIONS</p><h2>Focus on the work that needs your attention.</h2><span>Use work queues for immediate actions, then use session tables for planning and history.</span></div><button onClick={()=>void refreshAll()}>Refresh dashboard</button></header>
    {error&&<div className="counsellor-alert error">{error}</div>}{success&&<div className="counsellor-alert success">{success}</div>}
    {loading?<div className="counsellor-loading">Loading counsellor operations…</div>:<>
      <div className="counsellor-metrics">
        <article><span>Needs attention</span><strong>{dashboard?.needsAttention||0}</strong><button onClick={()=>void openQueue('needs_attention')}>Open queue →</button></article>
        <article><span>Ready for counsellor</span><strong>{dashboard?.readyForCounsellor||0}</strong><button onClick={()=>void openQueue('ready_for_counsellor')}>Open queue →</button></article>
        <article><span>Active engagements</span><strong>{dashboard?.activeEngagements||0}</strong><button onClick={()=>void openQueue('active')}>Open queue →</button></article>
        <article><span>Waiting for approval</span><strong>{dashboard?.waitingForApproval||0}</strong><button onClick={()=>void openQueue('waiting_approval')}>Open queue →</button></article>
        <article><span>Sessions today</span><strong>{dashboard?.sessionsToday||0}</strong><button onClick={()=>void openSessionPeriod('today')}>View sessions →</button></article>
        <article><span>Upcoming this week</span><strong>{dashboard?.upcomingThisWeek||0}</strong><button onClick={()=>void openSessionPeriod('next_7_days')}>Plan week →</button></article>
      </div>
      <nav className="counsellor-tabs"><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Overview</button><button className={tab==='queues'?'active':''} onClick={()=>setTab('queues')}>Work queues</button><button className={tab==='sessions'?'active':''} onClick={()=>{setTab('sessions');void loadSessions(1)}}>My sessions</button><button className={tab==='history'?'active':''} onClick={()=>{setTab('history');void loadSessions(1,true)}}>Completed history</button><button className={tab==='availability'?'active':''} onClick={()=>setTab('availability')}>Availability</button></nav>
      {tab==='overview'&&<div className="counsellor-overview"><section><header><span>NEEDS ATTENTION</span><h3>Review first</h3></header>{overviewAttention.length?overviewAttention.map(r=><div className="counsellor-overview-row" key={r.id}><div><strong>{r.requestNumber}</strong><span>{r.user?.fullName} · {r.unreadMessageCount||0} unread</span></div><button onClick={()=>{setTab('queues');setQueue('needs_attention');void loadRequests(1,'needs_attention','',r.id)}}>Open</button></div>):<p>Nothing needs immediate attention.</p>}</section><section><header><span>READY FOR COUNSELLOR</span><h3>Start these engagements</h3></header>{overviewReady.length?overviewReady.map(r=><div className="counsellor-overview-row" key={r.id}><div><strong>{r.requestNumber}</strong><span>{r.user?.fullName} · {r.deliveryState?.sessionsRemaining||0} approved sessions remaining</span></div><button onClick={()=>{setTab('queues');setQueue('ready_for_counsellor');void loadRequests(1,'ready_for_counsellor','',r.id)}}>Open</button></div>):<p>No engagements are waiting to start.</p>}</section></div>}
      {tab==='queues'&&<section className="counsellor-queue-workspace"><div className="counsellor-queue-toolbar"><label>Work queue<select value={queue} onChange={e=>{const next=e.target.value as CounsellorQueue;setQueue(next);void loadRequests(1,next,search)}}><option value="all">All assigned engagements</option><option value="needs_attention">Needs attention</option><option value="ready_for_counsellor">Ready for counsellor</option><option value="active">Active engagements</option><option value="waiting_approval">Waiting for approval</option><option value="completed">Completed and read-only</option></select></label><label>Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Request, user, email"/></label><button onClick={()=>void loadRequests(1)}>Apply</button></div><div className="counsellor-work-layout"><aside><div className="queue-title"><strong>{stateLabel(queue)}</strong><span>{requestPagination.totalItems}</span></div>{requests.length?requests.map(r=><button className={selectedId===r.id?'selected':''} key={r.id} onClick={()=>setSelectedId(r.id)}><strong>{title(r)}</strong><small>{r.requestNumber}</small><em className={`counsellor-state ${state(r)}`}>{stateLabel(state(r))}</em>{r.deliveryState?.hasAttention&&<i>Needs attention</i>}</button>):<p>No engagements match this queue.</p>}</aside><main>{!selected?<div className="counsellor-empty">Choose an engagement from the queue.</div>:<><header className="counsellor-selected-header"><div><span>{selected.requestNumber}</span><h3>{title(selected)}</h3><em className={`counsellor-state ${state(selected)}`}>{stateLabel(state(selected))}</em></div><div><strong>{selected.user?.fullName}</strong><span>{selected.user?.email}</span></div></header><section className="counsellor-entitlement"><strong>Session entitlement</strong><div><span>Approved<b>{delivery.sessionsGranted}</b></span><span>Completed<b>{delivery.sessionsConsumed}</b></span><span>Remaining<b>{delivery.sessionsRemaining}</b></span></div>{delivery.readOnlyMessage&&<p>{delivery.readOnlyMessage}</p>}</section><section className="counsellor-goal"><h4>User goal</h4><p>{selected.description}</p></section><CounsellorPreparationPanel requestId={selected.id} />{detailsLoading?<div className="counsellor-loading">Loading engagement details…</div>:<><section className="internal-notes-panel counsellor-internal-notes"><header><div><span>PRIVATE TEAM COMMUNICATION</span><h4>Internal team notes</h4></div><span>Visible to assigned counsellor and CareerConnect admins only</span></header><p className="internal-notes-explainer">Use this space for operational guidance, escalation context, or follow-up decisions. The user cannot see these notes.</p><div className="internal-notes-list" ref={internalNotesRef}>{internalNotes.length?internalNotes.map(note=><article className={note.senderType==='counsellor'?'internal-note-from-counsellor':'internal-note-from-admin'} key={note.id}><strong>{note.sender?.fullName||label(note.senderType)}</strong><p>{note.messageBody}</p><small>{dateTime(note.createdAt)}</small></article>):<div className="message-empty-state">No internal team notes yet.</div>}</div><form className="internal-note-composer" onSubmit={sendInternalNote}><textarea value={internalNoteText} onChange={e=>setInternalNoteText(e.target.value)} rows={3} maxLength={5000} placeholder="Write a private note to CareerConnect administrators..."
onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy&&internalNoteText.trim())e.currentTarget.form?.requestSubmit()}}}/><button disabled={busy||!internalNoteText.trim()} type="submit">{busy?'Sending…':'Send internal note'}</button></form></section><div className="counsellor-detail-grid"><section className="counsellor-conversation"><header><div><span>CONVERSATION</span><h4>Messages</h4></div></header><div className="counsellor-message-list" ref={messagesRef}>{messages.length?messages.map(m=><article className={m.senderType==='counsellor'?'mine':''} key={m.id}><strong>{m.sender?.fullName||label(m.senderType)}</strong><p>{m.messageBody}</p><small>{dateTime(m.createdAt)}</small></article>):<p>No messages yet. Send an introduction to begin.</p>}</div><form onSubmit={send}><textarea disabled={!canSend} value={messageText} onChange={e=>setMessageText(e.target.value)} placeholder={canSend?'Write a helpful first message…':delivery.readOnlyMessage||'Messaging unavailable.'}
onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(canSend&&!busy&&messageText.trim())e.currentTarget.form?.requestSubmit()}}}/><button disabled={!canSend||busy||!messageText.trim()}>{busy?'Sending…':'Send message →'}</button></form></section><section className="counsellor-sessions"><header><div><span>SESSION MANAGEMENT</span><h4>Sessions</h4></div><button disabled={!canSchedule} onClick={()=>setShowSchedule(v=>!v)}>{showSchedule?'Close':'Schedule'}</button></header>{!canSchedule&&<p className="counsellor-readonly">{delivery.readOnlyMessage}</p>}{showSchedule&&canSchedule&&<form className="counsellor-schedule-form" onSubmit={scheduleSession}><input placeholder="Session title" value={schedule.title} onChange={e=>setSchedule({...schedule,title:e.target.value})}/><label>Start<input required type="datetime-local" value={schedule.start} onChange={e=>setSchedule({...schedule,start:e.target.value})}/></label><label>End<input required type="datetime-local" value={schedule.end} onChange={e=>setSchedule({...schedule,end:e.target.value})}/></label><select value={schedule.provider} onChange={e=>setSchedule({...schedule,provider:e.target.value})}><option>Zoom</option><option>Google Meet</option><option>Microsoft Teams</option></select><input type="url" placeholder="Meeting link (optional)" value={schedule.link} onChange={e=>setSchedule({...schedule,link:e.target.value})}/><button disabled={busy}>{busy?'Saving…':'Confirm schedule'}</button></form>}<div className="counsellor-session-cards">{requestSessions.length?requestSessions.map(s=><article key={s.id}><strong>{s.title}</strong><em>{label(s.status)}</em><span>{dateTime(s.scheduledStartAt)}</span>{s.status==='scheduled'&&canManage&&<button onClick={()=>void complete(s.id)}>Mark completed</button>}{s.status==='completed'&&<small>Completed sessions are read-only.</small>}</article>):<p>No session has been scheduled yet.</p>}</div></section></div></>}</>}</main></div></section>}
      {tab==='sessions'&&<section className="counsellor-session-page"><h3>My sessions</h3>{filterForm(filters,setFilters)}{sessionTable(sessions,sessionsPagination)}</section>}
      {tab==='history'&&<section className="counsellor-session-page"><h3>Completed history</h3>{filterForm(historyFilters,setHistoryFilters,true)}{sessionTable(history,historyPagination,true)}</section>}{tab==='availability'&&<CounsellorAvailabilityPanel />}
    </>}</div></section>
}
export default CounsellorDashboard
