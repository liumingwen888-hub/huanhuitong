REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO xht_flyway;
GRANT USAGE, CREATE ON SCHEMA public TO xht_flyway;
GRANT USAGE ON SCHEMA public TO xht_platform, xht_worker;

DO $$
BEGIN
  EXECUTE format(
    'REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC',
    current_database()
  );
END
$$;
