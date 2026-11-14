import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTestTransloco } from '../../../testing/transloco-testing';
import { LanguageService } from '../i18n/language.service';
import { Modal } from './modal';

@Component({
  imports: [Modal],
  template: `<vl-modal
    [open]="open()"
    heading="A title"
    (closed)="closedCount.update((n) => n + 1)"
    ><p class="inside">Content</p></vl-modal
  >`,
})
class Host {
  readonly open = signal(false);
  readonly closedCount = signal(0);
}

describe('Modal', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideTestTransloco()],
    }).compileComponents();
    TestBed.inject(LanguageService).use('en');
  });

  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, dialog: el.querySelector('dialog')! };
  }

  it('is closed until it is asked to open, and shows its title and its content', () => {
    const { fixture, el, dialog } = create();
    expect(dialog.open).toBe(false);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(el.querySelector('h2')?.textContent).toBe('A title');
    expect(el.querySelector('.inside')?.textContent).toBe('Content');
    expect(dialog.getAttribute('aria-label')).toBe('A title');
  });

  it('closes again when the parent turns it off', () => {
    const { fixture, dialog } = create();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
  });

  it('asks to close with the cross, with Escape, and with a click on the backdrop, but not on its content', () => {
    const { fixture, el, dialog } = create();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.close')!.click();
    expect(fixture.componentInstance.closedCount()).toBe(1);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.closedCount()).toBe(2);
    dialog.click();
    expect(fixture.componentInstance.closedCount()).toBe(3);
    el.querySelector<HTMLElement>('.inside')!.click();
    expect(fixture.componentInstance.closedCount()).toBe(3);
    // It stays open until the parent says so.
    expect(dialog.open).toBe(true);
  });
});
