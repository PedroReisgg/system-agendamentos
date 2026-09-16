-- Execute APÓS migracao_ptbr.sql no SQL Editor do Supabase.
-- Permissões reais para painel administrativo e painel profissional.

alter table public.agendamentos add column if not exists observacao text;

create or replace function public.eh_gestor_empresa(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios
    where usuario_auth_id = auth.uid()
      and empresa_id = p_empresa_id
      and (papel in ('administrador','caixa') or nivel_acesso = 'gestor')
  );
$$;

create or replace function public.eh_profissional_atual(p_profissional_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profissionais p
    join public.usuarios u on u.id = p.usuario_id
    where p.id = p_profissional_id and u.usuario_auth_id = auth.uid()
  );
$$;

create or replace function public.eh_equipe_empresa(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios
    where usuario_auth_id = auth.uid()
      and empresa_id = p_empresa_id
      and papel in ('administrador','caixa','profissional')
  );
$$;

alter table public.usuarios enable row level security;
alter table public.profissionais enable row level security;
alter table public.profissionais_servicos enable row level security;
alter table public.servicos enable row level security;
alter table public.agendamentos enable row level security;

drop policy if exists "gestor le usuarios da empresa" on public.usuarios;
drop policy if exists "gestor altera usuarios da empresa" on public.usuarios;
drop policy if exists "equipe le clientes da empresa" on public.usuarios;
create policy "gestor le usuarios da empresa" on public.usuarios for select using (public.eh_gestor_empresa(empresa_id));
create policy "gestor altera usuarios da empresa" on public.usuarios for update using (public.eh_gestor_empresa(empresa_id)) with check (public.eh_gestor_empresa(empresa_id));
create policy "equipe le clientes da empresa" on public.usuarios for select using (papel = 'cliente' and public.eh_equipe_empresa(empresa_id));

drop policy if exists "publico le profissionais ativos" on public.profissionais;
drop policy if exists "gestor le profissionais da empresa" on public.profissionais;
drop policy if exists "profissional le proprio perfil" on public.profissionais;
create policy "publico le profissionais ativos" on public.profissionais for select using (ativo = true);
create policy "gestor le profissionais da empresa" on public.profissionais for select using (public.eh_gestor_empresa(empresa_id));
create policy "profissional le proprio perfil" on public.profissionais for select using (public.eh_profissional_atual(id));

drop policy if exists "publico le servicos ativos" on public.servicos;
create policy "publico le servicos ativos" on public.servicos for select using (ativo = true);

drop policy if exists "publico le relacoes de servicos" on public.profissionais_servicos;
drop policy if exists "profissional gerencia proprios servicos" on public.profissionais_servicos;
drop policy if exists "gestor gerencia servicos da equipe" on public.profissionais_servicos;
create policy "publico le relacoes de servicos" on public.profissionais_servicos for select using (true);
create policy "profissional gerencia proprios servicos" on public.profissionais_servicos for all using (public.eh_profissional_atual(profissional_id)) with check (public.eh_profissional_atual(profissional_id));
create policy "gestor gerencia servicos da equipe" on public.profissionais_servicos for all using (exists(select 1 from public.profissionais p where p.id=profissional_id and public.eh_gestor_empresa(p.empresa_id))) with check (exists(select 1 from public.profissionais p where p.id=profissional_id and public.eh_gestor_empresa(p.empresa_id)));

drop policy if exists "gestor le agendamentos da empresa" on public.agendamentos;
drop policy if exists "profissional le propria agenda" on public.agendamentos;
drop policy if exists "gestor cria agendamentos" on public.agendamentos;
drop policy if exists "profissional cria na propria agenda" on public.agendamentos;
drop policy if exists "gestor altera agendamentos" on public.agendamentos;
drop policy if exists "profissional altera propria agenda futura" on public.agendamentos;
drop policy if exists "gestor exclui agendamentos" on public.agendamentos;
create policy "gestor le agendamentos da empresa" on public.agendamentos for select using (public.eh_gestor_empresa(empresa_id));
create policy "profissional le propria agenda" on public.agendamentos for select using (public.eh_profissional_atual(profissional_id));
create policy "gestor cria agendamentos" on public.agendamentos for insert with check (public.eh_gestor_empresa(empresa_id));
create policy "profissional cria na propria agenda" on public.agendamentos for insert with check (public.eh_profissional_atual(profissional_id));
create policy "gestor altera agendamentos" on public.agendamentos for update using (public.eh_gestor_empresa(empresa_id)) with check (public.eh_gestor_empresa(empresa_id));
create policy "profissional altera propria agenda futura" on public.agendamentos for update using (public.eh_profissional_atual(profissional_id) and data_agendamento >= current_date) with check (public.eh_profissional_atual(profissional_id) and data_agendamento >= current_date);
create policy "gestor exclui agendamentos" on public.agendamentos for delete using (public.eh_gestor_empresa(empresa_id));

create or replace function public.horarios_disponiveis(p_profissional_id uuid,p_servico_id uuid,p_data date)
returns table(hora_inicio time,hora_fim time)
language sql security definer set search_path = public as $$
  with configuracao as (
    select s.duracao_minutos,e.antecedencia_minima_minutos
    from public.servicos s
    join public.profissionais p on p.id=p_profissional_id
    join public.empresas e on e.id=p.empresa_id
    where s.id=p_servico_id and s.empresa_id=p.empresa_id and s.ativo and p.ativo
  ), horarios as (
    select intervalo::time hora_inicio,(intervalo+(select duracao_minutos from configuracao)*interval '1 minute')::time hora_fim
    from public.horarios_trabalho ht,lateral generate_series(p_data+ht.hora_inicio,p_data+ht.hora_fim-(select duracao_minutos from configuracao)*interval '1 minute',interval '30 minutes') intervalo
    where ht.profissional_id=p_profissional_id and ht.dia_semana=extract(dow from p_data)
  )
  select h.hora_inicio,h.hora_fim from horarios h
  where p_data >= (now() at time zone 'America/Sao_Paulo')::date
    and (p_data > (now() at time zone 'America/Sao_Paulo')::date or h.hora_inicio >= date_trunc('hour',now() at time zone 'America/Sao_Paulo'+(select antecedencia_minima_minutos from configuracao)*interval '1 minute')::time)
    and not exists(select 1 from public.agendamentos a where a.profissional_id=p_profissional_id and a.data_agendamento=p_data and a.situacao in ('pendente','confirmado','remarcado') and a.hora_inicio<h.hora_fim and a.hora_fim>h.hora_inicio)
  order by h.hora_inicio;
$$;

create or replace function public.reservar_agendamento(p_profissional_id uuid,p_servico_id uuid,p_data date,p_hora_inicio time,p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cliente uuid;v_empresa uuid;v_duracao smallint;v_hora_fim time;v_id uuid:=gen_random_uuid();
begin
  select id,empresa_id into v_cliente,v_empresa from public.usuarios where usuario_auth_id=auth.uid() and papel='cliente';
  if v_cliente is null then raise exception 'Cliente não autenticado'; end if;
  select s.duracao_minutos into v_duracao from public.servicos s join public.profissionais_servicos ps on ps.servico_id=s.id where s.id=p_servico_id and ps.profissional_id=p_profissional_id and s.empresa_id=v_empresa;
  if v_duracao is null then raise exception 'Serviço inválido para este profissional'; end if;
  if not exists(select 1 from public.horarios_disponiveis(p_profissional_id,p_servico_id,p_data) where hora_inicio=p_hora_inicio) then raise exception 'Horário indisponível'; end if;
  v_hora_fim:=p_hora_inicio+v_duracao*interval '1 minute';
  insert into public.agendamentos(id,empresa_id,cliente_id,profissional_id,servico_id,data_agendamento,hora_inicio,hora_fim,situacao,observacao) values(v_id,v_empresa,v_cliente,p_profissional_id,p_servico_id,p_data,p_hora_inicio,v_hora_fim,'pendente',nullif(trim(p_observacao),''));
  return v_id;
end;$$;

grant execute on function public.horarios_disponiveis(uuid,uuid,date) to anon,authenticated;
grant execute on function public.reservar_agendamento(uuid,uuid,date,time,text) to authenticated;
