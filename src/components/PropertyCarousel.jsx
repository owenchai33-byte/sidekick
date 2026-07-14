import { useRef, useEffect, useState } from 'react'
import { loadImage, renderCarousel } from '../lib/graphics.js'
import { makeZip, canvasToBytes } from '../lib/zip.js'
import { listingLabel } from '../lib/format.js'

// A branded multi-slide carousel for Instagram / Facebook — cover, photo/spec
// slides and a contact CTA. Previews one slide at a time; downloads all slides
// as a single .zip. Rendering lives in ../lib/graphics.js (shared with the kit).

const slug = (s) => String(s || 'listing').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'listing'

export default function PropertyCarousel({ listing, brand }) {
  const canvasesRef = useRef([])
  const [slides, setSlides] = useState([])
  const [i, setI] = useState(0)
  const [ready, setReady] = useState(false)
  const key = JSON.stringify([
    listing.id, listing.price, listing.listingType, listing.location, listing.propertyType,
    listing.bedrooms, listing.bathrooms, listing.sqft, listing.tenure, listing.furnishing,
    (listing.photos || []).slice(0, 4).map((p) => p?.slice(0, 40)),
    brand.agency, brand.name, brand.phone, brand.color, brand.logo?.slice(0, 40),
  ])

  useEffect(() => {
    let alive = true
    setReady(false); setI(0)
    Promise.all([loadImage(brand.logo), ...(listing.photos || []).slice(0, 4).map(loadImage)]).then((loaded) => {
      if (!alive) return
      const logo = loaded[0]
      const photos = loaded.slice(1)
      const canvases = renderCarousel({ listing, brand, photos, logo })
      canvasesRef.current = canvases
      setSlides(canvases.map((c) => c.toDataURL('image/png')))
      setReady(true)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function download() {
    const files = await Promise.all(
      canvasesRef.current.map(async (c, idx) => ({ name: `slide-${String(idx + 1).padStart(2, '0')}.png`, data: await canvasToBytes(c) })),
    )
    const blob = makeZip(files)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(listingLabel(listing))}-carousel.zip`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const n = slides.length
  return (
    <div className="pcar">
      <div className="pcar-stage">
        {slides[i]
          ? <img src={slides[i]} alt={`Carousel slide ${i + 1} of ${n}`} />
          : <div className="pcar-skel" />}
        {ready && n > 1 && (
          <>
            <button className="pcar-nav prev" onClick={() => setI((v) => (v - 1 + n) % n)} aria-label="Previous slide">‹</button>
            <button className="pcar-nav next" onClick={() => setI((v) => (v + 1) % n)} aria-label="Next slide">›</button>
          </>
        )}
      </div>
      <div className="pcar-dots">
        {slides.map((_, idx) => (
          <button key={idx} className={idx === i ? 'on' : ''} onClick={() => setI(idx)} aria-label={`Go to slide ${idx + 1}`} />
        ))}
      </div>
      <button className="btn btn-subtle btn-sm" onClick={download} disabled={!ready}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
        Download carousel ({n})
      </button>
      <style>{`
        .pcar { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
        .pcar-stage { position: relative; width: 100%; max-width: 320px; aspect-ratio: 1 / 1; }
        .pcar-stage img, .pcar-skel { width: 100%; height: 100%; border-radius: 12px; display: block; box-shadow: var(--shadow-md); object-fit: cover; }
        .pcar-skel { background: var(--surface-sunk); }
        .pcar-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border-radius: 50%;
          border: none; background: rgba(0,0,0,0.5); color: #fff; font-size: 22px; line-height: 1; cursor: pointer;
          display: grid; place-items: center; padding-bottom: 3px; transition: background 0.15s; -webkit-tap-highlight-color: transparent; }
        .pcar-nav:hover { background: rgba(0,0,0,0.72); }
        .pcar-nav.prev { left: 8px; } .pcar-nav.next { right: 8px; }
        .pcar-dots { display: flex; gap: 7px; }
        .pcar-dots button { width: 7px; height: 7px; border-radius: 50%; border: none; padding: 0; cursor: pointer; background: var(--line-strong); transition: all 0.15s; }
        .pcar-dots button.on { background: var(--green-600); width: 20px; border-radius: 4px; }
        @media (prefers-color-scheme: dark) { .pcar-dots button.on { background: var(--green-400); } }
      `}</style>
    </div>
  )
}
