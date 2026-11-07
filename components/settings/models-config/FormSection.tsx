"use client";

import type { ReactNode } from "react";
import styles from "./FormSection.module.css";

export interface FormSectionProps {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function FormSection({ title, aside, children }: FormSectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
