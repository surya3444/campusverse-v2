-- Writers that don't name a profile yet (onboarding, seeds) get the one their type implies:
-- a college defaults to affiliated (rule book §12.3).
CREATE FUNCTION institution_profile_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.profile IS NULL THEN
    NEW.profile := CASE NEW.type WHEN 'college' THEN 'affiliated_college' ELSE NEW.type END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profile_default BEFORE INSERT ON institution
  FOR EACH ROW EXECUTE FUNCTION institution_profile_default();
