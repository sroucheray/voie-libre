import { browserShareSheet } from './share-sheet';

const setNavigator = (props: Record<string, unknown>) => {
  for (const key of ['share', 'canShare']) {
    Object.defineProperty(navigator, key, {
      configurable: true,
      value: props[key],
    });
  }
};

describe('browserShareSheet', () => {
  afterEach(() => setNavigator({}));

  it('says it cannot share where the browser has no share method', () => {
    setNavigator({});
    expect(browserShareSheet.canShareUrl()).toBe(false);
    expect(browserShareSheet.canShareFile(new File([], 'a.gpx'))).toBe(false);
  });

  it('asks the browser whether it can share a file, which depends on the type', () => {
    setNavigator({
      share: async () => undefined,
      canShare: (data: ShareData) => data.files?.[0].type === 'text/plain',
    });
    expect(browserShareSheet.canShareUrl()).toBe(false);
    expect(
      browserShareSheet.canShareFile(
        new File([], 'a.txt', { type: 'text/plain' }),
      ),
    ).toBe(true);
    expect(
      browserShareSheet.canShareFile(
        new File([], 'a.gpx', { type: 'application/gpx+xml' }),
      ),
    ).toBe(false);
  });

  it('can share a link where canShare is missing but share exists', () => {
    setNavigator({ share: async () => undefined });
    expect(browserShareSheet.canShareUrl()).toBe(true);
  });

  it('tells shared, cancelled and failed apart', async () => {
    const data = { url: 'https://voielibre.app/r#x' };
    setNavigator({ share: async () => undefined });
    expect(await browserShareSheet.shareUrl(data)).toBe('shared');
    setNavigator({
      share: async () => {
        throw new DOMException('closed', 'AbortError');
      },
    });
    expect(await browserShareSheet.shareUrl(data)).toBe('cancelled');
    setNavigator({
      share: async () => {
        throw new DOMException('no', 'NotAllowedError');
      },
    });
    expect(await browserShareSheet.shareUrl(data)).toBe('failed');
  });

  it('shares a file with its title', async () => {
    const calls: ShareData[] = [];
    setNavigator({
      share: async (data: ShareData) => {
        calls.push(data);
      },
    });
    const file = new File(['<gpx/>'], 'a.gpx', { type: 'application/gpx+xml' });
    expect(await browserShareSheet.shareFile(file, 'Morning ride')).toBe(
      'shared',
    );
    expect(calls).toEqual([{ files: [file], title: 'Morning ride' }]);
  });
});
