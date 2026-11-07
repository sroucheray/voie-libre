import { Injectable, inject, signal } from '@angular/core';
import { API_CLIENT } from './api-client';

/** `unreachable` means the API did not answer at all; `degraded` means it answered 503. */
export type ApiStatus = 'checking' | 'ok' | 'degraded' | 'unreachable';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly client = inject(API_CLIENT);
  private readonly state = signal<ApiStatus>('checking');
  readonly status = this.state.asReadonly();

  async check(): Promise<void> {
    this.state.set('checking');
    try {
      const { data, response } = await this.client.GET('/health');
      this.state.set(
        data
          ? data.status
          : response.status === 503
            ? 'degraded'
            : 'unreachable',
      );
    } catch {
      this.state.set('unreachable');
    }
  }
}
