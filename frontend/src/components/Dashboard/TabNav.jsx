export default function TabNav({ tabs, activeId, onChange }) {
  return (
    <nav
      role="tablist"
      className="overflow-x-auto -mx-1 px-1 border-b border-line dark:border-d-line"
    >
      <ul className="flex items-stretch gap-1 min-w-max">
        {tabs.map((t) => {
          const active = t.id === activeId
          return (
            <li key={t.id}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(t.id)}
                className={`relative inline-flex items-center px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'text-accent'
                    : 'text-ink-500 dark:text-d-muted hover:text-ink-800 dark:hover:text-d-text'
                }`}
              >
                {t.label}
                <span
                  className={`absolute left-2 right-2 bottom-0 h-0.5 rounded-t-full transition-opacity ${active ? 'bg-accent opacity-100' : 'bg-transparent opacity-0'}`}
                />
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
