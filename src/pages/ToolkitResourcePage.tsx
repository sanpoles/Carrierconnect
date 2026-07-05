import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getStoredUser,
  toolkitApi,
  type ToolkitContentBlock,
  type ToolkitResource,
} from '../services/api'
import '../styles/career-toolkit.css'

function renderBlock(block: ToolkitContentBlock, index: number) {
  if (block.type === 'heading') {
    return <h2 key={index}>{block.heading || block.body}</h2>
  }

  if (block.type === 'list') {
    return (
      <ul key={index}>
        {(block.items || []).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  }

  if (block.type === 'callout') {
    return (
      <aside className="toolkit-resource-callout" key={index}>
        {block.heading && <strong>{block.heading}</strong>}
        {block.body && <p>{block.body}</p>}
      </aside>
    )
  }

  return <p key={index}>{block.body}</p>
}

function ToolkitResourcePage() {
  const { resourceSlug = '' } = useParams()
  const currentUser = getStoredUser()
  const isSignedIn = Boolean(currentUser)
  const [resource, setResource] = useState<ToolkitResource | null>(null)
  const [fullAccess, setFullAccess] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let open = true

    async function loadResource() {
      setLoading(true)
      setError('')

      try {
        const response = isSignedIn
          ? await toolkitApi.getFull(resourceSlug)
          : await toolkitApi.getPreview(resourceSlug)

        if (open) {
          setResource(response.resource)
          setFullAccess(Boolean(isSignedIn && response.resource.contentBlocks))
        }
      } catch (error) {
        if (open) {
          setError(
            error instanceof Error
              ? error.message
              : 'Unable to load this Toolkit resource.',
          )
        }
      } finally {
        if (open) {
          setLoading(false)
        }
      }
    }

    void loadResource()

    return () => {
      open = false
    }
  }, [isSignedIn, resourceSlug])

  async function toggleSave() {
    if (!resource) return

    setSaving(true)
    setError('')

    try {
      if (resource.saved) {
        await toolkitApi.unsave(resource.id)
        setResource({ ...resource, saved: false })
      } else {
        await toolkitApi.save(resource.id)
        setResource({ ...resource, saved: true })
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to update your saved resources.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <main className="toolkit-resource-page"><div className="toolkit-empty">Loading resource…</div></main>
  }

  if (error && !resource) {
    return <main className="toolkit-resource-page"><div className="toolkit-alert">{error}</div></main>
  }

  if (!resource) {
    return null
  }

  return (
    <main className="toolkit-resource-page">
      <Link className="toolkit-back-link" to="/career-toolkit">
        ← Back to Career Toolkit
      </Link>

      <article className="toolkit-resource-shell">
        <header>
          <p className="landing-eyebrow">{resource.category.name}</p>
          <h1>{resource.title}</h1>
          <p>{resource.description}</p>
          <div className="toolkit-card-meta">
            <span>{resource.resourceType.replaceAll('_', ' ')}</span>
            <span>{resource.readingTimeMinutes} min read</span>
          </div>
        </header>

        <section>
          <h2>What you will learn</h2>
          <ul>
            {resource.whatYouWillLearn.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        {!fullAccess ? (
          <>
            <section>
              <h2>Preview</h2>
              <p>{resource.previewBody}</p>
            </section>

            <section className="toolkit-gate">
              <h2>Create a free account to read the full guide.</h2>
              <p>
                Full Toolkit resources are available to signed-in CareerConnect
                users so you can save and revisit them in My Toolkit.
              </p>
              <div>
                <Link className="hero-primary-link" to="/register">
                  Create free account <span>→</span>
                </Link>
                <Link className="hero-secondary-link" to="/login">
                  Login
                </Link>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="toolkit-resource-content">
              {(resource.contentBlocks || []).map(renderBlock)}
            </section>

            {currentUser?.role === 'user' && (
              <button
                className="toolkit-save-button"
                disabled={saving}
                type="button"
                onClick={toggleSave}
              >
                {saving
                  ? 'Updating...'
                  : resource.saved
                    ? 'Remove from My Toolkit'
                    : 'Save to My Toolkit'}
              </button>
            )}
          </>
        )}

        {error && <div className="toolkit-alert">{error}</div>}
      </article>
    </main>
  )
}

export default ToolkitResourcePage
