const LOCAL_DEVELOPMENT_DATABASE_URL =
  'postgresql://factory-user@localhost:5432/gitatlas_dev?host=%2Frun%2Fpostgresql';

export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const configuredUrl = env.GITATLAS_DATABASE_URL || env.DATABASE_URL;

  if (
    configuredUrl?.startsWith('postgresql://') ||
    configuredUrl?.startsWith('postgres://')
  ) {
    return configuredUrl;
  }

  if (configuredUrl && !configuredUrl.startsWith('file:')) {
    throw new Error('GitAtlas requires a PostgreSQL database URL.');
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'A PostgreSQL DATABASE_URL or GITATLAS_DATABASE_URL must be configured in production.',
    );
  }

  if (configuredUrl?.startsWith('file:') || !configuredUrl) {
    return LOCAL_DEVELOPMENT_DATABASE_URL;
  }

  throw new Error('GitAtlas requires a PostgreSQL database URL.');
}
