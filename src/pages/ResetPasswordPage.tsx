import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, clearAuthSession } from '../services/api'

function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const resetToken = searchParams.get('token')?.trim() || ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setErrorMessage('')
    setSuccessMessage('')

    if (!resetToken) {
      setErrorMessage(
        'This password reset link is invalid or incomplete. Please request a new password reset link.',
      )
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Password and confirmation do not match.')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await authApi.resetPassword({
        token: resetToken,
        password,
        confirmPassword,
      })

      clearAuthSession()
      setPassword('')
      setConfirmPassword('')
      setSuccessMessage(response.message)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to reset your password. Please request a new reset link.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-route-page">
      <section className="auth-route-card">
        <p className="eyebrow">SECURE PASSWORD RESET</p>
        <h1>Create a new password</h1>
        <p className="auth-description">
          Choose a new password for your CareerConnect account. Existing
          sessions will be signed out for security.
        </p>

        {errorMessage && (
          <div className="auth-alert auth-alert-error" role="alert">
            {errorMessage}
          </div>
        )}

        {successMessage ? (
          <>
            <div className="auth-alert auth-alert-success">
              {successMessage}
            </div>

            <button
              className="submit-button auth-route-submit-button"
              type="button"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to login <span>→</span>
            </button>
          </>
        ) : (
          <form className="auth-form" onSubmit={handleResetPassword}>
            <label>
              New password
              <input
                required
                minLength={12}
                placeholder="12+ characters, upper/lowercase and number"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <label>
              Confirm new password
              <input
                required
                minLength={12}
                placeholder="Re-enter your new password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>

            <button
              className="submit-button auth-route-submit-button"
              disabled={isSubmitting || !resetToken}
              type="submit"
            >
              {isSubmitting ? 'Resetting password...' : 'Reset password'}{' '}
              <span>→</span>
            </button>
          </form>
        )}

        <p className="auth-switch-text">
          <Link to="/login">Back to login</Link>
        </p>
      </section>
    </main>
  )
}

export default ResetPasswordPage