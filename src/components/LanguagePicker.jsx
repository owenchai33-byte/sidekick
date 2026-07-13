import { LANGUAGES } from '../../shared/constants.js'

// Tri-language selection — the signature feature. Agents pick which languages to
// generate/publish (a top agent may target the Malay market exclusively).
export default function LanguagePicker({ selected, onToggle }) {
  return (
    <div className="lp" role="group" aria-label="Languages">
      {LANGUAGES.map((l) => {
        const on = selected.includes(l.id)
        return (
          <button
            key={l.id}
            type="button"
            className={`chip on-timber ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(l.id)}
          >
            <strong style={{ fontSize: 13 }}>{l.label}</strong>
            <span style={{ opacity: 0.8, fontWeight: 500 }}>{l.native}</span>
          </button>
        )
      })}
      <style>{`
        .lp { display: flex; gap: 8px; flex-wrap: wrap; }
      `}</style>
    </div>
  )
}
