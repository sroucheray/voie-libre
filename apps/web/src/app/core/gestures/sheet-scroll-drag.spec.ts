import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SheetScrollDrag } from './sheet-scroll-drag';
import type { SheetRelease } from './sheet-drag';

@Component({
  imports: [SheetScrollDrag],
  template: `<div
    class="list"
    vlSheetScrollDrag
    [sheetFull]="full()"
    (started)="log.push('started')"
    (moved)="moves.push($event)"
    (released)="releases.push($event)"
  >
    <input class="slider" type="range" />
    <span class="row">row</span>
  </div>`,
})
class Host {
  full = signal(false);
  log: string[] = [];
  moves: number[] = [];
  releases: SheetRelease[] = [];
}

function touch(
  type: string,
  y: number,
  time: number,
  target: Element,
  x = 100,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] },
    timeStamp: { value: time },
  });
  target.dispatchEvent(event);
  return event;
}

describe('SheetScrollDrag', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      host: fixture.componentInstance,
      fixture,
      list: root.querySelector('.list') as HTMLElement,
      row: root.querySelector('.row') as HTMLElement,
      slider: root.querySelector('.slider') as HTMLElement,
    };
  }

  it('moves the sheet with a vertical swipe on the content while it is not full', () => {
    const { host, list, row } = setup();
    touch('touchstart', 400, 0, row);
    const move = touch('touchmove', 360, 50, row);
    touch('touchmove', 300, 100, row);
    touch('touchend', 300, 110, row);
    expect(host.log).toEqual(['started']);
    expect(host.moves).toEqual([40, 100]);
    expect(host.releases).toHaveLength(1);
    expect(host.releases[0].up).toBe(100);
    expect(host.releases[0].velocity).toBeGreaterThan(0);
    // The page and the list do not scroll under the finger.
    expect(move.defaultPrevented).toBe(true);
    expect(list).toBeTruthy();
  });

  it('lets the content scroll when the sheet is full, except for a swipe down from the top', () => {
    const { host, fixture, list, row } = setup();
    host.full.set(true);
    fixture.detectChanges();
    // A swipe up scrolls the list.
    touch('touchstart', 400, 0, row);
    const up = touch('touchmove', 340, 50, row);
    touch('touchend', 340, 60, row);
    expect(host.log).toEqual([]);
    expect(up.defaultPrevented).toBe(false);
    // A swipe down with the list at its top lowers the sheet.
    list.scrollTop = 0;
    touch('touchstart', 300, 100, row);
    const down = touch('touchmove', 360, 150, row);
    touch('touchend', 360, 160, row);
    expect(host.log).toEqual(['started']);
    expect(down.defaultPrevented).toBe(true);
    expect(host.releases[0].up).toBe(-60);
  });

  it('keeps out of a sideways swipe and of a slider', () => {
    const { host, row, slider } = setup();
    touch('touchstart', 400, 0, row, 100);
    touch('touchmove', 395, 50, row, 160);
    touch('touchend', 395, 60, row);
    touch('touchstart', 400, 100, slider);
    touch('touchmove', 330, 150, slider);
    touch('touchend', 330, 160, slider);
    expect(host.log).toEqual([]);
  });
});
