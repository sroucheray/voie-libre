import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { LanguageService } from '../i18n/language.service';
import { OfflineBasemap, type OfflineState } from './offline-basemap';
import { OfflineMap } from './offline-map';

class FakeOffline {
  state = signal<OfflineState>('none');
  progress = signal(0);
  downloadedBytes = signal(0);
  totalBytes = signal(0);
  sizeBytes = signal(0);
  errorCode = signal<'unsupported' | 'network' | 'quota' | 'unknown' | null>(
    null,
  );
  calls: string[] = [];
  download() {
    this.calls.push('download');
  }
  cancel() {
    this.calls.push('cancel');
  }
  remove() {
    this.calls.push('remove');
  }
}

describe('OfflineMap', () => {
  let offline: FakeOffline;

  beforeEach(async () => {
    localStorage.clear();
    offline = new FakeOffline();
    await TestBed.configureTestingModule({
      imports: [OfflineMap],
      providers: [
        provideTestTransloco(),
        { provide: OfflineBasemap, useValue: offline },
      ],
    }).compileComponents();
    TestBed.inject(LanguageService).init();
  });

  function render() {
    const fixture = TestBed.createComponent(OfflineMap);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      update: async () => {
        TestBed.tick();
        await fixture.whenStable();
        fixture.detectChanges();
      },
      text: () => root.textContent!.replace(/\s+/g, ' ').trim(),
    };
  }

  it('offers the download when nothing is on the device', async () => {
    const view = render();
    await view.update();
    const button = view.root.querySelector('button')!;
    expect(button.textContent).toContain('Download the map for offline use');
    button.click();
    expect(offline.calls).toEqual(['download']);
  });

  it('disables the button while it checks what is on the device', async () => {
    offline.state.set('checking');
    const view = render();
    await view.update();
    expect(view.root.querySelector('button')!.disabled).toBe(true);
  });

  it('shows the progress and a cancel button while downloading', async () => {
    offline.state.set('downloading');
    offline.progress.set(0.5);
    offline.downloadedBytes.set(20_000_000);
    offline.totalBytes.set(40_000_000);
    const view = render();
    await view.update();
    const progress = view.root.querySelector('progress')!;
    expect(progress.value).toBe(50);
    expect(view.text()).toContain('20 MB of 40 MB');
    view.root.querySelector('button')!.click();
    expect(offline.calls).toEqual(['cancel']);
  });

  it('shows the size and a remove button when the map is on the device', async () => {
    offline.state.set('ready');
    offline.sizeBytes.set(42_680_958);
    const view = render();
    await view.update();
    expect(view.text()).toContain('Map available offline (42.7 MB)');
    view.root.querySelector('button')!.click();
    expect(offline.calls).toEqual(['remove']);
  });

  it.each([
    ['unsupported', 'cannot keep the map offline', 'ne peut pas conserver'],
    ['network', 'could not be downloaded', "n'a pas pu être téléchargée"],
    ['quota', 'Not enough storage space', 'Espace de stockage insuffisant'],
    ['unknown', 'could not be saved', "n'a pas pu être enregistrée"],
  ] as const)('translates the %s error', async (code, english, french) => {
    offline.state.set('error');
    offline.errorCode.set(code);
    const view = render();
    await view.update();
    expect(view.root.querySelector('[role="alert"]')?.textContent).toContain(
      english,
    );
    TestBed.inject(LanguageService).use('fr');
    await view.update();
    await view.update();
    expect(view.root.querySelector('[role="alert"]')?.textContent).toContain(
      french,
    );
  });
});
