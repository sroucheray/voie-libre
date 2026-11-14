import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { API_CLIENT } from '../core/api/api-client';
import type { PlannedRoute, Profile } from '../planner/planner-store';
import type { LngLat } from '../core/map/map-factory';
import type { SavedRoute, ShareInfo } from '../storage/saved-route';

/** Why a sharing operation failed; the UI translates these under `sharing.errors.*`. */
export type ShareErrorCode =
  | 'network'
  | 'rate_limited'
  | 'payload_too_large'
  | 'already_exists'
  | 'invalid_request'
  | 'forbidden'
  | 'not_found'
  | 'unknown';

export class ShareError extends Error {
  constructor(readonly code: ShareErrorCode) {
    super(`Sharing failed: ${code}`);
    this.name = 'ShareError';
  }
}

const API_CODES: readonly ShareErrorCode[] = [
  'invalid_request',
  'not_found',
  'already_exists',
  'forbidden',
  'payload_too_large',
];

/** Maps an HTTP status and an error body to a code the UI translates. */
export function shareErrorFrom(status: number, body: unknown): ShareErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 413) return 'payload_too_large';
  // The service worker answers 504 for a request the network could not carry (offline).
  if (status === 504) return 'network';
  const code = (body as { code?: unknown } | undefined)?.code;
  return API_CODES.find((known) => known === code) ?? 'unknown';
}

/** A route read from a shared link. */
export interface SharedRoute extends PlannedRoute {
  id: string;
  name: string;
  profile: Profile;
  points: LngLat[];
  createdAt: number;
  sharedAt: number;
  expiresAt: number;
}

/** How long a short link is kept (the server turns these into a day, 7 days and 30 days). */
export const LIFETIMES = ['day', 'week', 'month'] as const;
export type Lifetime = (typeof LIFETIMES)[number];

/** The short link is still served: it has a copy on the server whose time is not up. */
export function activeShare(
  route: Pick<SavedRoute, 'share'>,
  now = Date.now(),
): ShareInfo | null {
  const share = route.share;
  return share && share.expiresAt > now ? share : null;
}

/**
 * Short links, kept on the server for a time the person chooses: `PUT /p/{id}` under the id of the
 * saved route, `GET` to open a link, `DELETE` with the secret token returned at creation. A shared
 * route is a snapshot: it never follows later changes of the local one, and it is removed when
 * its time is up.
 */

@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly client = inject(API_CLIENT);
  private readonly document = inject(DOCUMENT);

  /** The address anyone can open, on this web app. */
  linkFor(id: string): string {
    return new URL(`p/${id}`, this.document.baseURI).href;
  }

  /** Sends the route and returns what must be kept to stop sharing it. */
  async share(route: SavedRoute, lifetime: Lifetime): Promise<ShareInfo> {
    const { data, error, response } = await this.call(() =>
      this.client.PUT('/p/{id}', {
        params: { path: { id: route.id } },
        body: {
          name: route.name,
          profile: route.profile,
          points: route.points,
          geometry: route.geometry,
          distanceMeters: route.distanceMeters,
          ascentMeters: route.ascentMeters ?? 0,
          durationSeconds: route.durationSeconds,
          createdAt: route.createdAt,
          lifetime,
        },
      }),
    );
    if (!data) throw new ShareError(shareErrorFrom(response.status, error));
    return {
      deleteToken: data.deleteToken,
      sharedAt: Date.now(),
      expiresAt: data.expiresAt,
    };
  }

  /** Removes the shared copy. A copy that is already gone counts as removed. */
  async unshare(route: SavedRoute): Promise<void> {
    if (!route.share) return;
    const { error, response } = await this.call(() =>
      this.client.DELETE('/p/{id}', {
        params: { path: { id: route.id } },
        headers: { authorization: `Bearer ${route.share?.deleteToken}` },
      }),
    );
    if (response.ok || response.status === 404) return;
    throw new ShareError(shareErrorFrom(response.status, error));
  }

  async fetch(id: string): Promise<SharedRoute> {
    const { data, error, response } = await this.call(() =>
      this.client.GET('/p/{id}', { params: { path: { id } } }),
    );
    if (!data) throw new ShareError(shareErrorFrom(response.status, error));
    // The compiler widens generated tuple types: restore them.
    return data as unknown as SharedRoute;
  }

  /** A request that never got an answer is a network failure. */
  private async call<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch {
      throw new ShareError('network');
    }
  }
}
