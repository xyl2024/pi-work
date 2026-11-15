"use client";

import { AttachmentList } from "./AttachmentList";
import { SlashCommandHint } from "./SlashCommandHint";
import { FollowUpHint } from "./FollowUpHint";
import type { AttachedImage } from "./chat-input/types";
import type { SlashResource } from "@/lib/shared/slash-commands";

export interface PendingFollowUp {
  id: number;
  message: string;
  images?: AttachedImage[];
}

export function ChatInputAttachments({ images, selectedSlashResource, pendingFollowUps, onRemoveImage, onRemoveSlashResource, onRemoveFollowUp }: {
  images: AttachedImage[];
  selectedSlashResource: SlashResource | null;
  pendingFollowUps?: PendingFollowUp[];
  onRemoveImage: (index: number) => void;
  onRemoveSlashResource: () => void;
  onRemoveFollowUp?: (id: number) => void;
}) {
  if (images.length === 0 && !selectedSlashResource && !(pendingFollowUps?.length)) return null;
  return (
    <div style={{ position: "absolute", zIndex: 10, bottom: "100%", left: 0, right: "min(320px, 50%)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, overflowX: "auto", padding: "4px 4px 0" }}>
      <AttachmentList images={images} onRemove={onRemoveImage} />
      {selectedSlashResource && (
        <SlashCommandHint resource={selectedSlashResource} onRemove={onRemoveSlashResource} />
      )}
      {pendingFollowUps?.map((entry) => (
        <FollowUpHint key={entry.id} text={entry.message} onRemove={() => onRemoveFollowUp?.(entry.id)} />
      ))}
    </div>
  );
}
