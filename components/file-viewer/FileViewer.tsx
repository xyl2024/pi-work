"use client";

import { AudioViewer } from "./AudioViewer";
import { ImageViewer } from "./ImageViewer";
import { PdfViewer } from "./PdfViewer";
import { TextViewer } from "./TextViewer";
import { VideoViewer } from "./VideoViewer";
import {
  isAudioPath,
  isImagePath,
  isPdfPath,
  isVideoPath,
  type FileViewerProps,
} from "./utils";

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
  return <TextViewer filePath={filePath} cwd={cwd} />;
}
