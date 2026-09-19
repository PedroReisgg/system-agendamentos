const mapa={
  'duplicate key value violates unique constraint':'Já existe um cadastro com estes dados.',
  'violates foreign key constraint':'Não foi possível concluir porque este registro possui dados vinculados.',
  'email already registered':'Este e-mail já está cadastrado.',
  'user already registered':'Este e-mail já está cadastrado.',
  'invalid login credentials':'E-mail ou senha incorretos.',
  'email not confirmed':'Confirme o e-mail antes de entrar.',
  'jwt expired':'Sua sessão expirou. Entre novamente.',
  'new row violates row-level security policy':'Você não tem permissão para realizar esta ação.',
  'permission denied':'Você não tem permissão para realizar esta ação.',
  'network request failed':'Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.',
  'failed to fetch':'Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.',
  'horário indisponível':'Este horário não está mais disponível. Escolha outro horário.',
  'serviço inválido para este profissional':'Este serviço não está disponível para o profissional selecionado.',
  'cliente não autenticado':'Sua sessão expirou. Entre novamente para continuar.'
};

export function mensagemErro(erro,alternativa='Não foi possível concluir a operação. Tente novamente.'){
 const texto=String(erro?.message||erro||'').trim();
 if(!texto)return alternativa;
 const normalizado=texto.toLowerCase();
 const chave=Object.keys(mapa).find(item=>normalizado.includes(item));
 if(chave)return mapa[chave];
 if(normalizado.includes('usuarios_email')||normalizado.includes('email_key'))return 'Este e-mail já está cadastrado.';
 if(normalizado.includes('usuarios_cpf')||normalizado.includes('cpf_key'))return 'Este CPF já está cadastrado.';
 if(normalizado.includes('email'))return 'Não foi possível usar este e-mail. Verifique se ele já está cadastrado.';
 return texto;
}
