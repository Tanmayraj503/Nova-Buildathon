export default function PanelHeader({ icon, title, subtitle, topBarClassName, topBarStyle, right }) {
  return (
    <header className="sticky top-0 z-10 bg-panel/95 backdrop-blur border-b border-hairline">
      <div className={`h-[3px] w-full ${topBarClassName ?? 'bg-hairline'}`} style={topBarStyle} />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none" aria-hidden="true">
              {icon}
            </span>
            <h2 className="font-display text-[13px] font-semibold tracking-wide text-ink uppercase truncate">
              {title}
            </h2>
          </div>
          {subtitle && <p className="mt-0.5 text-[11px] text-ink-faint truncate">{subtitle}</p>}
        </div>
        {right && <div className="flex-shrink-0">{right}</div>}
      </div>
    </header>
  );
}
