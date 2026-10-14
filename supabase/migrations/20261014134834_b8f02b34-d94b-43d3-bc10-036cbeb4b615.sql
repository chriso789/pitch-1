ALTER VIEW public.roof_perimeter_candidates SET (security_invoker = on);
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    LEFT JOIN pg_depend d ON d.objid=p.oid AND d.deptype='e'
    WHERE s.nspname='public' AND p.prosecdef AND p.prorettype='trigger'::regtype AND d.objid IS NULL
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;