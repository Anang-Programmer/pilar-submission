import type { ReactNode } from "react";

export type IconName =
  | "dashboard"
  | "articles"
  | "upload"
  | "review"
  | "revision"
  | "history"
  | "profile"
  | "logout"
  | "project"
  | "participants"
  | "journal"
  | "assignment"
  | "checkCircle"
  | "clock";

const SHAPES: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.75" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.75" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.75" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.75" />
    </>
  ),
  articles: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </>
  ),
  upload: (
    <>
      <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M12 4v12" />
    </>
  ),
  review: (
    <>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2.25" width="8" height="3.5" rx="1.25" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  revision: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.25V12l3.4 2" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
      <path d="M20 12H9.5" />
    </>
  ),
  project: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.5 7.5 7.5 4.25 7.5-4.25" />
      <path d="M12 11.75V21" />
    </>
  ),
  participants: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 11a2.75 2.75 0 1 0 0-5.5" />
      <path d="M16 14.5a4.5 4.5 0 0 1 4.5 4.5" />
    </>
  ),
  journal: (
    <>
      <path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z" />
      <path d="M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </>
  ),
  assignment: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3.5h6v1" />
      <path d="M8.5 10h7" />
      <path d="M8.5 14h4" />
      <path d="m14.5 14.5 1.5 1.5 3-3" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
