import React,{useEffect,useState}from'react';
import {mascaraCep,mascaraCpf,mascaraTelefone,somenteDigitos,cpfValido}from'./brasil';
import {mensagemErro}from'./mensagens';
import './client-dashboard.css';
import './client-dashboard-extra.css';

const Icon=({children})=><span className="dash-icon" aria-hidden="true">{children}</span>;
const dataFormatada=v=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium'}).format(new Date(`${v}T12:00:00`));
const horario=v=>String(v||'').slice(0,5);

export default function ClientDashboard({supabase,usuario,onSair,onInicio,onAgendar,perfilInicial}){
 const[aba,setAba]=useState(perfilInicial?'perfil':'inicio');
 const[agendamentos,setAgendamentos]=useState([]);
 const[perfil,setPerfil]=useState(usuario),[form,setForm]=useState(usuario);
 const[aviso,setAviso]=useState(''),[tipoAviso,setTipoAviso]=useState('sucesso');
 const[salvando,setSalvando]=useState(false),[cepBuscando,setCepBuscando]=useState(false);
 const[editor,setEditor]=useState(null),[horariosEdicao,setHorariosEdicao]=useState([]),[carregandoHorarios,setCarregandoHorarios]=useState(false),[cancelamento,setCancelamento]=useState(null);
 const avisar=(texto,tipo='sucesso')=>{setTipoAviso(tipo);setAviso(texto)};
 const carregarAgendamentos=async()=>{
  if(!usuario?.id)return;
  const{data,error}=await supabase.from('agendamentos').select('id,data_agendamento,hora_inicio,situacao,observacao,profissional_id,servico_id,servicos(nome),profissionais(biografia,usuarios(nome))').eq('cliente_id',usuario.id).order('data_agendamento',{ascending:false});
  if(error)avisar(mensagemErro(error),'erro');else setAgendamentos(data||[]);
 };
 useEffect(()=>{setPerfil(usuario);setForm(usuario)},[usuario]);
 useEffect(()=>{carregarAgendamentos()},[supabase,usuario?.id]);
 useEffect(()=>{setAba(perfilInicial?'perfil':'inicio')},[perfilInicial]);
 const mudar=(campo,valor)=>setForm(f=>({...f,[campo]:valor}));
 const podeAlterar=a=>a.situacao!=='cancelado'&&new Date(`${a.data_agendamento}T${a.hora_inicio}`)>new Date();
 async function buscarCep(valor){
  const cep=somenteDigitos(valor);mudar('cep',cep);if(cep.length!==8)return;
  setCepBuscando(true);
  try{const r=await fetch(`https://viacep.com.br/ws/${cep}/json/`),d=await r.json();if(d.erro)throw Error('CEP não encontrado.');setForm(f=>({...f,cep,logradouro:d.logradouro||'',bairro:d.bairro||'',cidade:d.localidade||'',estado:d.uf||''}));}
  catch(e){avisar(mensagemErro(e),'erro')}finally{setCepBuscando(false)}
 }
 async function salvar(e){
  e.preventDefault();if(form.cpf&&!cpfValido(form.cpf))return avisar('Informe um CPF válido.','erro');
  setSalvando(true);setAviso('');
  try{
   if(form.email!==perfil.email){const{error}=await supabase.auth.updateUser({email:form.email});if(error)throw error}
   if(form.novaSenha){if(form.novaSenha.length<8||form.novaSenha!==form.confirmarSenha)throw Error('A senha deve ter ao menos 8 caracteres e a confirmação deve ser igual.');const{error}=await supabase.auth.updateUser({password:form.novaSenha});if(error)throw error}
   const{error}=await supabase.from('usuarios').update({nome:form.nome,email:form.email,telefone:somenteDigitos(form.telefone),cpf:somenteDigitos(form.cpf)||null,data_nascimento:form.data_nascimento||null,cep:somenteDigitos(form.cep)||null,logradouro:form.logradouro||null,numero:form.numero||null,complemento:form.complemento||null,bairro:form.bairro||null,cidade:form.cidade||null,estado:form.estado||null,foto_url:form.foto_url||null}).eq('id',usuario.id);
   if(error)throw error;setPerfil({...form,telefone:somenteDigitos(form.telefone)});avisar('Alterações salvas com sucesso.');
  }catch(e){avisar(mensagemErro(e),'erro')}finally{setSalvando(false)}
 }
 async function enviarFoto(e){
  const arquivo=e.target.files?.[0];if(!arquivo)return;if(!arquivo.type.startsWith('image/'))return avisar('Envie uma imagem JPG, PNG ou WebP.','erro');
  setSalvando(true);const caminho=`${usuario.usuario_auth_id}/${Date.now()}-${arquivo.name.replace(/[^a-zA-Z0-9.]/g,'')}`;
  const{error}=await supabase.storage.from('avatares').upload(caminho,arquivo,{upsert:false});
  if(error){avisar(mensagemErro(error),'erro');setSalvando(false);return}
  const{data}=supabase.storage.from('avatares').getPublicUrl(caminho);mudar('foto_url',data.publicUrl);setSalvando(false);avisar('Foto pronta para salvar.');
 }
 async function carregarHorarios(agendamento,data){
  setCarregandoHorarios(true);setHorariosEdicao([]);
  const{data:itens,error}=await supabase.rpc('horarios_disponiveis_remarcacao',{p_agendamento_id:agendamento.id,p_data:data});
  setCarregandoHorarios(false);
  if(error)avisar(mensagemErro(error),'erro');else setHorariosEdicao((itens||[]).map(i=>horario(i.hora_inicio)));
 }
 function abrirEdicao(a){const proximo={...a,hora_inicio:horario(a.hora_inicio)};setEditor(proximo);carregarHorarios(proximo,proximo.data_agendamento)}
 async function remarcar(e){
  e.preventDefault();if(!editor?.hora_inicio)return avisar('Escolha um horário disponível.','erro');
  setSalvando(true);const{error}=await supabase.rpc('remarcar_agendamento_cliente',{p_agendamento_id:editor.id,p_data:editor.data_agendamento,p_hora_inicio:editor.hora_inicio});setSalvando(false);
  if(error)return avisar(mensagemErro(error),'erro');setEditor(null);avisar('Agendamento remarcado com sucesso.');carregarAgendamentos();
 }
 async function cancelar(){
  if(!cancelamento)return;setSalvando(true);const{error}=await supabase.rpc('cancelar_agendamento_cliente',{p_agendamento_id:cancelamento.id});setSalvando(false);
  if(error)return avisar(mensagemErro(error),'erro');setCancelamento(null);avisar('Agendamento cancelado com sucesso.');carregarAgendamentos();
 }
 const proximos=agendamentos.filter(a=>a.situacao!=='cancelado'&&new Date(`${a.data_agendamento}T${a.hora_inicio}`)>=new Date());
 const tabela=lista=><div className="cliente-tabela">{lista.map(a=><article key={a.id}><b>#{a.id.slice(0,6).toUpperCase()}</b><span><strong>{a.servicos?.nome||'Serviço'}</strong><small>{a.profissionais?.usuarios?.nome||'Profissional Casa Âmbar'}</small>{a.observacao&&<small>Pedido: {a.observacao}</small>}</span><time>{dataFormatada(a.data_agendamento)} · {horario(a.hora_inicio)}</time><em>{a.situacao}</em>{podeAlterar(a)&&<div className="cliente-acoes"><button type="button" onClick={()=>abrirEdicao(a)}>Remarcar</button><button type="button" className="perigo" onClick={()=>setCancelamento(a)}>Cancelar</button></div>}</article>)}</div>;
 return <div className="cliente-shell"><aside className="cliente-sidebar"><button className="cliente-marca" onClick={onInicio}>CASA ÂMBAR</button><div className="cliente-identidade">{perfil?.foto_url?<img src={perfil.foto_url} alt="Foto de perfil"/>:<span>{perfil?.nome?.slice(0,1)}</span>}<div><strong>{perfil?.nome}</strong><small>{perfil?.email}</small></div></div><nav>{[['inicio','Início','⌂'],['agendamentos','Meus horários','◷'],['perfil','Meu perfil','◉']].map(([id,label,icone])=><button key={id} className={aba===id?'ativo':''} onClick={()=>setAba(id)}><Icon>{icone}</Icon>{label}</button>)}</nav><button className="cliente-sair" onClick={onSair}>Sair da conta</button></aside><main className="cliente-conteudo">{aviso&&<p className={`cliente-aviso ${tipoAviso}`} role={tipoAviso==='erro'?'alert':'status'}>{aviso}</p>}
 {aba==='inicio'&&<><header className="cliente-topo"><p>ÁREA DO CLIENTE</p><span>{new Intl.DateTimeFormat('pt-BR',{dateStyle:'full'}).format(new Date())}</span></header><section className="cliente-boas"><p>OLÁ, {perfil?.nome?.split(' ')[0]?.toUpperCase()}</p><h1>Seu tempo, do seu jeito.</h1><button onClick={onAgendar}>Agendar um horário</button></section><section className="cliente-metricas"><article><small>AGENDAMENTOS</small><strong>{agendamentos.length}</strong><span>no histórico</span></article><article><small>PRÓXIMOS</small><strong>{proximos.length}</strong><span>confirmados ou pendentes</span></article><article className="atalho"><small>PRECISA DE UM HORÁRIO?</small><button onClick={onAgendar}>Ver disponibilidade →</button></article></section><section className="cliente-lista"><div><p>MEUS AGENDAMENTOS</p><h2>Próximos horários</h2></div>{proximos.length?tabela(proximos):<div className="cliente-vazio"><p>Você ainda não tem horários marcados.</p><button onClick={onAgendar}>Criar agendamento</button></div>}</section></>}
 {aba==='agendamentos'&&<section className="cliente-lista pagina"><p>HISTÓRICO</p><h1>Todos os seus agendamentos</h1>{agendamentos.length?tabela(agendamentos):<div className="cliente-vazio"><p>Você ainda não tem horários marcados.</p><button onClick={onAgendar}>Criar agendamento</button></div>}</section>}
 {aba==='perfil'&&<section className="perfil-pagina"><header className="perfil-capa"><div className="perfil-foto">{form?.foto_url?<img src={form.foto_url} alt="Prévia do avatar"/>:<span>{form?.nome?.slice(0,1)}</span>}<label>Alterar foto<input type="file" accept="image/png,image/jpeg,image/webp" onChange={enviarFoto}/></label></div><div><p>MINHA CONTA</p><h1>{form?.nome}</h1><span>{form?.email}</span><div className="perfil-badges"><b>CLIENTE</b><b>CASA ÂMBAR</b></div></div></header><form className="perfil-form" onSubmit={salvar}><h2>Dados pessoais</h2><div className="perfil-grid"><label>Nome completo<input value={form?.nome||''} onChange={e=>mudar('nome',e.target.value)} required/></label><label>E-mail<input type="email" value={form?.email||''} onChange={e=>mudar('email',e.target.value)} required/></label><label>CPF<input inputMode="numeric" value={mascaraCpf(form?.cpf)} onChange={e=>mudar('cpf',somenteDigitos(e.target.value))} placeholder="000.000.000-00"/></label><label>Telefone<input inputMode="tel" value={mascaraTelefone(form?.telefone)} onChange={e=>mudar('telefone',somenteDigitos(e.target.value))} placeholder="(00) 00000-0000" required/></label><label>Data de nascimento<input type="date" value={form?.data_nascimento||''} onChange={e=>mudar('data_nascimento',e.target.value)}/></label><label>CEP<input inputMode="numeric" value={mascaraCep(form?.cep)} onChange={e=>buscarCep(e.target.value)} placeholder="00000-000"/>{cepBuscando&&<small>Buscando endereço...</small>}</label></div><h2>Endereço</h2><div className="perfil-grid"><label className="largo">Logradouro<input value={form?.logradouro||''} onChange={e=>mudar('logradouro',e.target.value)}/></label><label>Número<input value={form?.numero||''} onChange={e=>mudar('numero',e.target.value)}/></label><label>Complemento<input value={form?.complemento||''} onChange={e=>mudar('complemento',e.target.value)}/></label><label>Bairro<input value={form?.bairro||''} onChange={e=>mudar('bairro',e.target.value)}/></label><label>Cidade<input value={form?.cidade||''} onChange={e=>mudar('cidade',e.target.value)}/></label><label>Estado<input maxLength="2" value={form?.estado||''} onChange={e=>mudar('estado',e.target.value.toUpperCase())}/></label></div><h2>Segurança</h2><div className="perfil-grid"><label>Nova senha<input type="password" value={form?.novaSenha||''} onChange={e=>mudar('novaSenha',e.target.value)} placeholder="Deixe em branco para manter"/></label><label>Confirmar nova senha<input type="password" value={form?.confirmarSenha||''} onChange={e=>mudar('confirmarSenha',e.target.value)} placeholder="Repita a nova senha"/></label></div><footer><button type="button" onClick={()=>setForm(perfil)}>Cancelar</button><button className="salvar" disabled={salvando}>{salvando?'Salvando...':'Salvar alterações'}</button></footer></form></section>}</main>
 {editor&&<div className="cliente-modal"><form onSubmit={remarcar} aria-labelledby="titulo-remarcar"><button type="button" className="fechar" onClick={()=>setEditor(null)} aria-label="Fechar">×</button><p>REMARCAR AGENDAMENTO</p><h2 id="titulo-remarcar">Escolha uma nova data e horário</h2><span>{editor.servicos?.nome} com {editor.profissionais?.usuarios?.nome}</span><label>Data<input type="date" min={new Date().toISOString().slice(0,10)} value={editor.data_agendamento} onChange={e=>{const atualizado={...editor,data_agendamento:e.target.value,hora_inicio:''};setEditor(atualizado);carregarHorarios(atualizado,e.target.value)}} required/></label><label>Horário<select value={editor.hora_inicio} onChange={e=>setEditor({...editor,hora_inicio:e.target.value})} required disabled={carregandoHorarios}><option value="">{carregandoHorarios?'Buscando horários...':'Selecione um horário'}</option>{horariosEdicao.map(h=><option key={h} value={h}>{h}</option>)}</select></label>{!carregandoHorarios&&!horariosEdicao.length&&<small>Nenhum horário disponível nesta data.</small>}<footer><button type="button" onClick={()=>setEditor(null)}>Cancelar</button><button className="salvar" disabled={salvando||!editor.hora_inicio}>{salvando?'Salvando...':'Confirmar alteração'}</button></footer></form></div>}
 {cancelamento&&<div className="cliente-modal"><section className="cliente-confirmar" role="dialog" aria-modal="true" aria-labelledby="titulo-cancelar"><button type="button" className="fechar" onClick={()=>setCancelamento(null)} aria-label="Fechar">×</button><p>CANCELAR AGENDAMENTO</p><h2 id="titulo-cancelar">Deseja cancelar este horário?</h2><span>{cancelamento.servicos?.nome} · {dataFormatada(cancelamento.data_agendamento)} às {horario(cancelamento.hora_inicio)}</span><footer><button type="button" onClick={()=>setCancelamento(null)}>Voltar</button><button type="button" className="perigo" disabled={salvando} onClick={cancelar}>{salvando?'Cancelando...':'Sim, cancelar'}</button></footer></section></div>}</div>
}
