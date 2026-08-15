/**
 * Inline SVG icon set for the scheduler UI. Centralising icons here keeps
 * the components readable and lets the icon library grow without touching
 * every file. All icons inherit `currentColor` so they pick up the
 * caller's text color.
 */

import type { ReactElement, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin">;

function svg(props: IconProps, d: ReactElement | ReactElement[], extra?: { fill?: string; strokeWidth?: number }) {
  const sw = extra?.strokeWidth ?? 1.7;
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {d}
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return svg(props, <polygon points="6 4 20 12 6 20 6 4" />);
}

export function IconPause(props: IconProps) {
  return svg(props, (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </>
  ));
}

export function IconEdit(props: IconProps) {
  return svg(props, (
    <>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      <path d="M14.5 5.5l4 4" />
    </>
  ));
}

export function IconTrash(props: IconProps) {
  return svg(props, (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ));
}

export function IconCopy(props: IconProps) {
  return svg(props, (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ));
}

export function IconPlus(props: IconProps) {
  return svg(props, (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ));
}

export function IconClose(props: IconProps) {
  return svg(props, (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ));
}

export function IconRefresh(props: IconProps) {
  return svg(props, (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </>
  ));
}

export function IconSearch(props: IconProps) {
  return svg(props, (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" />
    </>
  ));
}

export function IconChevronDown(props: IconProps) {
  return svg(props, <polyline points="6 9 12 15 18 9" />);
}

export function IconChevronRight(props: IconProps) {
  return svg(props, <polyline points="9 18 15 12 9 6" />);
}

export function IconBack(props: IconProps) {
  return svg(props, <polyline points="15 18 9 12 15 6" />);
}

export function IconClock(props: IconProps) {
  return svg(props, (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ));
}

export function IconCheck(props: IconProps) {
  return svg(props, <polyline points="20 6 9 17 4 12" />);
}

export function IconAlert(props: IconProps) {
  return svg(props, (
    <>
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.7 3h16.94a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ));
}

export function IconExternal(props: IconProps) {
  return svg(props, (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ));
}

export function IconFolder(props: IconProps) {
  return svg(props, (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ));
}

export function IconRobot(props: IconProps) {
  return svg(props, (
    <>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <line x1="12" y1="3" x2="12" y2="7" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </>
  ));
}

export function IconKeyboard(props: IconProps) {
  return svg(props, (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <line x1="6" y1="10" x2="6" y2="10" />
      <line x1="10" y1="10" x2="10" y2="10" />
      <line x1="14" y1="10" x2="14" y2="10" />
      <line x1="18" y1="10" x2="18" y2="10" />
      <line x1="7" y1="14" x2="17" y2="14" />
    </>
  ));
}

export function IconCircleDot(props: IconProps) {
  return svg(props, (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ));
}

export function IconCalendar(props: IconProps) {
  return svg(props, (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ));
}

export function IconHourglass(props: IconProps) {
  return svg(props, (
    <>
      <path d="M6 2h12M6 22h12" />
      <path d="M7 2v3a5 5 0 0 0 10 0V2" />
      <path d="M7 22v-3a5 5 0 0 1 10 0v3" />
    </>
  ));
}

export function IconLightning(props: IconProps) {
  return svg(props, <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);
}

export function IconFilter(props: IconProps) {
  return svg(props, (
    <>
      <polygon points="3 4 21 4 14 13 14 20 10 18 10 13 3 4" />
    </>
  ));
}

export function IconMoreH(props: IconProps) {
  return svg(props, (
    <>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ));
}