"use client";

import { AudioViewer } from "./AudioViewer";
import { ImageViewer } from "./ImageViewer";
import { MarkdownViewer } from "./MarkdownViewer";
import { MonacoViewer } from "./MonacoViewer";
import { PdfViewer } from "./PdfViewer";
import { VideoViewer } from "./VideoViewer";
import {
  isAudioPath,
  isImagePath,
  isMarkdownPath,
  isPdfPath,
  isVideoPath,
  type FileViewerProps,
} from "./utils";

export function FileViewer({ filePath, cwd, rightPanelState }: FileViewerProps) {
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
  if (isMarkdownPath(filePath)) {
    return <MarkdownViewer filePath={filePath} rightPanelState={rightPanelState} />;
  }
  return <MonacoViewer filePath={filePath} cwd={cwd} rightPanelState={rightPanelState} />;
}
