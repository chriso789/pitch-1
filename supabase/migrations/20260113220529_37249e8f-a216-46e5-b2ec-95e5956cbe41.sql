-- Grant USAGE on crew schema so storage policies don't fail when evaluating
GRANT USAGE ON SCHEMA crew TO authenticated;

-- Grant EXECUTE on the specific functions used in storage policies
GRANT EXECUTE ON FUNCTION crew.my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION crew.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crew.storage_company_id_from_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION crew.storage_sub_user_id_from_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION crew.is_assigned_to_job(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crew.storage_job_id_from_name(text) TO authenticated;