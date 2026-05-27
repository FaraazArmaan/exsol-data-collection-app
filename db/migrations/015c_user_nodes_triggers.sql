CREATE TRIGGER user_nodes_validate_trig
  BEFORE INSERT OR UPDATE ON public.user_nodes
  FOR EACH ROW EXECUTE FUNCTION public.user_nodes_validate();

CREATE TRIGGER user_nodes_set_updated_at
  BEFORE UPDATE ON public.user_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
