import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin"> & {
  size?: number | string;
  strokeWidth?: number;
  stroke?: string;
};

type IconBody = React.ReactNode;

function Icon({ size = 16, children, fill = "none", stroke = "currentColor", strokeWidth = 2, ...props }: IconProps & { children: IconBody }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (props: IconProps) => <Icon {...props}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
export const MinusIcon = (props: IconProps) => <Icon {...props}><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
export const CloseIcon = (props: IconProps) => <Icon {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;
export const CheckIcon = (props: IconProps) => <Icon {...props}><polyline points="20 6 9 17 4 12" /></Icon>;
export const SearchIcon = (props: IconProps) => <Icon {...props}><circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.5" y2="16.5" /></Icon>;
export const RefreshIcon = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 10 9 10" /></Icon>;
export const ChevronDownIcon = (props: IconProps) => <Icon {...props}><polyline points="6 9 12 15 18 9" /></Icon>;
export const ChevronRightIcon = (props: IconProps) => <Icon {...props}><polyline points="9 18 15 12 9 6" /></Icon>;
export const ChevronLeftIcon = (props: IconProps) => <Icon {...props}><polyline points="15 18 9 12 15 6" /></Icon>;
export const ArrowLeftIcon = (props: IconProps) => <Icon {...props}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></Icon>;
export const ArrowRightIcon = (props: IconProps) => <Icon {...props}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></Icon>;
export const CopyIcon = (props: IconProps) => <Icon {...props}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>;
export const TrashIcon = (props: IconProps) => <Icon {...props}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Icon>;
export const EditIcon = (props: IconProps) => <Icon {...props}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /><path d="M14.5 5.5l4 4" /></Icon>;
export const ExternalLinkIcon = (props: IconProps) => <Icon {...props}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></Icon>;
export const ClockIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></Icon>;
export const CalendarIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></Icon>;
export const AlertIcon = (props: IconProps) => <Icon {...props}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.7 3h16.94a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Icon>;
export const FolderIcon = (props: IconProps) => <Icon {...props}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Icon>;
export const TerminalGlyphIcon = (props: IconProps) => <Icon {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></Icon>;
export const StopIcon = (props: IconProps) => <Icon {...props}><rect x="6" y="6" width="12" height="12" rx="1" /></Icon>;
export const PlayIcon = (props: IconProps) => <Icon {...props}><polygon points="6 4 20 12 6 20 6 4" /></Icon>;
export const PauseIcon = (props: IconProps) => <Icon {...props}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></Icon>;
export const StarIcon = (props: IconProps & { filled?: boolean }) => <Icon {...props} fill={props.filled ? "currentColor" : "none"}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Icon>;
export const SunIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="4.22" y1="4.22" x2="6.34" y2="6.34" /><line x1="17.66" y1="17.66" x2="19.78" y2="19.78" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /><line x1="4.22" y1="19.78" x2="6.34" y2="17.66" /><line x1="17.66" y1="6.34" x2="19.78" y2="4.22" /></Icon>;
export const MoonIcon = (props: IconProps) => <Icon {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Icon>;
export const SidebarIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></Icon>;
export const PanelRightIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></Icon>;
export const SparkleIcon = (props: IconProps) => <Icon {...props}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></Icon>;
export const GlobeIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" /></Icon>;
export const BracesIcon = (props: IconProps) => <Icon {...props}><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-4a2 2 0 0 1-2-2 2 2 0 0 1 2-2V5a2 2 0 0 0-2-2h-1" /></Icon>;
export const ChipIcon = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></Icon>;
export const GearIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Icon>;
export const CanvasIcon = (props: IconProps) => <Icon {...props}><path d="M3 17l4-4 3 3 7-7 4 4" /><circle cx="6" cy="6" r="2" /></Icon>;
export const BookIcon = (props: IconProps) => <Icon {...props}><path d="M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5" /><path d="M8 7h8M8 11h6" /></Icon>;
export const LanguageIcon = (props: IconProps) => <Icon {...props}><path d="M5 8h14M8 5h7M11 12c0 4-3 7-6 7M11 12c0 4 3 7 6 7M9 19l3-7 3 7" /></Icon>;
export const LightbulbIcon = (props: IconProps) => <Icon {...props}><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" /><path d="M7 18h5M8 21h3" /></Icon>;
export const TokensChartIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M8.5 16l1-3M12 16l1-5M15.5 16l1-7M7 17h10" /></Icon>;
export const GitDiffGlyphIcon = (props: IconProps) => <Icon {...props}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><path d="M6 9v6M18 9a9 9 0 0 1-9 9" /></Icon>;
export const LlmAuditGlyphIcon = (props: IconProps) => <Icon {...props}><path d="M2 12h3l2-4 3 8 2-4h2" /><circle cx="15.5" cy="15.5" r="2.5" /><path d="M17.5 17.5 20 20" /></Icon>;
export const RssIcon = (props: IconProps) => <Icon {...props}><circle cx="5" cy="19" r="1.2" fill="currentColor" stroke="none" /><path d="M4 13a7 7 0 0 1 7 7M4 7a13 13 0 0 1 13 13" /></Icon>;
export const ToolIcon = (props: IconProps) => <Icon {...props}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></Icon>;
export const JsonIcon = (props: IconProps) => <Icon {...props}><path d="M8 3H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 1-2 2v3a2 2 0 0 1-2 2h-2" /></Icon>;
export const ConversationTreeGlyphIcon = (props: IconProps) => <Icon {...props}><circle cx="4" cy="5" r="1.5" /><circle cx="4" cy="19" r="1.5" /><circle cx="20" cy="5" r="1.5" /><path d="M4 6.5v11M20 6.5a10 10 0 0 1-10 10" /></Icon>;
export const PanelToggleIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></Icon>;
export const ExpandLeftIcon = (props: IconProps) => <Icon {...props}><polyline points="13 7 18 12 13 17" /><polyline points="6 7 11 12 6 17" /></Icon>;
export const MaximizeIcon = (props: IconProps) => <Icon {...props}><polyline points="8 3 3 3 3 8" /><polyline points="16 3 21 3 21 8" /><polyline points="8 21 3 21 3 16" /><polyline points="16 21 21 21 21 16" /><line x1="3" y1="3" x2="8" y2="8" /><line x1="21" y1="3" x2="16" y2="8" /><line x1="3" y1="21" x2="8" y2="16" /><line x1="21" y1="21" x2="16" y2="16" /></Icon>;
export const MinimizeIcon = (props: IconProps) => <Icon {...props}><polyline points="8 3 8 8 3 8" /><polyline points="16 3 16 8 21 8" /><polyline points="8 21 8 16 3 16" /><polyline points="16 21 16 16 21 16" /></Icon>;
export const TodoCheckIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><polyline points="8 12 11 15 17 9" /></Icon>;
export const StarIconWithFill = ({ fill = "none", ...props }: IconProps & { fill?: string }) => <Icon {...props} fill={fill}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Icon>;
