import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SprintPlanning1794541200000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.query(`
      CREATE TABLE epics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        system_id uuid NOT NULL REFERENCES systems(id),
        title varchar(160) NOT NULL, goal varchar(500) NOT NULL,
        created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, system_id)
      );
      CREATE TABLE sprints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL, goal varchar(500) NOT NULL,
        starts_on date NOT NULL, ends_on date NOT NULL,
        state text NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED','ACTIVE','CLOSED')),
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz, closed_at timestamptz,
        CHECK (starts_on <= ends_on),
        CHECK ((state <> 'PLANNED') = (started_at IS NOT NULL)),
        CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX sprints_one_active ON sprints(state) WHERE state='ACTIVE';
      ALTER TABLE work_items
        ADD COLUMN type text NOT NULL DEFAULT 'TASK' CHECK (type IN ('TASK','STORY','BUG')),
        ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH','NORMAL','LOW')),
        ADD COLUMN epic_id uuid,
        ADD FOREIGN KEY (epic_id, system_id) REFERENCES epics(id, system_id),
        ADD COLUMN sprint_id uuid REFERENCES sprints(id);
      CREATE INDEX work_items_epic ON work_items(epic_id);
      CREATE INDEX work_items_sprint ON work_items(sprint_id);
      CREATE TABLE sprint_results (
        sprint_id uuid REFERENCES sprints(id), work_item_id uuid REFERENCES work_items(id),
        status_at_close text NOT NULL CHECK (status_at_close IN ('TO_DO','IN_PROGRESS','IN_TEST','READY')),
        destination_sprint_id uuid REFERENCES sprints(id),
        PRIMARY KEY (sprint_id, work_item_id)
      );
      ALTER TABLE work_item_events
        DROP CONSTRAINT work_item_events_kind_check,
        ADD CHECK (kind IN ('STATUS','CREATED','ASSIGNMENT','REVIEW_CLAIMED','SPRINT_CHANGED')),
        ADD COLUMN from_sprint_id uuid REFERENCES sprints(id),
        ADD COLUMN to_sprint_id uuid REFERENCES sprints(id);
    `);
  }

  async down(db: QueryRunner): Promise<void> {
    await db.query(`
      DELETE FROM work_item_events WHERE kind='SPRINT_CHANGED';
      ALTER TABLE work_item_events
        DROP CONSTRAINT work_item_events_kind_check,
        ADD CHECK (kind IN ('STATUS','CREATED','ASSIGNMENT','REVIEW_CLAIMED')),
        DROP COLUMN from_sprint_id, DROP COLUMN to_sprint_id;
      ALTER TABLE work_items DROP COLUMN epic_id, DROP COLUMN sprint_id, DROP COLUMN type, DROP COLUMN priority;
      DROP TABLE sprint_results, sprints, epics;
    `);
  }
}
