import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskActivity1794540200000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.query(`
      ALTER TABLE work_item_events
        ALTER COLUMN actor_id DROP NOT NULL,
        ALTER COLUMN occurred_at SET DEFAULT clock_timestamp(),
        ADD COLUMN kind text NOT NULL DEFAULT 'STATUS'
          CHECK (kind IN ('STATUS', 'CREATED', 'ASSIGNMENT', 'REVIEW_CLAIMED')),
        ADD COLUMN previous_assignee_id uuid REFERENCES users(id),
        ADD COLUMN next_assignee_id uuid REFERENCES users(id);
      UPDATE work_item_events SET kind = 'REVIEW_CLAIMED'
        WHERE from_status = 'IN_TEST' AND to_status = 'IN_TEST';
      INSERT INTO work_item_events(item_id, kind, from_status, to_status, occurred_at)
        SELECT id, 'CREATED', 'TO_DO', 'TO_DO', created_at FROM work_items;
    `);
  }

  async down(db: QueryRunner): Promise<void> {
    await db.query(`
      DELETE FROM work_item_events WHERE kind IN ('CREATED', 'ASSIGNMENT');
      ALTER TABLE work_item_events
        ALTER COLUMN actor_id SET NOT NULL,
        ALTER COLUMN occurred_at SET DEFAULT now(),
        DROP COLUMN kind,
        DROP COLUMN previous_assignee_id,
        DROP COLUMN next_assignee_id;
    `);
  }
}
