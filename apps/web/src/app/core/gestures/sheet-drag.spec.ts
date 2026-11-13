import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SheetDrag, type SheetRelease } from './sheet-drag';

@Component({
  imports: [SheetDrag],
  template: `<button
    vlSheetDrag
    (started)="log.push('started')"
    (moved)="moves.push($event)"
    (released)="releases.push($event)"
    (click)="log.push('click')"
  >
    handle
  </button>`,
})
class Host {
  log: string[] = [];
  moves: number[] = [];
  releases: SheetRelease[] = [];
}

function pointer(type: string, y: number, time: number): PointerEvent {
  const event = new Event(type, { bubbles: true }) as unknown as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    button: { value: 0 },
    clientY: { value: y },
    timeStamp: { value: time },
  });
  return event;
}

describe('SheetDrag', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    return { host: fixture.componentInstance, button };
  }

  it('stays a click when the pointer does not travel', () => {
    const { host, button } = setup();
    button.dispatchEvent(pointer('pointerdown', 500, 0));
    button.dispatchEvent(pointer('pointermove', 498, 20));
    button.dispatchEvent(pointer('pointerup', 498, 40));
    button.click();
    expect(host.log).toEqual(['click']);
    expect(host.releases).toEqual([]);
  });

  it('reports the travel upwards while dragging and the release with its speed', () => {
    const { host, button } = setup();
    button.dispatchEvent(pointer('pointerdown', 500, 0));
    button.dispatchEvent(pointer('pointermove', 450, 50));
    button.dispatchEvent(pointer('pointermove', 400, 100));
    button.dispatchEvent(pointer('pointerup', 400, 100));
    expect(host.log).toEqual(['started']);
    expect(host.moves).toEqual([50, 100]);
    expect(host.releases[0].up).toBe(100);
    expect(host.releases[0].velocity).toBeCloseTo(1, 5);
  });

  it('swallows the click that ends a drag', () => {
    const { host, button } = setup();
    button.dispatchEvent(pointer('pointerdown', 500, 0));
    button.dispatchEvent(pointer('pointermove', 400, 50));
    button.dispatchEvent(pointer('pointerup', 400, 60));
    button.click();
    expect(host.log).toEqual(['started']);
  });
});
