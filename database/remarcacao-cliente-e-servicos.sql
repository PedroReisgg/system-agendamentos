-- Execute uma vez no SQL Editor do Supabase, após as migrações anteriores.
-- Preserva o histórico: serviços usados em agendamentos nunca são apagados.

drop policy if exists "equipe atualiza servicos" on public.servicos;
create policy "equipe atualiza servicos"
on public.servicos for update
using (public.eh_equipe_empresa(empresa_id))
with check (public.eh_equipe_empresa(empresa_id));

create or replace function public.horarios_disponiveis_remarcacao(
  p_agendamento_id uuid,
  p_data date
)
returns table(hora_inicio time,hora_fim time)
language sql security definer set search_path = public as $$
  with agendamento as (
    select a.id,a.cliente_id,a.profissional_id,a.servico_id,s.duracao_minutos,e.antecedencia_minima_minutos,e.horario_abertura,e.horario_fechamento
    from public.agendamentos a
    join public.servicos s on s.id=a.servico_id
    join public.empresas e on e.id=a.empresa_id
    where a.id=p_agendamento_id
      and a.cliente_id=(select id from public.usuarios where usuario_auth_id=auth.uid())
      and a.situacao in ('pendente','confirmado','remarcado')
  ), relogio as (
    select now() at time zone 'America/Sao_Paulo' as agora
  ), limite as (
    select date_trunc('hour',agora+a.antecedencia_minima_minutos*interval '1 minute')
      + ceil(extract(minute from agora+a.antecedencia_minima_minutos*interval '1 minute')/30.0)*interval '30 minutes' as proximo_horario
    from relogio cross join agendamento a
  ), horarios as (
    select intervalo::time hora_inicio,(intervalo+a.duracao_minutos*interval '1 minute')::time hora_fim
    from agendamento a
    join public.horarios_trabalho ht on ht.profissional_id=a.profissional_id and ht.dia_semana=extract(dow from p_data)
    cross join lateral generate_series(
      greatest(p_data+ht.hora_inicio,p_data+a.horario_abertura),
      least(p_data+ht.hora_fim,p_data+a.horario_fechamento)-a.duracao_minutos*interval '1 minute',
      interval '30 minutes'
    ) intervalo
  )
  select h.hora_inicio,h.hora_fim
  from horarios h cross join agendamento alvo cross join relogio cross join limite
  where p_data>=relogio.agora::date
    and (p_data+h.hora_inicio)>=limite.proximo_horario
    and not exists (
      select 1 from public.agendamentos ocupado
      where ocupado.profissional_id=alvo.profissional_id
        and ocupado.data_agendamento=p_data
        and ocupado.id<>alvo.id
        and ocupado.situacao in ('pendente','confirmado','remarcado')
        and ocupado.hora_inicio<h.hora_fim
        and ocupado.hora_fim>h.hora_inicio
    )
  order by h.hora_inicio;
$$;

create or replace function public.remarcar_agendamento_cliente(
  p_agendamento_id uuid,
  p_data date,
  p_hora_inicio time
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_cliente uuid;
  v_profissional uuid;
  v_servico uuid;
  v_duracao smallint;
  v_hora_fim time;
begin
  select id into v_cliente from public.usuarios where usuario_auth_id=auth.uid() and papel='cliente';
  if v_cliente is null then raise exception 'Cliente não autenticado'; end if;
  select a.profissional_id,a.servico_id,s.duracao_minutos into v_profissional,v_servico,v_duracao
  from public.agendamentos a join public.servicos s on s.id=a.servico_id
  where a.id=p_agendamento_id and a.cliente_id=v_cliente and a.situacao in ('pendente','confirmado','remarcado');
  if v_profissional is null then raise exception 'Agendamento não encontrado ou não pode ser alterado'; end if;
  if not exists(select 1 from public.horarios_disponiveis_remarcacao(p_agendamento_id,p_data) where hora_inicio=p_hora_inicio) then
    raise exception 'Horário indisponível';
  end if;
  v_hora_fim:=p_hora_inicio+v_duracao*interval '1 minute';
  update public.agendamentos
  set data_agendamento=p_data,hora_inicio=p_hora_inicio,hora_fim=v_hora_fim,situacao='remarcado'
  where id=p_agendamento_id and cliente_id=v_cliente;
  return p_agendamento_id;
end;
$$;

create or replace function public.cancelar_agendamento_cliente(p_agendamento_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_cliente uuid;
begin
  select id into v_cliente from public.usuarios where usuario_auth_id=auth.uid() and papel='cliente';
  if v_cliente is null then raise exception 'Cliente não autenticado'; end if;
  update public.agendamentos
  set situacao='cancelado'
  where id=p_agendamento_id
    and cliente_id=v_cliente
    and situacao in ('pendente','confirmado','remarcado')
    and (data_agendamento+hora_inicio)>(now() at time zone 'America/Sao_Paulo');
  if not found then raise exception 'Agendamento não encontrado ou não pode ser cancelado'; end if;
  return p_agendamento_id;
end;
$$;

grant execute on function public.horarios_disponiveis_remarcacao(uuid,date) to authenticated;
grant execute on function public.remarcar_agendamento_cliente(uuid,date,time) to authenticated;
grant execute on function public.cancelar_agendamento_cliente(uuid) to authenticated;
