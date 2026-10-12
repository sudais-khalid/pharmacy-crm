-- Hand-written: Prisma stores DateTime values as UTC in "timestamp without time zone" columns, while
-- DEFAULT CURRENT_TIMESTAMP and now() follow the session time zone. Pin the database to UTC so database
-- defaults and application values always agree, whatever the server's local time zone is (for example
-- an embedded PostgreSQL on a pharmacy PC set to Asia/Karachi). Applies to new connections.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;
