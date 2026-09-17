"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { MarkdownEditor } from "@/components/markdown-editor/MarkdownEditor";
import { uploadNoteImage } from "@/lib/client/notes";

interface NotesEditorProps {
  noteRel: string;
  value: string;
  onChange: (next: string) => void;
  /** Triggered on Cmd/Ctrl+S for an immediate save. */
  onSave?: () => void;
}

/**
 * The notes panel's editor: the shared Markdown editor plus the one thing that
 * is notes-specific — where an attached image goes. Everything the user
 * touches (toolbar, shortcuts, highlighting) lives in `MarkdownEditor`.
 */
export function NotesEditor({ noteRel, value, onChange, onSave }: NotesEditorProps) {
  const { t } = useI18n();
  const toast = useToast();

  // A failed upload is reported here and answered with null, so the editor
  // inserts nothing and stays free of toast / i18n concerns.
  const uploadImage = useCallback(
    async (file: File) => {
      try {
        const { url } = await uploadNoteImage(noteRel, file);
        return url;
      } catch (err) {
        toast.show({
          kind: "error",
          message: t("Image upload failed"),
          description: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    [noteRel, t, toast],
  );

  return (
    <MarkdownEditor value={value} onChange={onChange} onSave={onSave} onUploadImage={uploadImage} />
  );
}
