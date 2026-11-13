import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { bad, conflict } from '../common/errors.js';
import { rows } from '../database/database.js';
import { calendarPreview, type CalendarBlock, type Window } from './rules.js';

export function checkedWindow(startsAt: Date, endsAt: Date): Window {
  if (endsAt <= startsAt) bad('Окончание окна должно быть позже начала.');
  return { startsAt, endsAt };
}

@Injectable()
export class ReleaseCalendar {
  async preview(db: EntityManager, systemId: string, window: Window, lock = false) {
    if (lock) {
      await db.query(
        `
        SELECT r.id FROM resources r JOIN system_resources sr ON sr.resource_id = r.id
        WHERE sr.system_id = $1 ORDER BY r.id FOR UPDATE OF r
      `,
        [systemId],
      );
    }
    const blocks = await rows<CalendarBlock>(
      db,
      `
      SELECT c.starts_at AS "startsAt", c.ends_at AS "endsAt", r.name AS resource, c.description
      FROM calendar_blocks c JOIN resources r ON r.id=c.resource_id
      JOIN system_resources sr ON sr.resource_id=c.resource_id
      WHERE sr.system_id=$1 AND c.ends_at>$2 AND c.starts_at<$3
      ORDER BY c.starts_at, r.name, c.id
    `,
      [systemId, window.startsAt, new Date(window.endsAt.getTime() + 48 * 3_600_000)],
    );
    return calendarPreview(window, blocks);
  }

  async check(db: EntityManager, systemId: string, window: Window) {
    const result = await this.preview(db, systemId, window, true);
    if (result.conflicts.length)
      conflict('WINDOW_CONFLICT', 'Окно пересекается с работами в календаре.', result);
  }
}
