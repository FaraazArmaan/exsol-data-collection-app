CREATE TRIGGER admins_set_updated_at
  BEFORE UPDATE ON public.admins
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
