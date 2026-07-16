import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LANGUAGE_MAP } from '../../shared/constants.js'
import { getVideoBlob } from '../lib/media.js'
import { copyText } from '../lib/clipboard.js'
import { useApp } from '../context/AppContext.jsx'
import { waEnquiryLink } from '../lib/whatsapp.js'
import { canShare, sharePost } from '../lib/share.js'

// The one-tap publish helper. Same three-step layout for EVERY platform so the
// agent learns it once: copy the exact caption, save the photos/video, open the
// platform and paste. Deliberately manual (no automation) to protect accounts.
export default function PublishSheet({ platform, listing, lang, text, photos = [], videos = [], videoUrls = {}, onClose, onPublished, toast }) {
  const { settings } = useApp()
  const [copied, setCopied] = useState(false)
  const [waCopied, setWaCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const base = (listing?.title || listing?.location || 'listing').replace(/[^\w]+/g, '-').toLowerCase()
  const mediaCount = photos.length + videos.length
  const neverAuto = platform.autopost === 'never'
  const waLink = waEnquiryLink(settings?.brand?.phone, listing, platform.name)
  const nativeShare = canShare()

  async function handleShare() {
    setSharing(true)
    try {
      const res = await sharePost({ title: `${listing?.title || 'Listing'} — ${platform.name}`, text, photos, base })
      if (res.ok) {
        onPublished?.()
        toast?.(res.withFiles
          ? `Shared with ${photos.length} photo${photos.length > 1 ? 's' : ''} — post it in the app`
          : 'Caption shared — attach your photos & post', 'success')
      } else if (res.reason === 'cancelled') {
        /* user backed out — do nothing */
      } else {
        toast?.('Sharing not available here — use the steps below', 'warn')
      }
    } finally {
      setSharing(false)
    }
  }

  async function copyWa() {
    const ok = await copyText(waLink)
    if (ok) {
      setWaCopied(true)
      setTimeout(() => setWaCopied(false), 2000)
      toast?.('WhatsApp link copied', 'success')
    } else {
      toast?.('Copy blocked — long-press the link to copy', 'warn')
    }
  }

  async function copyCaption() {
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast?.('Caption copied — paste it into the post', 'success')
    } else {
      toast?.('Copy blocked — select the text and copy manually', 'warn')
    }
  }

  function triggerDownload(url, name, revoke) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 15000)
  }

  async function downloadAll() {
    const items = photos.map((src, i) => ({ url: src, name: `${base}-photo-${i + 1}.jpg`, revoke: false }))
    for (const v of videos) {
      const blob = await getVideoBlob(v.id)
      if (blob) items.push({ url: URL.createObjectURL(blob), name: v.name || `${base}-video.mp4`, revoke: true })
    }
    items.forEach((it, idx) => setTimeout(() => triggerDownload(it.url, it.name, it.revoke), idx * 250))
    if (items.length) toast?.(`Downloading ${items.length} file${items.length > 1 ? 's' : ''}…`, 'success')
  }

  function openPlatform() {
    window.open(platform.compose, '_blank', 'noopener')
    onPublished?.()
    toast?.(`${platform.name} opened — paste & post`, 'success')
  }

  return (
    <div className="ps-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Publish to ${platform.name}`}>
      <div className="ps-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ps-head">
          <span className="ps-icon" aria-hidden="true">{platform.icon}</span>
          <div className="ps-title">
            <div className="ps-name">Publish to {platform.name}</div>
            <div className="ps-lang">{LANGUAGE_MAP[lang]?.native} version</div>
          </div>
          <button className="ps-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {neverAuto && (
          <div className="ps-guard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            Posted by hand to keep the account safe — 3 quick steps.
          </div>
        )}

        {nativeShare && (
          <div className="ps-share-block">
            <button className="btn btn-primary btn-block ps-share-btn" onClick={handleShare} disabled={sharing}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8h16v-8M12 3v13M8 7l4-4 4 4" /></svg>
              {sharing ? 'Opening…' : (photos.length ? `Share caption + ${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'Share caption')}
            </button>
            <p className="ps-share-hint">Opens your phone's share menu → pick <strong>{platform.name}</strong>, and the caption{photos.length ? ' + photos are' : ' is'} already attached. Just hit post.</p>
          </div>
        )}

        {waLink ? (
          <div className="ps-wa">
            <div className="ps-wa-title">📲 Your trackable WhatsApp link</div>
            <p className="ps-wa-sub">Put this in your post (or bio). When a buyer taps it, their message tells you it came from <strong>{platform.name}</strong> — so you always know which post is working.</p>
            <button className={`btn btn-block ${waCopied ? 'btn-accent' : 'btn-subtle'}`} onClick={copyWa}>
              {waCopied ? '✓ Link copied' : 'Copy WhatsApp link'}
            </button>
          </div>
        ) : (
          <div className="ps-wa ps-wa-empty">
            📲 Add your WhatsApp number in <Link to="/settings" onClick={onClose}>Settings → Brand kit</Link> to get a trackable enquiry link for every post.
          </div>
        )}

        {nativeShare && <div className="ps-or">or post it step-by-step</div>}

        <ol className="ps-steps">
          <li className="ps-step">
            <div className="ps-step-head"><span className="ps-num">1</span> Copy the caption</div>
            <pre className="ps-caption">{text}</pre>
            <button className={`btn btn-block ${copied ? 'btn-accent' : 'btn-primary'}`} onClick={copyCaption}>
              {copied ? '✓ Copied' : 'Copy caption'}
            </button>
          </li>

          <li className="ps-step">
            <div className="ps-step-head"><span className="ps-num">2</span> Save the {videos.length ? 'photos / video' : 'photos'}</div>
            {mediaCount === 0 ? (
              <p className="ps-nomedia muted">No media attached. Add photos or a video to this listing to include them.</p>
            ) : (
              <>
                <div className="ps-media">
                  {photos.map((src, i) => <img key={'p' + i} src={src} alt="" />)}
                  {videos.map((v) => (
                    videoUrls[v.id]
                      ? <video key={v.id} src={videoUrls[v.id]} muted playsInline preload="metadata" />
                      : <div key={v.id} className="ps-media-ph">🎬</div>
                  ))}
                </div>
                <button className="btn btn-subtle btn-block" onClick={downloadAll}>
                  Download {mediaCount} file{mediaCount > 1 ? 's' : ''}
                </button>
              </>
            )}
          </li>

          <li className="ps-step">
            <div className="ps-step-head"><span className="ps-num">3</span> Open {platform.name} & paste</div>
            <button className="btn btn-primary btn-block" onClick={openPlatform}>
              Open {platform.name}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </button>
            <p className="ps-hint muted">Paste the caption{mediaCount ? ', attach your files' : ''}, and post.</p>
          </li>
        </ol>
      </div>

      <style>{`
        .ps-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(20,18,12,0.5);
          display: flex; align-items: center; justify-content: center; padding: 16px;
          animation: ps-fade 0.15s var(--ease); }
        @keyframes ps-fade { from { opacity: 0; } to { opacity: 1; } }
        .ps-sheet { width: 100%; max-width: 460px; max-height: 90vh; overflow: auto;
          background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl);
          box-shadow: var(--shadow-lg); padding: 18px; animation: ps-up 0.2s var(--ease); }
        @keyframes ps-up { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
        .ps-head { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
        .ps-icon { font-size: 24px; }
        .ps-title { flex: 1; }
        .ps-name { font-size: 16px; font-weight: 800; }
        .ps-lang { font-size: 12px; color: var(--ink-500); }
        .ps-close { border: none; background: var(--surface-sunk); color: var(--ink-700); width: 32px; height: 32px;
          border-radius: 50%; display: grid; place-items: center; cursor: pointer; }
        .ps-close:hover { background: var(--line); }

        .ps-guard { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600;
          color: var(--timber-700); background: color-mix(in srgb, var(--timber-500) 14%, transparent);
          border-radius: var(--r-sm); padding: 8px 11px; margin-bottom: 14px; }
        @media (prefers-color-scheme: dark) { .ps-guard { color: var(--timber-300); } }

        .ps-wa { background: var(--green-100); border-radius: var(--r-md); padding: 13px 14px; margin-bottom: 16px; }
        @media (prefers-color-scheme: dark) { .ps-wa { background: color-mix(in srgb, var(--green-700) 20%, transparent); } }
        .ps-wa-title { font-size: 13.5px; font-weight: 800; color: var(--green-800); }
        @media (prefers-color-scheme: dark) { .ps-wa-title { color: var(--green-400); } }
        .ps-wa-sub { font-size: 12px; color: var(--ink-600, var(--ink-700)); margin: 4px 0 11px; line-height: 1.5; }
        .ps-wa-empty { font-size: 12.5px; color: var(--ink-500); line-height: 1.5; }
        .ps-wa-empty a { color: var(--green-700); font-weight: 700; }
        @media (prefers-color-scheme: dark) { .ps-wa-empty a { color: var(--green-400); } }

        .ps-share-block { margin-bottom: 14px; }
        .ps-share-btn { padding: 15px; font-size: 16px; }
        .ps-share-hint { font-size: 12px; color: var(--ink-500); text-align: center; margin: 9px 6px 0; line-height: 1.45; }
        .ps-or { display: flex; align-items: center; gap: 12px; margin: 18px 0 14px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-400); }
        .ps-or::before, .ps-or::after { content: ''; flex: 1; height: 1px; background: var(--line); }

        .ps-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
        .ps-step-head { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 700; margin-bottom: 9px; }
        .ps-num { width: 22px; height: 22px; border-radius: 50%; background: var(--green-700); color: #fff;
          display: grid; place-items: center; font-size: 12px; font-weight: 800; flex: none; }
        @media (prefers-color-scheme: dark) { .ps-num { background: var(--green-500); color: #0f2e21; } }
        .ps-caption { margin: 0 0 9px; padding: 12px; background: var(--surface-sunk); border: 1px solid var(--line);
          border-radius: var(--r-md); font-family: inherit; font-size: 13px; line-height: 1.55; white-space: pre-wrap;
          word-break: break-word; max-height: 200px; overflow: auto; }
        .ps-media { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 9px; }
        .ps-media img, .ps-media video { width: 72px; height: 72px; object-fit: cover; border-radius: var(--r-sm); border: 1px solid var(--line); }
        .ps-media-ph { width: 72px; height: 72px; display: grid; place-items: center; font-size: 26px; background: #1c1c1c; border-radius: var(--r-sm); }
        .ps-nomedia { font-size: 12.5px; margin: 0; }
        .ps-hint { font-size: 12px; margin: 8px 0 0; text-align: center; }
      `}</style>
    </div>
  )
}
