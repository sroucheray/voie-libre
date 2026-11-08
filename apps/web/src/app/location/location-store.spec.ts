import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  FakeGeolocation,
  provideFakeGeolocation,
} from '../../testing/fake-geolocation';
import { LocationStore } from './location-store';

describe('LocationStore', () => {
  let fake: FakeGeolocation;

  function create(): LocationStore {
    TestBed.configureTestingModule({
      providers: [provideFakeGeolocation(fake)],
    });
    return TestBed.inject(LocationStore);
  }

  beforeEach(() => {
    fake = new FakeGeolocation();
  });

  it('is idle and asks nothing until started', () => {
    const store = create();
    expect(store.status()).toBe('idle');
    expect(store.fix()).toBeNull();
    expect(fake.starts).toBe(0);
  });

  it('searches, then becomes active with the first fix', () => {
    const store = create();
    store.start();
    expect(store.status()).toBe('searching');
    fake.emit({ accuracyMeters: 12, heading: 90 });
    expect(store.status()).toBe('active');
    expect(store.fix()).toEqual({
      position: [3.08, 45.78],
      accuracyMeters: 12,
      heading: 90,
    });
  });

  it('follows new fixes while active and watches only once', () => {
    const store = create();
    store.start();
    store.start();
    fake.emit();
    fake.emit({ position: [3.1, 45.8] });
    expect(fake.starts).toBe(1);
    expect(store.fix()?.position).toEqual([3.1, 45.8]);
  });

  it('forgets the position when stopped', () => {
    const store = create();
    store.start();
    fake.emit();
    store.stop();
    expect(fake.watching).toBe(false);
    expect(store.status()).toBe('idle');
    expect(store.fix()).toBeNull();
  });

  it('toggles between searching and idle', () => {
    const store = create();
    store.toggle();
    expect(store.watching()).toBe(true);
    store.toggle();
    expect(store.status()).toBe('idle');
  });

  it('reports a refusal and stops watching', () => {
    const store = create();
    store.start();
    fake.fail('denied');
    expect(store.status()).toBe('error');
    expect(store.errorCode()).toBe('denied');
    expect(fake.watching).toBe(false);
    // The user can try again.
    store.start();
    expect(store.status()).toBe('searching');
    expect(store.errorCode()).toBeNull();
  });

  it('reports a timeout before any fix, and recovers on the next fix', () => {
    const store = create();
    store.start();
    fake.fail('timeout');
    expect(store.errorCode()).toBe('timeout');
    expect(fake.watching).toBe(true);
    fake.emit();
    expect(store.status()).toBe('active');
    expect(store.errorCode()).toBeNull();
  });

  it('keeps the position through a hiccup after the first fix', () => {
    const store = create();
    store.start();
    fake.emit();
    fake.fail('unavailable');
    expect(store.status()).toBe('active');
    expect(store.fix()).not.toBeNull();
  });

  it('drops the position when permission is withdrawn later', () => {
    const store = create();
    store.start();
    fake.emit();
    fake.fail('denied');
    expect(store.status()).toBe('error');
    expect(store.fix()).toBeNull();
  });

  it('cannot start in an insecure context or without support', () => {
    fake.supported = 'insecure';
    const store = create();
    expect(store.available()).toBe(false);
    store.start();
    expect(store.status()).toBe('idle');
    expect(fake.starts).toBe(0);
  });
});
