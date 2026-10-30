"use client";

import { AttachmentList } from "./AttachmentList";
import { SlashCommandHint } from "./SlashCommandHint";
import type { AttachedImage } from "./chat-input/types";
import type { SlashResource } from "@/lib/shared/slash-commands";

export function ChatInputAttachments({ images, selectedSlashResource, onRemoveImage, onRemoveSlashResource }: {
  images: AttachedImage[];
  selectedSlashResource: SlashResource | null;
  onRemoveImage: (index: number) => void;
  onRemoveSlashResource: () => void;
}) {
  if (images.length === 0 && !selectedSlashResource) return null;
  return (
    <div style={{ position: "absolute", zIndex: 10, bottom: "100%", left: 0, right: "min(320px, 50%)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, overflowX: "auto", padding: "4px 4px 0" }}>
      <AttachmentList images={images} onRemove={onRemoveImage} />
      {selectedSlashResource && (
        <SlashCommandHint resource={selectedSlashResource} onRemove={onRemoveSlashResource} />
      )}
    </div>
  );
}
