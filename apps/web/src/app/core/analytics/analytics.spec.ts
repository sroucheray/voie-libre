import { TestBed } from '@angular/core/testing';
import { API_CLIENT } from '../api/api-client';
import { LanguageService } from '../i18n/language.service';
import {
  ANALYTICS_ENABLED,
  ANALYTICS_OFF_KEY,
  Analytics,
  deviceClass,
} from './analytics';

describe('Analytics', () => {
  const post = vi.fn().mockResolvedValue({});

  function setup(enabled = true) {
    TestBed.configureTestingModule({
      providers: [
        { provide: ANALYTICS_ENABLED, useValue: enabled },
        { provide: API_CLIENT, useValue: { POST: post } },
        { provide: LanguageService, useValue: { current: () => 'fr' } },
      ],
    });
    return TestBed.inject(Analytics);
  }

  beforeEach(() => {
    post.mockClear();
    localStorage.clear();
    Object.defineProperty(navigator, 'doNotTrack', {
      value: null,
      configurable: true,
    });
  });

  it('sends a visit with the language and the device class, nothing else', () => {
    setup().report({ event: 'visit' });
    expect(post).toHaveBeenCalledWith('/stats', {
      body: {
        event: 'visit',
        language: 'fr',
        device: deviceClass(window.innerWidth),
      },
    });
  });

  it('sends a route as numbers only', () => {
    const event = {
      event: 'route' as const,
      profile: 'gravel' as const,
      kilometers: 42,
      points: 4,
      stops: 2,
    };
    setup().report(event);
    expect(post).toHaveBeenCalledWith('/stats', { body: event });
  });

  it('is silent when disabled, as in development', () => {
    setup(false).report({ event: 'save' });
    expect(post).not.toHaveBeenCalled();
  });

  it('is silent once the visitor refused, and remembers it on the device', () => {
    const analytics = setup();
    analytics.setOff(true);
    analytics.report({ event: 'save' });
    expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem(ANALYTICS_OFF_KEY)).toBe('1');
    analytics.setOff(false);
    expect(localStorage.getItem(ANALYTICS_OFF_KEY)).toBeNull();
  });

  it('reads a refusal stored earlier', () => {
    localStorage.setItem(ANALYTICS_OFF_KEY, '1');
    expect(setup().off()).toBe(true);
  });

  it('respects Do Not Track', () => {
    Object.defineProperty(navigator, 'doNotTrack', {
      value: '1',
      configurable: true,
    });
    setup().report({ event: 'save' });
    expect(post).not.toHaveBeenCalled();
  });

  it('classes the device by window width', () => {
    expect(deviceClass(390)).toBe('phone');
    expect(deviceClass(820)).toBe('tablet');
    expect(deviceClass(1440)).toBe('desktop');
  });
});
