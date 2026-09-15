-- Permite que o agendamento exiba somente o nome dos profissionais ativos.
-- Execute uma vez no SQL Editor do Supabase.
create policy "public reads professional profiles"
on public.users for select
to anon, authenticated
using (role = 'professional');
