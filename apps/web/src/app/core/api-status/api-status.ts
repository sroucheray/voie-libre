import { Component, OnInit, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { HealthService } from '../api/health.service';

@Component({
  selector: 'vl-api-status',
  imports: [TranslocoPipe],
  templateUrl: './api-status.html',
  styleUrl: './api-status.scss',
})
export class ApiStatus implements OnInit {
  protected readonly health = inject(HealthService);

  ngOnInit(): void {
    void this.health.check();
  }
}
