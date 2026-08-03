import { useEffect, useRef, useState } from 'react'
import { renderTextCard, loadImage } from '../lib/graphics.js'
import { uploadMedia } from '../lib/upload.js'

// One AI-planned content post: a real branded graphic + caption + Approve +
// Auto-post (to the agent's connected accounts) with an optional schedule.
export default function ContentPostCard({ post, lang, brand, catLabel, catColor, onToggle, onRemove, toast }) {
  const canvasRef = useRef(null)
  const [posting, setPosting] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [when, setWhen] = useState('')

  // Draw the branded content graphic into the preview canvas.
  useEffect(() => {
    let alive = true
    loadImage(brand?.logo).then((logo) => {
      if (!alive || !canvasRef.current) return
      const off = renderTextCard({ brand, headline: post.headline, category: catLabel, logo })
      const c = canvasRef.current
      c.width = off.width
      c.height = off.height
      c.getContext('2d').drawImage(off, 0, 0)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.headline, catLabel, brand?.color, brand?.logo, brand?.agency])

  async function publish(scheduledFor) {
    setPosting(true)
    try {
      const logo = await loadImage(brand?.logo)
      const off = renderTextCard({ brand, headline: post.headline, category: catLabel, logo })
      const blob = await new Promise((r) => off.toBlob(r, 'image/jpeg', 0.92))
      const mediaUrl = await uploadMedia(blob, `content-${post.id}.jpg`)
      const res = await fetch('/api/social-broadcast', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: post.captions?.[lang] || post.captions?.en, mediaUrl, mediaType: 'image', scheduledFor }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Post failed')
      toast(j.scheduled ? `Scheduled to ${(j.posted || []).join(', ')} 🗓️` : `Posted to ${(j.posted || []).join(', ')} 🎉`, 'success')
      setShowSchedule(false); setWhen('')
    } catch (e) { toast('Post failed: ' + e.message, 'danger') }
    finally { setPosting(false) }
  }

  return (
    <div className={`plan-card ${post.approved ? 'on' : ''}`}>
      <div className="plan-card-top">
        <span className="plan-cat" style={{ background: catColor }}>{catLabel}</span>
        <button className="plan-x" onClick={onRemove} aria-label="Remove">×</button>
      </div>
      <canvas ref={canvasRef} className="plan-canvas" />
      <p className="plan-caption">{post.captions?.[lang] || post.captions?.en}</p>
      <div className="plan-actions">
        <button className={`chip plan-approve ${post.approved ? 'on' : ''}`} aria-pressed={post.approved} onClick={onToggle}>
          {post.approved ? '✓ Approved' : 'Approve'}
        </button>
        {!showSchedule ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => publish()} disabled={posting}>{posting ? 'Posting…' : 'Auto-post'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSchedule(true)} title="Schedule for later" aria-label="Schedule for later">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </button>
          </>
        ) : (
          <>
            <input type="datetime-local" className="schedule-input" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={() => when && publish(new Date(when).toISOString())} disabled={posting || !when}>{posting ? '…' : 'Schedule'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowSchedule(false); setWhen('') }}>✕</button>
          </>
        )}
      </div>
    </div>
  )
}
