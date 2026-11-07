import { Component, OnInit, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { HealthService } from '../api/health.service';

@Component({
  selector: 'vl-api-status',
  imports: [TranslocoPipe],
  templateUrl: './api-status.html',
})
export class ApiStatus implements OnInit {
  protected readonly health = inject(HealthService);

  ngOnInit(): void {
    void this.health.check();
  }
}
