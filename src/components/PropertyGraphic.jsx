import { useRef, useEffect, useState } from 'react'
import { listingLabel } from '../lib/format.js'
import { loadImage, renderGraphicCanvas } from '../lib/graphics.js'
import { coverPhoto } from '../lib/photos.js'
import { shareToApps, shareFiles, canvasToFile } from '../lib/share.js'

// Renders the branded single-image "property card" (square/portrait/story) via
// the shared graphics lib and exports a full-resolution PNG. The drawing logic
// lives in ../lib/graphics.js so the carousel and the kit bundler reuse it.

export default function PropertyGraphic({ listing, brand, format = 'square', children }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const key = JSON.stringify([
    listing.id, listing.price, listing.listingType, listing.location, listing.propertyType,
    listing.bedrooms, listing.bathrooms, listing.sqft, coverPhoto(listing)?.slice(0, 60),
    brand.agency, brand.name, brand.phone, brand.color, !!brand.logo, brand.logo?.slice(0, 40), format,
  ])

  useEffect(() => {
    let alive = true
    setReady(false)
    Promise.all([loadImage(coverPhoto(listing)), loadImage(brand.logo)]).then(([photo, logo]) => {
      if (!alive) return
      const c = canvasRef.current
      if (!c) return
      const off = renderGraphicCanvas({ listing, brand, format, photo, logo })
      c.width = off.width
      c.height = off.height
      c.getContext('2d').drawImage(off, 0, 0)
      setReady(true)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const slug = listingLabel(listing).replace(/[^\w]+/g, '-').toLowerCase()
  const shareable = shareToApps()

  function download() {
    canvasRef.current.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}-${format}.jpg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }, 'image/jpeg', 0.92)
  }

  async function share() {
    const file = await canvasToFile(canvasRef.current, `${slug}-${format}.jpg`)
    await shareFiles({ title: listingLabel(listing), text: listingLabel(listing), files: [file] })
  }

  return (
    <div className={`pg pg-${format}`}>
      <canvas ref={canvasRef} className="pg-canvas" />
      {children}
      <div className="pg-actions">
        <button className="btn btn-subtle btn-sm" onClick={download} disabled={!ready}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
          {shareable ? 'Download' : 'Download image'}
        </button>
        {shareable && (
          <button className="btn btn-primary btn-sm" onClick={share} disabled={!ready}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8h16v-8M12 3v13M8 7l4-4 4 4" /></svg>
            Share
          </button>
        )}
      </div>
      <style>{`
        .pg { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .pg-actions { display: flex; gap: 8px; }
        .pg-canvas { width: 100%; border-radius: 12px; display: block; box-shadow: var(--shadow-md); background: var(--surface-sunk); }
        .pg-square .pg-canvas { max-width: 320px; }
        .pg-portrait .pg-canvas { max-width: 280px; }
        .pg-story .pg-canvas { max-width: 220px; }
      `}</style>
    </div>
  )
}
