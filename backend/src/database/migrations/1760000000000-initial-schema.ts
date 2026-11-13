import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1760000000000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        login text UNIQUE NOT NULL, password_hash text NOT NULL, display_name text NOT NULL,
        role text NOT NULL CHECK (role IN ('ENGINEER','OWNER','OPERATIONS','DUTY','QA'))
      );
      CREATE TABLE sessions (
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE systems (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL,
        owner_id uuid NOT NULL REFERENCES users(id), operations_id uuid NOT NULL REFERENCES users(id),
        duty_id uuid NOT NULL REFERENCES users(id)
      );
      CREATE TABLE resources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL
      );
      CREATE TABLE system_resources (
        system_id uuid REFERENCES systems(id), resource_id uuid REFERENCES resources(id),
        PRIMARY KEY (system_id, resource_id)
      );
      CREATE TABLE calendar_blocks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES resources(id),
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
        kind text NOT NULL, description text NOT NULL,
        UNIQUE (resource_id, starts_at, ends_at, kind)
      );
      CREATE INDEX calendar_blocks_resource_time ON calendar_blocks(resource_id, starts_at, ends_at);
      CREATE SEQUENCE work_item_number START 160;
      CREATE TABLE work_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text UNIQUE NOT NULL DEFAULT ('OKNO-' || nextval('work_item_number')),
        system_id uuid NOT NULL REFERENCES systems(id), title text NOT NULL, description text,
        assignee_id uuid REFERENCES users(id), required_item_id uuid REFERENCES work_items(id),
        status text NOT NULL DEFAULT 'TO_DO' CHECK (status IN ('TO_DO','IN_PROGRESS','IN_TEST','READY')),
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (status = 'TO_DO' OR assignee_id IS NOT NULL), CHECK (id <> required_item_id)
      );
      CREATE INDEX work_items_system_status ON work_items(system_id, status);
      CREATE TABLE work_item_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES work_items(id),
        actor_id uuid NOT NULL REFERENCES users(id), from_status text NOT NULL, to_status text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX work_item_events_history ON work_item_events(item_id, occurred_at);
      CREATE SEQUENCE release_number START 24;
      CREATE TABLE release_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text UNIQUE NOT NULL DEFAULT ('REL-' || nextval('release_number')),
        author_id uuid NOT NULL REFERENCES users(id), system_id uuid REFERENCES systems(id),
        title text, rollback_plan text, starts_at timestamptz, ends_at timestamptz,
        gitlab_tag_url text, gitlab_release_url text,
        status text NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED','DEPLOYED')),
        deployed_at timestamptz, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        template_version integer, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((status = 'DEPLOYED') = (deployed_at IS NOT NULL))
      );
      CREATE INDEX release_requests_author ON release_requests(author_id, updated_at DESC);
      CREATE TABLE release_request_items (
        request_id uuid REFERENCES release_requests(id), item_id uuid REFERENCES work_items(id),
        item_key text NOT NULL, item_title text NOT NULL,
        PRIMARY KEY (request_id, item_id)
      );
      CREATE INDEX release_request_items_by_item ON release_request_items(item_id, request_id);
      CREATE TABLE deployed_work_items (
        item_id uuid PRIMARY KEY REFERENCES work_items(id), request_id uuid NOT NULL REFERENCES release_requests(id)
      );
      CREATE TABLE approval_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES release_requests(id),
        assignee_id uuid NOT NULL REFERENCES users(id),
        stage text NOT NULL CHECK (stage IN ('OWNER','OPERATIONS','DUTY')),
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','APPROVED','RETURNED','CANCELLED')),
        checked_fields jsonb NOT NULL, comment text, created_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz, invalidated_at_revision integer
      );
      CREATE UNIQUE INDEX approval_tasks_one_active ON approval_tasks(request_id) WHERE status = 'ACTIVE';
      CREATE INDEX approval_tasks_by_assignee ON approval_tasks(assignee_id, status);
      CREATE TABLE release_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES release_requests(id),
        actor_id uuid NOT NULL REFERENCES users(id), revision integer NOT NULL,
        type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (request_id, revision)
      );
    `);
  }

  async down(db: QueryRunner): Promise<void> {
    await db.query(`
      DROP TABLE release_events, approval_tasks, deployed_work_items, release_request_items,
        release_requests, work_item_events, work_items, calendar_blocks, system_resources,
        resources, systems, sessions, users;
      DROP SEQUENCE release_number, work_item_number;
    `);
  }
}
