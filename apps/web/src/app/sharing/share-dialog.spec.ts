import { TestBed } from '@angular/core/testing';
import { createApiClient } from '@voie-libre/api-client';
import {
  InMemoryRouteStore,
  provideInMemoryRouteStore,
} from '../../testing/in-memory-route-store';
import { provideTestTransloco } from '../../testing/transloco-testing';
import { API_CLIENT } from '../core/api/api-client';
import { LanguageService } from '../core/i18n/language.service';
import type { RouteLink } from './route-link';
import { ShareDialog } from './share-dialog';
import { ShareDialogService } from './share-dialog.service';
import { SHARE_SHEET } from './share-sheet';

const link: RouteLink = {
  points: [
    [3.087, 45.777],
    [3.249, 45.544],
  ],
  profile: 'road',
  loop: null,
  name: 'Clermont to Issoire',
};

const newRoute = (ascentMeters: number | null = 399) => ({
  name: 'Clermont to Issoire',
  profile: 'road' as const,
  points: link.points,
  geometry: [
    [3.087, 45.777, 402],
    [3.249, 45.544, 380],
  ] as [number, number, number][],
  distanceMeters: 41007,
  ascentMeters,
  durationSeconds: 8674,
});

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('ShareDialog', () => {
  let routeStore: InMemoryRouteStore;
  let calls: {
    method: string;
    path: string;
    body: unknown;
    auth: string | null;
  }[];
  let respond: (request: Request) => Response;
  let written: string[];

  beforeEach(async () => {
    routeStore = new InMemoryRouteStore();
    calls = [];
    written = [];
    respond = () =>
      json(
        {
          id: 'x',
          deleteToken: 'secret-token',
          expiresAt: Date.now() + 7 * 86400000,
        },
        201,
      );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    await TestBed.configureTestingModule({
      providers: [
        provideTestTransloco(),
        provideInMemoryRouteStore(routeStore),
        {
          provide: SHARE_SHEET,
          useValue: {
            canShareUrl: () => false,
            canShareFile: () => false,
            shareUrl: async () => 'shared',
            shareFile: async () => 'shared',
          },
        },
        {
          provide: API_CLIENT,
          useValue: createApiClient({
            baseUrl: 'http://api.test',
            fetch: async (request) => {
              const text = await request.clone().text();
              calls.push({
                method: request.method,
                path: new URL(request.url).pathname,
                body: text ? JSON.parse(text) : undefined,
                auth: request.headers.get('authorization'),
              });
              return respond(request);
            },
          }),
        },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  async function open(savedId: string | null = null) {
    const fixture = TestBed.createComponent(ShareDialog);
    TestBed.inject(ShareDialogService).open({ link, savedId });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const click = async (selector: string) => {
      el.querySelector<HTMLElement>(selector)!.click();
      await settle();
    };
    return { fixture, el, settle, click };
  }

  it('is closed until a button asks for it', () => {
    const fixture = TestBed.createComponent(ShareDialog);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
  });

  it('opens on the link that contains the route, with copy, share and QR code under the choice', async () => {
    const { el, click } = await open();
    expect(el.querySelector('dialog')).not.toBeNull();
    expect(el.textContent).toContain('The link contains the route');
    expect(el.textContent).toContain('Short link, kept for a while');
    expect(el.textContent).toContain('It is not stored on any server');
    // The choice comes before the buttons that carry the link.
    const kinds = el.querySelector('.kinds')!;
    const copy = el.querySelector('.copy-link')!;
    expect(
      kinds.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await click('.copy-link');
    expect(written[0]).toContain('/r#v=1&p=road');
    expect(calls).toEqual([]);
  });

  it('needs a saved route for a short link, and says so', async () => {
    const { el, click } = await open(null);
    expect(el.textContent).toContain('Save the route first');
    await click('input[value="short"]');
    expect(el.querySelector('.create')).toBeNull();
  });

  it('needs the climb for a short link', async () => {
    const saved = await routeStore.save(newRoute(null));
    const { el } = await open(saved.id);
    expect(el.textContent).toContain('climb');
    expect(el.querySelector('.kind.blocked')).not.toBeNull();
  });

  describe('the short link', () => {
    async function openShort() {
      const saved = await routeStore.save(newRoute());
      const view = await open(saved.id);
      await view.click('input[value="short"]');
      return { ...view, saved };
    }

    it('offers a day, a week or a month, the week first, and sends nothing until it is created', async () => {
      const { el } = await openShort();
      const options = [
        ...el.querySelectorAll<HTMLElement>('.lifetimes [role="radio"]'),
      ];
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        '1 day',
        '1 week',
        '1 month',
      ]);
      expect(options[1].getAttribute('aria-checked')).toBe('true');
      expect(calls).toEqual([]);
      expect(el.querySelector<HTMLButtonElement>('.copy-link')!.disabled).toBe(
        true,
      );
    });

    it('creates the copy for the lifetime chosen, keeps the token on the device and enables the buttons', async () => {
      const { el, click, saved } = await openShort();
      await click('.lifetimes [role="radio"]:first-of-type');
      await click('.create');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: 'PUT',
        path: `/p/${saved.id}`,
        body: { lifetime: 'day', name: 'Clermont to Issoire' },
      });
      expect((await routeStore.get(saved.id))?.share?.deleteToken).toBe(
        'secret-token',
      );
      expect(el.querySelector('.valid')?.textContent).toContain('Valid until');
      expect(el.textContent).not.toContain('secret-token');
      expect(el.querySelector('.create')).toBeNull();
      await click('.copy-link');
      expect(written[0]).toMatch(new RegExp(`/p/${saved.id}$`));
      expect(TestBed.inject(ShareDialogService).changed()).toBe(1);
    });

    it('removes the copy with the token before its time is up', async () => {
      const { el, click, saved } = await openShort();
      await click('.create');
      calls.length = 0;
      respond = () => json(null, 204);
      await click('.delete-copy');
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('DELETE');
      expect(calls[0].auth).toBe('Bearer secret-token');
      expect((await routeStore.get(saved.id))?.share).toBeUndefined();
      expect(el.querySelector('.create')).not.toBeNull();
    });

    it('offers to create again once the copy has expired', async () => {
      const saved = await routeStore.save(newRoute());
      await routeStore.setShare(saved.id, {
        deleteToken: 't',
        sharedAt: 1,
        expiresAt: Date.now() - 1000,
      });
      const { el, click } = await open(saved.id);
      await click('input[value="short"]');
      expect(el.querySelector('.create')).not.toBeNull();
      expect(el.querySelector('.valid')).toBeNull();
    });

    it.each([
      [
        429,
        { statusCode: 429, message: 'Rate limit exceeded' },
        'Too many routes',
      ],
      [413, { code: 'payload_too_large', message: 'x' }, 'too large to share'],
    ] as const)(
      'translates a %i and keeps nothing',
      async (status, body, message) => {
        const { el, click, saved } = await openShort();
        respond = () => json(body, status);
        await click('.create');
        expect(el.querySelector('.error')?.textContent).toContain(message);
        expect((await routeStore.get(saved.id))?.share).toBeUndefined();
      },
    );

    it('reports an unreachable server', async () => {
      const { el, click } = await openShort();
      respond = () => {
        throw new TypeError('Failed to fetch');
      };
      await click('.create');
      expect(el.querySelector('.error')?.textContent).toContain(
        'cannot be reached',
      );
    });
  });

  describe('a loop by distance', () => {
    const loop = { mode: 'distance', distanceMeters: 30000 } as const;
    const show = async (alternative?: { rank: number; count: number }) => {
      const fixture = TestBed.createComponent(ShareDialog);
      TestBed.inject(ShareDialogService).open({
        link: {
          ...link,
          points: [link.points[0], link.points[0]],
          loop,
          alternative,
        },
        savedId: null,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('warns that it may come out another way when the chosen alternative is not known', async () => {
      expect((await show()).textContent).toContain('may come out another way');
    });

    it('does not warn when the link says which alternative it is', async () => {
      const el = await show({ rank: 2, count: 3 });
      expect(el.textContent).not.toContain('may come out another way');
    });
  });

  it('closes with the cross', async () => {
    const { el, click, fixture } = await open();
    await click('.close');
    expect(TestBed.inject(ShareDialogService).target()).toBeNull();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(el.textContent).toBe('');
  });
});
