"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import styles from "./RightBarButton.module.css";

interface RightBarButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

export function RightBarButton({
  label,
  onClick,
  active = false,
  disabled = false,
  icon,
}: RightBarButtonProps) {
  const buttonClass = [styles.button, active ? styles.active : ""].filter(Boolean).join(" ");

  return (
    <Tooltip content={label} side="left">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active || undefined}
        className={buttonClass}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
