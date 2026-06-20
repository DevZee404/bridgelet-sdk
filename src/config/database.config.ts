import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { dirname } from 'path';
import { DataSource } from 'typeorm';
import { fileURLToPath } from 'url';

export default registerAs(
  'database',
  (): { database: TypeOrmModuleOptions } => ({
    database: {
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      username: process.env.DATABASE_USER || 'bridgelet_user',
      password: process.env.DATABASE_PASSWORD || 'bridgelet_pass',
      database: process.env.DATABASE_NAME || 'bridgelet',
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      synchronize: process.env.DATABASE_SYNC === 'true',
      autoLoadEntities: true,
      logging: process.env.DATABASE_LOGGING === 'true',
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
    },
  }),
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER || 'bridgelet_user',
  password: process.env.DATABASE_PASSWORD || 'bridgelet_pass',
  database: process.env.DATABASE_NAME || 'bridgelet',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
});
