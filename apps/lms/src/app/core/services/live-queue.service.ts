import { Injectable } from '@angular/core';
import { Observable, Subject, fromEvent, merge } from 'rxjs';
import { debounceTime, filter, map } from 'rxjs/operators';

/**
 * Push-to-invalidate bus for the work queues. The server broadcasts a tiny
 * "QueueChanged {area}" over the existing chat/notification SignalR pipe
 * whenever a queue-touching mutation lands (order created, sample received,
 * result validated, consult created…). ChatService forwards those here; queue
 * screens subscribe to their area and simply REFETCH their normal endpoint.
 *
 * No polling anywhere: zero requests while nothing changes, one debounced
 * refetch per change-burst when something does. Tab-focus re-sync is folded
 * in so a backgrounded screen catches up the moment it's looked at.
 */
@Injectable({ providedIn: 'root' })
export class LiveQueueService {
  private readonly bus = new Subject<string>();

  /** Called by ChatService when the socket delivers a QueueChanged event. */
  push(area: string) {
    if (area) this.bus.next(area);
  }

  /** Emissions for the given areas, burst-debounced — subscribe and refetch.
   *  Includes a tab-visibility re-sync (catches changes missed while hidden
   *  or during a silent socket drop). */
  on(...areas: string[]): Observable<string> {
    const changes$ = this.bus.pipe(filter(a => areas.includes(a)));
    const visible$ = fromEvent(document, 'visibilitychange').pipe(
      filter(() => document.visibilityState === 'visible'),
      map(() => 'visibility'),
    );
    return merge(changes$, visible$).pipe(debounceTime(1200));
  }
}
