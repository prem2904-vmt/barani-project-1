/**
 * @deprecated Renamed — the work-queue bus is {@link WorkEventsService}
 * (typed WorkEvents on /hubs/work, branch-scoped). This alias keeps older
 * imports and spec providers (`{ provide: LiveQueueService, … }`) pointing at
 * the SAME DI token.
 */
export { WorkEventsService as LiveQueueService } from './work-events.service';
