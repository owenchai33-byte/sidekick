import { useState } from 'react'
import { LANGUAGE_MAP } from '../../shared/constants.js'

// The signature element: one listing shown per platform, tabbed across
// EN / 中文 / BM. Inline edit, approve-per-language, and one-tap publish
// (copy to clipboard + open the platform's compose page). Nothing publishes
// without approval.
export default function PostCard({
  platform,
  languages,
  content = {},
  approvals = {},
  published = {},
  demo,
  onEditText,
  onToggleApprove,
  onPublish,
  toast,
}) {
  const [active, setActive] = useState(languages[0] || 'en')
  const [editing, setEditing] = useState(false)
  const lang = languages.includes(active) ? active : languages[0]
  const text = content[lang] ?? ''
  const isApproved = !!approvals[lang]
  const publishedAt = published[lang]
  const neverAuto = platform.autopost === 'never'

  async function copy(showToast = true) {
    try {
      await navigator.clipboard.writeText(text)
      if (showToast) toast?.('Copied to clipboard', 'success')
      return true
    } catch {
      toast?.('Could not access clipboard', 'danger')
      return false
    }
  }

  async function publish() {
    if (!isApproved) {
      toast?.('Approve this post before publishing', 'warn')
      return
    }
    await copy(false)
    window.open(platform.compose, '_blank', 'noopener')
    onPublish?.(lang)
    toast?.(`Copied — ${platform.name} opened. Paste & post.`, 'success')
  }

  return (
    <div className="postcard card">
      <div className="pc-head">
        <div className="pc-title">
          <span className="pc-icon" aria-hidden="true">{platform.icon}</span>
          <div>
            <div className="pc-name">{platform.name}</div>
            <div className="pc-style">{platform.style}</div>
          </div>
        </div>
        <div className="pc-badges">
          {demo && <span className="badge badge-demo">Sample</span>}
          {publishedAt && <span className="badge badge-live">Published</span>}
        </div>
      </div>

      {neverAuto && (
        <div className="pc-guard" title="Account protection">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          One-tap only — never auto-posted (protects the account)
        </div>
      )}

      <div className="pc-tabs" role="tablist" aria-label={`${platform.name} languages`}>
        {languages.map((lid) => (
          <button
            key={lid}
            role="tab"
            aria-selected={lid === lang}
            className={`pc-tab ${lid === lang ? 'on' : ''}`}
            onClick={() => { setActive(lid); setEditing(false) }}
          >
            {LANGUAGE_MAP[lid]?.label}
            {approvals[lid] && <span className="pc-tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="pc-body">
        {editing ? (
          <textarea
            className="textarea pc-textarea"
            value={text}
            rows={Math.min(16, Math.max(6, text.split('\n').length + 1))}
            onChange={(e) => onEditText?.(lang, e.target.value)}
            autoFocus
          />
        ) : (
          <pre className="pc-text">{text || <span className="muted">No copy yet.</span>}</pre>
        )}
      </div>

      <div className="pc-actions">
        <button
          className={`chip pc-approve ${isApproved ? 'on' : ''}`}
          aria-pressed={isApproved}
          onClick={() => onToggleApprove?.(lang)}
        >
          {isApproved ? (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> Approved</>
          ) : 'Approve'}
        </button>

        <div className="pc-spacer" />

        <div className="pc-action-btns">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button className="btn btn-subtle btn-sm" onClick={() => copy()}>Copy</button>
          <button className="btn btn-primary btn-sm" onClick={publish} disabled={!isApproved} title={isApproved ? 'Copy & open compose page' : 'Approve first'}>
            Publish
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </button>
        </div>
      </div>

      <style>{`
        .postcard { padding: 16px; display: flex; flex-direction: column; gap: 13px; }
        .pc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .pc-title { display: flex; gap: 11px; align-items: flex-start; }
        .pc-icon { font-size: 22px; line-height: 1; margin-top: 1px; }
        .pc-name { font-size: 15px; font-weight: 700; }
        .pc-style { font-size: 12px; color: var(--ink-500); margin-top: 2px; max-width: 46ch; }
        .pc-badges { display: flex; gap: 6px; flex: none; }

        .pc-guard { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600;
          color: var(--timber-700); background: color-mix(in srgb, var(--timber-500) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--timber-500) 30%, transparent);
          padding: 8px 11px; border-radius: var(--r-sm); }
        @media (prefers-color-scheme: dark) { .pc-guard { color: var(--timber-300); } }

        .pc-tabs { display: flex; gap: 4px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); width: fit-content; }
        .pc-tab { position: relative; border: none; background: transparent; padding: 7px 16px; border-radius: var(--r-sm);
          font-size: 13px; font-weight: 700; color: var(--ink-500); cursor: pointer; transition: all 0.15s var(--ease); }
        .pc-tab:hover { color: var(--ink-900); }
        .pc-tab.on { background: var(--surface); color: var(--green-700); box-shadow: var(--shadow-sm); }
        @media (prefers-color-scheme: dark) { .pc-tab.on { color: var(--green-400); } }
        .pc-tab-dot { position: absolute; top: 5px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--green-500); }

        .pc-body { background: var(--surface-sunk); border: 1px solid var(--line); border-radius: var(--r-md); }
        .pc-text { margin: 0; padding: 14px; font-family: inherit; font-size: 14px; line-height: 1.62;
          white-space: pre-wrap; word-break: break-word; color: var(--ink-900); max-height: 420px; overflow: auto; }
        .pc-textarea { border: none; background: transparent; padding: 14px; font-size: 14px; line-height: 1.62; }
        .pc-textarea:focus { box-shadow: none; }

        .pc-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .pc-approve svg { margin-right: 2px; }
        .pc-spacer { flex: 1; min-width: 8px; }
        /* Keep Edit/Copy/Publish together so Publish never wraps alone. */
        .pc-action-btns { display: flex; align-items: center; gap: 8px; }
        @media (max-width: 460px) {
          .pc-actions { row-gap: 10px; }
          .pc-spacer { display: none; }
          .pc-approve { order: -1; }
          .pc-action-btns { flex: 1; justify-content: flex-end; }
        }
      `}</style>
    </div>
  )
}
