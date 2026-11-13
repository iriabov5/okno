import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskReviewer1794539200000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.query('ALTER TABLE work_items ADD COLUMN reviewer_id uuid REFERENCES users(id)');
    await db.query(
      "CREATE INDEX work_items_active_reviewer ON work_items(reviewer_id) WHERE status = 'IN_TEST'",
    );
  }

  async down(db: QueryRunner): Promise<void> {
    await db.query('DROP INDEX work_items_active_reviewer');
    await db.query('ALTER TABLE work_items DROP COLUMN reviewer_id');
  }
}
