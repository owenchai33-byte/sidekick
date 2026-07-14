import { useNavigate } from 'react-router-dom'

// A clear, tappable back control for mobile (and desktop). Uses real history
// when there is any, otherwise falls back to a sensible parent route.
export default function BackButton({ to = '/', label = 'Back' }) {
  const navigate = useNavigate()
  const go = () => {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate(to)
  }
  return (
    <button type="button" className="backbtn" onClick={go}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>{label}</span>
    </button>
  )
}
