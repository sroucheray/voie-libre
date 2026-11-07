import { downloadInBrowser } from './file-download';

describe('downloadInBrowser', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a temporary link with the file name, then frees the object URL', async () => {
    vi.useFakeTimers();
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blob = b as Blob;
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });

    downloadInBrowser('<gpx/>', 'a.gpx', 'application/gpx+xml');

    expect(clicked).toEqual([{ href: 'blob:test', download: 'a.gpx' }]);
    expect(blob?.type).toBe('application/gpx+xml');
    expect(blob?.size).toBe('<gpx/>'.length);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
