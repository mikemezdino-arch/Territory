export function ErrorFallback() {
  return (
    <div className="auth-shell">
      <h1>Something Went Wrong</h1>
      <p>
        This page hit an unexpected error. Reloading usually fixes it — if it
        keeps happening, let us know at{' '}
        <a href="mailto:hello@territory.bz">hello@territory.bz</a>.
      </p>
      <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}
