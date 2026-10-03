import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { SiteSetupDraft } from '../shared/contracts';

export interface SiteDatabaseCredentials {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
}

export async function createDatabase(draft: SiteSetupDraft): Promise<SiteDatabaseCredentials> {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(draft.databaseName)) {
    throw new Error('Database name is invalid. Use letters, numbers, and underscores.');
  }
  const connection = await mysql.createConnection({
    host: draft.dbHost,
    port: draft.dbPort,
    user: draft.dbAdminUser,
    password: draft.dbAdminPassword,
    connectTimeout: 5_000,
    multipleStatements: false,
  });
  const username = `site_${draft.siteName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 17)}_${randomBytes(4).toString('hex')}`.slice(0, 32);
  const password = randomBytes(32).toString('base64url');
  const accountHost = draft.dbHost === 'localhost' ? 'localhost' : draft.dbHost;
  try {
    await connection.query(`CREATE DATABASE \`${draft.databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`CREATE USER '${username}'@'${accountHost}' IDENTIFIED BY ?`, [password]);
    await connection.query(`GRANT ALL PRIVILEGES ON \`${draft.databaseName}\`.* TO '${username}'@'${accountHost}'`);
    return { host: draft.dbHost, port: draft.dbPort, databaseName: draft.databaseName, username, password };
  } finally {
    await connection.end();
  }
}
