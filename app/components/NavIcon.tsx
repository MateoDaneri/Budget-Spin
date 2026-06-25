import type { NavIconKey } from "@/app/components/nav-config";

const paths: Record<NavIconKey, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  income: (
    <>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
      <path d="M5 21h14" />
    </>
  ),
  expenses: (
    <>
      <path d="M12 21V9m0 0l-4 4m4-4l4 4" />
      <path d="M5 3h14" />
    </>
  ),
  plans: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  categories: <path d="M4 5h16M4 12h16M4 19h10" />,
  setup: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4.8a7.7 7.7 0 0 0-1.8-1l-.4-2.5h-4l-.4 2.5a7.7 7.7 0 0 0-1.8 1l-2.4-.8-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-.8a7.7 7.7 0 0 0 1.8 1l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 1.8-1l2.4.8 2-3.4z" />
    </>
  )
};

export function NavIcon({ icon }: { icon: NavIconKey }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[icon]}
    </svg>
  );
}
