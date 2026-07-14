import { useState } from 'react'
import { LANGUAGE_MAP } from '../../shared/constants.js'
import PostPreview from './PostPreview.jsx'
import PublishSheet from './PublishSheet.jsx'
import { useVideoUrls } from './MediaUploader.jsx'
import { copyText } from '../lib/clipboard.js'

// One listing shown per platform, tabbed across EN / 中文 / BM. Two views:
// a visual Preview (how the post really looks) and Text (edit inline). Approve
// per language, then one-tap publish = copy the caption + download the photos +
// open the platform's compose page. Nothing publishes without approval.
export default function PostCard({
  platform,
  listing,
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
  const [view, setView] = useState('preview') // 'preview' | 'text'
  const [sheetOpen, setSheetOpen] = useState(false)
  const lang = languages.includes(active) ? active : languages[0]
  const text = content[lang] ?? ''
  const isApproved = !!approvals[lang]
  const publishedAt = published[lang]
  const neverAuto = platform.autopost === 'never'
  const photos = listing?.photos || []
  const videos = listing?.videos || []
  const videoUrls = useVideoUrls(videos)
  const coverVideoUrl = videos[0] ? videoUrls[videos[0].id] : null

  async function copyCaption() {
    const ok = await copyText(text)
    toast?.(ok ? 'Caption copied' : 'Copy blocked — select & copy manually', ok ? 'success' : 'warn')
  }

  function openPublish() {
    if (!isApproved) {
      toast?.('Approve this post before publishing', 'warn')
      return
    }
    setSheetOpen(true)
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

      <div className="pc-controls">
        <div className="pc-tabs" role="tablist" aria-label={`${platform.name} languages`}>
          {languages.map((lid) => (
            <button
              key={lid}
              role="tab"
              aria-selected={lid === lang}
              className={`pc-tab ${lid === lang ? 'on' : ''}`}
              onClick={() => setActive(lid)}
            >
              {LANGUAGE_MAP[lid]?.label}
              {approvals[lid] && <span className="pc-tab-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="pc-view" role="tablist" aria-label="View">
          <button className={`pc-view-btn ${view === 'preview' ? 'on' : ''}`} aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
          <button className={`pc-view-btn ${view === 'text' ? 'on' : ''}`} aria-selected={view === 'text'} onClick={() => setView('text')}>Text</button>
        </div>
      </div>

      <div className={`pc-body ${view === 'preview' ? 'pc-body-preview' : ''}`}>
        {view === 'preview' ? (
          <PostPreview platform={platform} listing={listing || {}} text={text} videoUrl={coverVideoUrl} />
        ) : (
          <textarea
            className="textarea pc-textarea"
            value={text}
            rows={Math.min(16, Math.max(6, text.split('\n').length + 1))}
            onChange={(e) => onEditText?.(lang, e.target.value)}
            placeholder="Copy will appear here…"
          />
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
          <button className="btn btn-subtle btn-sm" onClick={copyCaption}>Copy</button>
          <button className="btn btn-primary btn-sm" onClick={openPublish} disabled={!isApproved} title={isApproved ? 'Open the step-by-step publish helper' : 'Approve first'}>
            Publish
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </button>
        </div>
      </div>

      {sheetOpen && (
        <PublishSheet
          platform={platform}
          listing={listing || {}}
          lang={lang}
          text={text}
          photos={photos}
          videos={videos}
          videoUrls={videoUrls}
          toast={toast}
          onPublished={() => onPublish?.(lang)}
          onClose={() => setSheetOpen(false)}
        />
      )}

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

        .pc-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .pc-tabs { display: flex; gap: 4px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); width: fit-content; }
        .pc-tab { position: relative; border: none; background: transparent; padding: 7px 16px; border-radius: var(--r-sm);
          font-size: 13px; font-weight: 700; color: var(--ink-500); cursor: pointer; transition: all 0.15s var(--ease); }
        .pc-tab:hover { color: var(--ink-900); }
        .pc-tab.on { background: var(--surface); color: var(--green-700); box-shadow: var(--shadow-sm); }
        @media (prefers-color-scheme: dark) { .pc-tab.on { color: var(--green-400); } }
        .pc-tab-dot { position: absolute; top: 5px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--green-500); }

        .pc-view { display: flex; gap: 3px; background: var(--surface-sunk); padding: 4px; border-radius: var(--r-md); }
        .pc-view-btn { border: none; background: transparent; padding: 7px 14px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 700; color: var(--ink-500); cursor: pointer; transition: all 0.15s var(--ease); }
        .pc-view-btn.on { background: var(--green-700); color: #fff; }
        @media (prefers-color-scheme: dark) { .pc-view-btn.on { background: var(--green-500); color: #0f2e21; } }

        .pc-body { background: var(--surface-sunk); border: 1px solid var(--line); border-radius: var(--r-md); }
        .pc-body-preview { padding: 18px 12px; background: var(--surface-sunk); }
        .pc-textarea { border: none; background: transparent; padding: 14px; font-size: 14px; line-height: 1.62; }
        .pc-textarea:focus { box-shadow: none; }

        .pc-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .pc-approve svg { margin-right: 2px; }
        .pc-spacer { flex: 1; min-width: 8px; }
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
