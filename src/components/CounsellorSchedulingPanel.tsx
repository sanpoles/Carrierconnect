import { useState, type FormEvent } from 'react'
import {
  counsellorApi,
  type CareerRequest,
  type SchedulingSlot,
} from '../services/api'

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function slotLabel(slot: SchedulingSlot) {
  return `${formatDateTime(slot.scheduledStartAt)} - ${formatDateTime(slot.scheduledEndAt)}`
}

function toSlot(value: string, timezone: string) {
  const start = new Date(value)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    scheduledStartAt: start.toISOString(),
    scheduledEndAt: end.toISOString(),
    timezone,
  }
}

type Props = {
  request: CareerRequest
  disabled: boolean
  onUpdated: () => void
}

function CounsellorSchedulingPanel({ request, disabled, onUpdated }: Props) {
  const [message, setMessage] = useState('')
  const [slotOne, setSlotOne] = useState('')
  const [slotTwo, setSlotTwo] = useState('')
  const [slotThree, setSlotThree] = useState('')
  const [timezone, setTimezone] = useState(request.timezone || 'Asia/Kolkata')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function acceptSlot(slot: SchedulingSlot) {
    if (!slot.id) return
    setBusy(true)
    setError('')
    setSuccess('')

    try {
      await counsellorApi.acceptPreferredSlot(request.id, slot.id, {
        meetingProvider: 'To be confirmed',
      })
      setSuccess('Preferred slot accepted and session scheduled.')
      onUpdated()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to accept this slot.')
    } finally {
      setBusy(false)
    }
  }

  async function proposeAlternatives(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = [slotOne, slotTwo, slotThree].map((value) => value.trim()).filter(Boolean)

    if (values.length < 2) {
      setError('Propose at least two alternate options.')
      return
    }

    if (new Set(values).size !== values.length) {
      setError('Alternate options cannot be duplicates.')
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')

    try {
      await counsellorApi.proposeAlternateSlots(request.id, {
        message: message.trim() || undefined,
        slots: values.map((value) => toSlot(value, timezone)),
      })
      setMessage('')
      setSlotOne('')
      setSlotTwo('')
      setSlotThree('')
      setSuccess('Alternate options sent to the user.')
      onUpdated()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to send alternate options.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="counsellor-scheduling-panel">
      <header>
        <div>
          <span>SCHEDULING PREFERENCES</span>
          <h4>User requested options</h4>
        </div>
        <em>{request.schedulingStatus?.replaceAll('_', ' ') || 'requested preferences'}</em>
      </header>

      {error && <p className="counsellor-readonly">{error}</p>}
      {success && <p className="counsellor-schedule-success">{success}</p>}

      <div className="counsellor-preferred-slot-list">
        {request.preferredSlots?.length ? (
          request.preferredSlots.map((slot) => (
            <article key={slot.id || slot.scheduledStartAt}>
              <div>
                <strong>Option {slot.displayOrder || ''}</strong>
                <span>{slotLabel(slot)}</span>
                <small>{slot.timezone}</small>
              </div>
              <button
                disabled={disabled || busy || request.schedulingStatus === 'confirmed'}
                type="button"
                onClick={() => void acceptSlot(slot)}
              >
                Accept
              </button>
            </article>
          ))
        ) : (
          <p>No preferred slots were captured for this request.</p>
        )}
      </div>

      {request.schedulingStatus !== 'confirmed' && (
        <form className="counsellor-schedule-form" onSubmit={proposeAlternatives}>
          <label>
            Optional message
            <textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Explain why you are proposing alternate times..."
            />
          </label>
          <label>
            Alternate option 1
            <input required type="datetime-local" value={slotOne} onChange={(event) => setSlotOne(event.target.value)} />
          </label>
          <label>
            Alternate option 2
            <input required type="datetime-local" value={slotTwo} onChange={(event) => setSlotTwo(event.target.value)} />
          </label>
          <label>
            Alternate option 3
            <input type="datetime-local" value={slotThree} onChange={(event) => setSlotThree(event.target.value)} />
          </label>
          <label>
            Timezone
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
            </select>
          </label>
          <button disabled={disabled || busy} type="submit">
            {busy ? 'Sending...' : 'Propose alternate options'}
          </button>
        </form>
      )}
    </section>
  )
}

export default CounsellorSchedulingPanel
