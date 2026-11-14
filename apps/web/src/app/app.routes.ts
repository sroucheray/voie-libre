import { Route } from '@angular/router';
import { SharedRoutePage } from './sharing/shared-route-page';

export const appRoutes: Route[] = [
  // A link shared by a user: the route is read from the API and shown on the map.
  { path: 'p/:id', component: SharedRoutePage },
  // A link that carries the route in its fragment: read on the device, nothing stored.
  { path: '**', redirectTo: '' },
];
