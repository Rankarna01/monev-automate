import mysql from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import type { Logger } from '../utils/logger.js';

export interface DatabaseConnection {
  pool: mysql.Pool;
  close: () => Promise<void>;
}

/**
 * Membuat database jika belum ada, membuka pool koneksi MySQL,
 * dan menjalankan migrasi tabel `settings` serta `reports`.
 */
export async function initDatabase(
  config: AppConfig,
  logger: Logger,
): Promise<DatabaseConnection> {
  const bootstrapConn = await mysql.createConnection({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
  });

  try {
    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await bootstrapConn.end();
  }

  const pool = mysql.createPool({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: '+07:00',
  });

  await runMigrations(pool);
  logger.info(
    { host: config.MYSQL_HOST, port: config.MYSQL_PORT, database: config.MYSQL_DATABASE },
    'Database MySQL terhubung dan migrasi selesai',
  );

  return {
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

async function runMigrations(pool: mysql.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(100) NOT NULL PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date VARCHAR(10) NOT NULL UNIQUE,
      status VARCHAR(32) NOT NULL,
      commits_json LONGTEXT NULL,
      aktivitas TEXT NULL,
      pembelajaran TEXT NULL,
      kendala TEXT NULL,
      telegram_message_id BIGINT NULL,
      error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      submitted_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}
