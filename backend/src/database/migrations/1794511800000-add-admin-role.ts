import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminRole1794511800000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.query(`
      ALTER TABLE users DROP CONSTRAINT users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('ENGINEER','OWNER','OPERATIONS','DUTY','QA','ADMIN'));
    `);
  }

  async down(db: QueryRunner): Promise<void> {
    await db.query(`
      UPDATE users SET role = 'ENGINEER' WHERE role = 'ADMIN';
      ALTER TABLE users DROP CONSTRAINT users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('ENGINEER','OWNER','OPERATIONS','DUTY','QA'));
    `);
  }
}
