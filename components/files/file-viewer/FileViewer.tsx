"use client";

import { AudioViewer } from "./AudioViewer";
import { ImageViewer } from "./ImageViewer";
import { MonacoViewer } from "./MonacoViewer";
import { PdfViewer } from "./PdfViewer";
import { VideoViewer } from "./VideoViewer";
import {
  isAudioPath,
  isImagePath,
  isPdfPath,
  isVideoPath,
  type FileViewerProps,
} from "./utils";

// Top-level dispatcher. Image / audio / video / PDF keep their dedicated
// viewers (which need streaming + native media tags); everything else —
// including .md and .html — falls through to MonacoViewer, which renders
// raw source with full syntax highlighting. Markdown / HTML preview panes
// were intentionally dropped in the Monaco refactor (see design notes).
export function FileViewer({ filePath, cwd }: FileViewerProps) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} />;
  }
  if (isVideoPath(filePath)) {
    return <VideoViewer filePath={filePath} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} />;
  }
  if (isPdfPath(filePath)) {
    return <PdfViewer filePath={filePath} />;
  }
  return <MonacoViewer filePath={filePath} cwd={cwd} />;
}
