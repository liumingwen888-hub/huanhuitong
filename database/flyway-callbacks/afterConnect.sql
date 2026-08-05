SET ROLE xht_flyway;

DO $$
BEGIN
  IF current_user <> 'xht_flyway' THEN
    RAISE EXCEPTION 'FLYWAY_ROLE_MISMATCH';
  END IF;
END
$$;
