import { useEffect, useState } from 'react'
import {
  adminUserApi,
  type AdminScope,
  type AdminUser,
  type UserRole,
} from '../services/api'
import '../styles/admin-users.css'

type AccessChoice =
  | 'user'
  | 'counsellor'
  | 'operations_admin'
  | 'platform_owner'

function accessChoiceForUser(user: AdminUser): AccessChoice {
  if (user.role === 'admin') {
    return user.adminScope === 'platform_owner'
      ? 'platform_owner'
      : 'operations_admin'
  }

  return user.role
}

function choiceLabel(choice: AccessChoice) {
  return {
    user: 'User',
    counsellor: 'Counsellor',
    operations_admin: 'Operations Admin',
    platform_owner: 'Platform Owner',
  }[choice]
}

function payloadForChoice(choice: AccessChoice): {
  role: UserRole
  adminScope: AdminScope | null
} {
  if (choice === 'operations_admin') {
    return { role: 'admin', adminScope: 'operational' }
  }

  if (choice === 'platform_owner') {
    return { role: 'admin', adminScope: 'platform_owner' }
  }

  return { role: choice, adminScope: null }
}

function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<' ' | UserRole>(' ')
  const [active, setActive] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    setBusy(true)
    setError('')

    try {
      const response = await adminUserApi.getUsers({
        search: search || undefined,
        role: role === ' ' ? undefined : role,
        active: active === '' ? undefined : active === 'true',
        page: 1,
        pageSize: 100,
      })
      setUsers(response.users)
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Unable to load users.',
      )
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function changeAccess(user: AdminUser, nextChoice: AccessChoice) {
    if (reason.trim().length < 5) {
      setError(
        'Enter a reason of at least 5 characters before making this access change.',
      )
      return
    }

    if (
      !window.confirm(
        `Confirm ${choiceLabel(nextChoice)} access for ${user.fullName}?`,
      )
    ) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const next = payloadForChoice(nextChoice)
      const response = await adminUserApi.changeRole(
        user.id,
        next.role,
        next.adminScope,
        reason.trim(),
      )

      setSuccess(response.message)
      setReason('')
      await load()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to change user access.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeAccountState(
    user: AdminUser,
    action: 'deactivate' | 'reactivate',
  ) {
    if (reason.trim().length < 5) {
      setError(
        'Enter a reason of at least 5 characters before changing account status.',
      )
      return
    }

    const actionLabel = action === 'deactivate' ? 'deactivate' : 'reactivate'

    if (!window.confirm(`Confirm ${actionLabel} for ${user.fullName}?`)) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const response =
        action === 'deactivate'
          ? await adminUserApi.deactivate(user.id, reason.trim())
          : await adminUserApi.reactivate(user.id, reason.trim())

      setSuccess(response.message)
      setReason('')
      await load()
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to update account status.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-users-panel">
      <div className="admin-data-panel-heading">
        <div>
          <p>IDENTITY & ACCESS</p>
          <h3>Manage access without exposing platform ownership controls</h3>
        </div>
        <span>{users.length} loaded</span>
      </div>

      <p className="admin-users-governance-note">
        Operations Admins can manage delivery operations but cannot open this
        page, change user access, or deactivate accounts. Platform Owners have
        access governance authority.
      </p>

      {error && <div className="admin-user-alert error">{error}</div>}
      {success && <div className="admin-user-alert success">{success}</div>}

      <div className="admin-users-filters">
        <label>
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or email"
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as ' ' | UserRole)}
          >
            <option value=" ">All roles</option>
            <option value="user">User</option>
            <option value="counsellor">Counsellor</option>
            <option value="admin">Administrators</option>
          </select>
        </label>
        <label>
          Account state
          <select value={active} onChange={(event) => setActive(event.target.value)}>
            <option value="">All accounts</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={busy}>
          {busy ? 'Loading…' : 'Apply'}
        </button>
      </div>

      <label className="admin-users-reason">
        Reason for access or account-status change
        <textarea
          value={reason}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Required. Example: Operations administrator access approved for service delivery."
        />
      </label>

      <div className="admin-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Access</th>
              <th>Account</th>
              <th>Last login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="admin-empty-cell">
                  No users match the selected filters.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const currentChoice = accessChoiceForUser(user)

                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.fullName}</strong>
                      <span>{user.email}</span>
                    </td>
                    <td>
                      <span className="admin-user-role">
                        {choiceLabel(currentChoice)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          user.isActive
                            ? 'admin-user-active'
                            : 'admin-user-inactive'
                        }
                      >
                        {user.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td>
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : 'Never'}
                    </td>
                    <td>
                      <div className="admin-user-actions">
                        <select
                          value={currentChoice}
                          disabled={busy}
                          onChange={(event) => {
                            const nextChoice = event.target.value as AccessChoice
                            if (nextChoice !== currentChoice) {
                              void changeAccess(user, nextChoice)
                            }
                          }}
                        >
                          <option value="user">User</option>
                          <option value="counsellor">Counsellor</option>
                          <option value="operations_admin">
                            Operations Admin
                          </option>
                          <option value="platform_owner">Platform Owner</option>
                        </select>

                        {user.isActive ? (
                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              void changeAccountState(user, 'deactivate')
                            }
                            disabled={busy}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void changeAccountState(user, 'reactivate')
                            }
                            disabled={busy}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="admin-users-note">
        Every access and account-state change is audited. The affected user’s
        current session is invalidated and they must sign in again.
      </p>
    </section>
  )
}

export default AdminUsersPanel
