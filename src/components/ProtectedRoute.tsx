import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import {
  authApi,
  clearAuthSession,
  getStoredUser,
  saveAuthSession,
  type UserRole,
} from '../services/api'

type ProtectedRouteProps = {
  allowedRoles: UserRole[]
}

function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const storedUser = getStoredUser()
  const [isCheckingSession, setIsCheckingSession] = useState(Boolean(storedUser))
  const [isSessionValid, setIsSessionValid] = useState(Boolean(storedUser))
  const [userRole, setUserRole] = useState<UserRole | null>(
    storedUser?.role || null,
  )

  useEffect(() => {
    let isMounted = true

    async function validateSession() {
      if (!storedUser) {
        if (isMounted) {
          setIsCheckingSession(false)
          setIsSessionValid(false)
        }
        return
      }

      try {
        const response = await authApi.me()

        saveAuthSession(
          localStorage.getItem('careerconnect_token') || '',
          response.user,
        )

        if (isMounted) {
          setUserRole(response.user.role)
          setIsSessionValid(true)
        }
      } catch {
        clearAuthSession()

        if (isMounted) {
          setUserRole(null)
          setIsSessionValid(false)
        }
      } finally {
        if (isMounted) {
          setIsCheckingSession(false)
        }
      }
    }

    validateSession()

    return () => {
      isMounted = false
    }
  }, [])

  if (isCheckingSession) {
    return (
      <div className="portal-loading-screen">
        <div className="portal-loading-card">
          <span className="portal-loading-spinner" />
          <strong>Loading your CareerConnect workspace</strong>
          <p>Verifying your secure session.</p>
        </div>
      </div>
    )
  }

  if (!isSessionValid || !userRole) {
    return <Navigate to="/login" replace />
  }

  if (!allowedRoles.includes(userRole)) {
    if (userRole === 'admin') {
      return <Navigate to="/admin/overview" replace />
    }

    if (userRole === 'counsellor') {
      return <Navigate to="/counsellor/dashboard" replace />
    }

    return <Navigate to="/app/dashboard" replace />
  }

  return <Outlet />
}

export default ProtectedRoute