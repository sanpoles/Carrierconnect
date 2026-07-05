import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  toolkitApi,
  type ToolkitCategory,
  type ToolkitResource,
  type ToolkitResourceType,
} from '../services/api'
import '../styles/career-toolkit.css'

const typeLabels: Record<ToolkitResourceType, string> = {
  guide: 'Guide',
  framework: 'Framework',
  checklist: 'Checklist',
  worksheet: 'Worksheet',
  template: 'Template',
  answer_library: 'Answer library',
}

function CareerToolkitPage() {
  const { categorySlug } = useParams()
  const [categories, setCategories] = useState<ToolkitCategory[]>([])
  const [resources, setResources] = useState<ToolkitResource[]>([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ToolkitResourceType | ''>('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const selectedCategory = useMemo(
    () => categories.find((category) => category.slug === categorySlug) || null,
    [categories, categorySlug],
  )

  useEffect(() => {
    let open = true

    async function loadToolkit() {
      setLoading(true)
      setError('')

      try {
        const [categoryResponse, resourceResponse] = await Promise.all([
          toolkitApi.getCategories(),
          toolkitApi.getResources({
            category: categorySlug,
            type: type || undefined,
            search: search || undefined,
          }),
        ])

        if (open) {
          setCategories(categoryResponse.categories)
          setResources(resourceResponse.resources)
        }
      } catch (error) {
        if (open) {
          setError(
            error instanceof Error
              ? error.message
              : 'Unable to load Career Toolkit resources.',
          )
        }
      } finally {
        if (open) {
          setLoading(false)
        }
      }
    }

    void loadToolkit()

    return () => {
      open = false
    }
  }, [categorySlug, search, type])

  return (
    <main className="toolkit-page">
      <section className="toolkit-hero">
        <p className="landing-eyebrow">CAREER TOOLKIT</p>
        <h1>Practical resources for IT career preparation.</h1>
        <p>
          Browse credible guides, frameworks, checklists, worksheets, templates,
          and answer-library articles. Preview resources publicly, then create a
          free account to read full content and save useful items.
        </p>
        <div className="toolkit-hero-actions">
          <Link className="hero-primary-link" to="/register">
            Create free account <span>→</span>
          </Link>
          <Link className="hero-secondary-link" to="/login">
            Login to save resources
          </Link>
        </div>
      </section>

      <section className="toolkit-layout">
        <aside className="toolkit-sidebar">
          <h2>Categories</h2>
          <Link className={!categorySlug ? 'active' : ''} to="/career-toolkit">
            All resources
          </Link>
          {categories.map((category) => (
            <Link
              className={category.slug === categorySlug ? 'active' : ''}
              key={category.id}
              to={`/career-toolkit/${category.slug}`}
            >
              {category.name}
            </Link>
          ))}
        </aside>

        <div className="toolkit-results">
          <div className="toolkit-results-heading">
            <div>
              <p className="landing-eyebrow">
                {selectedCategory?.name || 'RESOURCE LIBRARY'}
              </p>
              <h2>
                {selectedCategory
                  ? selectedCategory.description
                  : 'Explore IT career preparation resources.'}
              </h2>
            </div>

            <div className="toolkit-filters">
              <input
                aria-label="Search Toolkit resources"
                placeholder="Search resources"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                aria-label="Filter resource type"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as ToolkitResourceType | '')
                }
              >
                <option value="">All types</option>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <div className="toolkit-alert">{error}</div>}

          {loading ? (
            <div className="toolkit-empty">Loading resources…</div>
          ) : resources.length === 0 ? (
            <div className="toolkit-empty">
              <strong>Resources are being prepared.</strong>
              <p>
                Published Career Toolkit content will appear here once approved.
              </p>
            </div>
          ) : (
            <div className="toolkit-card-grid">
              {resources.map((resource) => (
                <article className="toolkit-card" key={resource.id}>
                  <div className="toolkit-card-meta">
                    <span>{resource.category.name}</span>
                    <span>{typeLabels[resource.resourceType]}</span>
                    <span>{resource.readingTimeMinutes} min</span>
                  </div>
                  <h3>{resource.title}</h3>
                  <p>{resource.description}</p>
                  <ul>
                    {resource.whatYouWillLearn.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <Link to={`/career-toolkit/resources/${resource.slug}`}>
                    Preview resource <span>→</span>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default CareerToolkitPage
