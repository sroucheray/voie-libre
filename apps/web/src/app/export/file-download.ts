import { InjectionToken } from '@angular/core';

/** Hands a file to the user. Replaced in tests, and by the share plugin under Capacitor. */
export type FileDownloader = (
  content: string,
  fileName: string,
  mimeType: string,
) => void;

/** Browser download: a temporary object URL clicked through a hidden link. */
export const downloadInBrowser: FileDownloader = (
  content,
  fileName,
  mimeType,
) => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke later: some browsers start the download after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const FILE_DOWNLOADER = new InjectionToken<FileDownloader>(
  'FILE_DOWNLOADER',
  { providedIn: 'root', factory: () => downloadInBrowser },
);
