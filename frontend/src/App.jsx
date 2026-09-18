import React,{useEffect,useState}from'react';
import Landing from'./Landing';
import Booking from'./Booking';
import AccountModal from'./AccountModal';
import TeamDashboard from'./TeamDashboard';
import ClientDashboard from'./ClientDashboard';
import{supabase}from'./supabase';

const padrao={name:'Casa Âmbar',config_json:{logoText:'CASA ÂMBAR'}};
const rota=()=>location.hash==='#agendar'?'agendar':location.hash.startsWith('#dashboard')||location.hash==='#painel'?'dashboard':'inicio';

export default function App(){
 const slug=new URLSearchParams(location.search).get('tenant')||'casa-ambar';
 const[page,setPage]=useState(rota),[empresa,setEmpresa]=useState(padrao),[servicos,setServicos]=useState([]),[usuario,setUsuario]=useState(null),[modal,setModal]=useState(false),[mode,setMode]=useState('login'),[busy,setBusy]=useState(false),[erro,setErro]=useState(''),[sucesso,setSucesso]=useState('');
 const ir=(p,h='')=>{history.replaceState(null,'',`${location.pathname}${location.search}${h}`);setPage(p)};
 const irPerfil=()=>ir('dashboard','#dashboard-perfil');
 async function carregarPerfil(id){const{data}=await supabase.from('usuarios').select('*').eq('usuario_auth_id',id).single();if(data)setUsuario(data)}
 useEffect(()=>{if(!supabase)return;supabase.from('empresas').select('*').eq('slug',slug).single().then(({data})=>data&&setEmpresa(data));supabase.from('servicos').select('*').eq('ativo',true).order('nome').then(({data})=>setServicos(data||[]));supabase.auth.getSession().then(({data:{session}})=>session&&carregarPerfil(session.user.id));const{subscription}=supabase.auth.onAuthStateChange((_,session)=>session?carregarPerfil(session.user.id):setUsuario(null)).data;return()=>subscription?.unsubscribe()},[slug]);
 async function autenticar(tipo,dados){setBusy(true);setErro('');setSucesso('');try{if(tipo==='login'){const{data,error}=await supabase.auth.signInWithPassword({email:dados.email,password:dados.password});if(error)throw error;await carregarPerfil(data.user.id)}else{const{data,error}=await supabase.auth.signUp({email:dados.email,password:dados.password,options:{data:{nome:dados.name,telefone:dados.phone,slug_empresa:slug}}});if(error)throw error;if(!data.session)throw Error('O Supabase ainda exige confirmação por e-mail. Desative “Confirm email” em Authentication → Providers → Email.');await carregarPerfil(data.session.user.id)}setModal(false);ir('dashboard','#dashboard')}catch(e){setErro(e.message)}finally{setBusy(false)}}
 async function recuperarSenha(dados){setBusy(true);setErro('');setSucesso('');try{if(dados.acao==='enviar'){const{error}=await supabase.auth.resetPasswordForEmail(dados.email,{redirectTo:`${location.origin}/`});if(error)throw error;setSucesso('Se existir uma conta para este e-mail, o código foi enviado.');return}const{error:erroCodigo}=await supabase.auth.verifyOtp({email:dados.email,token:dados.codigo,type:'recovery'});if(erroCodigo)throw erroCodigo;const{error:erroSenha}=await supabase.auth.updateUser({password:dados.novaSenha});if(erroSenha)throw erroSenha;await supabase.auth.signOut();setSucesso('Senha alterada. Entre com a nova senha.');setMode('login')}catch(e){setErro(e.message)}finally{setBusy(false)}}
 async function sair(){await supabase.auth.signOut();setUsuario(null);ir('inicio')}
 const abrir=(m='login')=>{setErro('');setSucesso('');setMode(m);setModal(true)};
 const servicosFront=servicos.map(s=>({...s,name:s.nome,description:s.descricao,price:s.preco,duration_minutes:s.duracao_minutos}));
 if(page==='dashboard'&&usuario?.papel==='cliente')return <ClientDashboard supabase={supabase} usuario={usuario} servicos={servicosFront} onSair={sair} onInicio={()=>ir('inicio')} onAgendar={()=>ir('agendar','#agendar')}/>;
 if(page==='dashboard'&&usuario)return <TeamDashboard supabase={supabase} usuario={usuario} empresa={empresa} servicos={servicos} onInicio={()=>ir('inicio')} onSair={sair} perfilInicial={location.hash==='#dashboard-perfil'}/>;
 return <>{page==='agendar'?<Booking supabase={supabase} tenant={{name:empresa?.nome,config_json:empresa?.configuracao_json}} services={servicosFront} user={usuario} onHome={()=>ir('inicio')} onAccount={()=>abrir()} onLogout={sair}/>:<Landing tenant={{name:empresa?.nome||padrao.name,config_json:empresa?.configuracao_json||padrao.configuracao_json||padrao.config_json}} onBook={()=>ir('agendar','#agendar')} onAccount={()=>abrir()} user={usuario&&{name:usuario.nome,role:usuario.papel}} onLogout={sair} onDashboard={()=>ir('dashboard','#dashboard')} onProfile={irPerfil} onBooking={()=>ir('agendar','#agendar')}/>} {modal&&<AccountModal mode={mode} setMode={setMode} onClose={()=>setModal(false)} onLogin={d=>autenticar('login',d)} onRegister={d=>autenticar('register',d)} onForgot={recuperarSenha} services={servicos.map(s=>({...s,name:s.nome}))} busy={busy} error={erro} success={sucesso}/>}</>;
}
